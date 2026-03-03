import { app, BrowserWindow, ipcMain, dialog, WebContents, safeStorage, Tray, Menu, globalShortcut, nativeImage, Notification, shell } from 'electron'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ChatPayload, HistorySyncMessage } from './shared-types'
import type { ToolInput, ContentBlock, ContentBlockText, ContentBlockToolUse, ContentBlockToolResult, AnthropicMessage, ImageAttachment, ApiConfig, DirEntry } from './types'
import { isDangerousCommand, isToolSafe, TOOLS_ANTHROPIC, buildSystemPrompt, executeTool } from './tools'
import { parseEndpoint, callAnthropicStream, callOpenAIStream, convertMessagesToOpenAI, callAPI } from './api-client'
import { getOrCreateTurnInfo, getSessionTurnInfo, deleteSessionTurnInfo, clearAllSessionTurnInfo, saveSnapshot, getSnapshots, deleteSnapshots, clearAllSnapshots, rollbackSnapshots, rebaseTurnInfoAfterHistoryRewrite, recomputeMinRollbackTurn } from './snapshots'
import { initAutoUpdater } from './updater'

// ESM 兼容：手动构造 __dirname / __filename
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const userDataPath = path.join(app.getPath('appData'), 'claude-code-gui')
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true })
}
app.setPath('userData', userDataPath)

// GPU 加速可配置：默认禁用以解决 Windows GPU 缓存权限问题
// 用户可在 userData/gpu-config.json 中设置 { "disableGpu": false } 来启用
const GPU_CONFIG_PATH = path.join(userDataPath, 'gpu-config.json')
let disableGpu = true
try {
  if (fs.existsSync(GPU_CONFIG_PATH)) {
    const gpuCfg = JSON.parse(fs.readFileSync(GPU_CONFIG_PATH, 'utf-8'))
    if (gpuCfg.disableGpu === false) disableGpu = false
  }
} catch { /* 使用默认值 */ }

if (disableGpu) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
}

// ── 默认值（仅作 fallback，实际由前端传入）────────────────
// claude-code-router 常见模型格式："provider,model"（你的环境里 dwf 可用）
const DEFAULT_MODEL = 'dwf,glm-5'
const MAX_TOOL_ROUNDS = 30

// 等待前端确认
const pendingConfirmations = new Map<string, {
  sessionId: string
  resolve: (approved: boolean) => void
}>()

function requestToolConfirmation(
  sender: WebContents,
  sessionId: string,
  confirmId: string,
  toolName: string,
  input: ToolInput,
): Promise<boolean> {
  return new Promise((resolve) => {
    pendingConfirmations.set(confirmId, { sessionId, resolve })
    sender.send('claude-stream-data', sessionId, JSON.stringify({
      type: 'tool_confirm',
      confirmId,
      toolName,
      input,
    }))
  })
}

// ── 全局状态 ────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
// key = sessionId（支持多会话并行流式）
const activeAbortControllers = new Map<string, { aborted: boolean; destroy?: () => void }>()
const conversationHistories = new Map<string, Array<AnthropicMessage>>()

type SessionRuntimePhase = 'idle' | 'streaming' | 'rollback' | 'restore'
const sessionRuntimeState = new Map<string, SessionRuntimePhase>()

function getSessionPhase(sessionId: string): SessionRuntimePhase {
  return sessionRuntimeState.get(sessionId) || 'idle'
}

function setSessionPhase(sessionId: string, phase: SessionRuntimePhase) {
  sessionRuntimeState.set(sessionId, phase)
}

async function stopSessionStream(sessionId: string) {
  const ctrl = activeAbortControllers.get(sessionId)
  if (ctrl) {
    ctrl.aborted = true
    ctrl.destroy?.()
  }

  for (const [id, pending] of Array.from(pendingConfirmations)) {
    if (pending.sessionId !== sessionId) continue
    pending.resolve(false)
    pendingConfirmations.delete(id)
  }

  if (activeAbortControllers.has(sessionId)) {
    await new Promise<void>((resolve) => {
      const startedAt = Date.now()
      const timeoutMs = 5000
      const timer = setInterval(() => {
        if (!activeAbortControllers.has(sessionId) || Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer)
          resolve()
        }
      }, 20)
    })
  }
}

async function withSessionExclusive<T>(
  sessionId: string,
  phase: 'rollback' | 'restore',
  handler: () => Promise<T>,
): Promise<T> {
  const current = getSessionPhase(sessionId)
  if (current === 'rollback' || current === 'restore') {
    throw new Error('会话正在执行回滚/恢复，请稍后再试')
  }

  await stopSessionStream(sessionId)

  if (getSessionPhase(sessionId) === 'streaming') {
    throw new Error('会话流式任务尚未停止，请稍后重试')
  }

  setSessionPhase(sessionId, phase)
  try {
    return await handler()
  } finally {
    setSessionPhase(sessionId, 'idle')
  }
}

function cleanupSessionResources(sessionId: string) {
  const ctrl = activeAbortControllers.get(sessionId)
  if (ctrl) {
    ctrl.aborted = true
    ctrl.destroy?.()
    activeAbortControllers.delete(sessionId)
  }

  for (const [id, pending] of Array.from(pendingConfirmations)) {
    if (pending.sessionId !== sessionId) continue
    pending.resolve(false)
    pendingConfirmations.delete(id)
  }

  conversationHistories.delete(sessionId)
  deleteSnapshots(sessionId)
  deleteSessionTurnInfo(sessionId)
  sessionRuntimeState.delete(sessionId)
}

// 获取或创建会话的对话历史（限制最多 20 个会话，超出时清理最旧的）
const MAX_CONVERSATION_SESSIONS = 20
function getOrCreateHistory(sessionId: string): AnthropicMessage[] {
  if (!conversationHistories.has(sessionId)) {
    if (conversationHistories.size >= MAX_CONVERSATION_SESSIONS) {
      const oldestKey = conversationHistories.keys().next().value
      if (oldestKey) cleanupSessionResources(oldestKey)
    }
    conversationHistories.set(sessionId, [])
  }
  return conversationHistories.get(sessionId)!
}

// 估算消息列表的字符数（粗估 1 token ≈ 4 chars）
function estimateChars(msgs: AnthropicMessage[]): number {
  let total = 0
  for (const m of msgs) {
    if (typeof m.content === 'string') {
      total += m.content.length
    } else {
      for (const b of m.content) {
        if (b.type === 'text') total += (b as ContentBlockText).text.length
        else if (b.type === 'tool_use') total += JSON.stringify((b as ContentBlockToolUse).input).length + 100
        else if (b.type === 'tool_result') total += (b as ContentBlockToolResult).content.length
      }
    }
  }
  return total
}

function syncSessionHistoryFromRenderer(sessionId: string, messages: HistorySyncMessage[]) {
  const normalized: AnthropicMessage[] = []

  for (const msg of messages) {
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue
    if (typeof msg.content !== 'string') continue
    normalized.push({ role: msg.role, content: msg.content })
  }

  conversationHistories.set(sessionId, normalized)

  const turnInfo = getOrCreateTurnInfo(sessionId)
  turnInfo.turnEndHistoryIndex.clear()

  let userTurn = -1
  let pendingTurn: number | null = null
  for (let i = 0; i < normalized.length; i++) {
    const m = normalized[i]
    if (m.role === 'user') {
      userTurn += 1
      pendingTurn = userTurn
      continue
    }
    if (m.role === 'assistant' && pendingTurn !== null) {
      turnInfo.turnEndHistoryIndex.set(pendingTurn, i + 1)
      pendingTurn = null
    }
  }

  turnInfo.currentTurn = userTurn
  recomputeMinRollbackTurn(sessionId)

  return {
    success: true,
    mappedTurns: turnInfo.turnEndHistoryIndex.size,
    currentTurn: turnInfo.currentTurn,
    minRollbackTurn: turnInfo.minRollbackTurn,
  }
}

const DEFAULT_API_CONFIG: ApiConfig = {
  endpoint: 'http://127.0.0.1:3456',
  key: '',
  format: 'anthropic',
}

// ── 窗口状态持久化 ──────────────────────────────────────
const WINDOW_STATE_PATH = path.join(userDataPath, 'window-state.json')

interface WindowState { x?: number; y?: number; width: number; height: number; isMaximized: boolean }

function loadWindowState(): WindowState {
  try {
    if (fs.existsSync(WINDOW_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf-8')) as WindowState
    }
  } catch { /* ignore */ }
  return { width: 1200, height: 800, isMaximized: false }
}

function saveWindowState(win: BrowserWindow) {
  try {
    const bounds = win.getBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized(),
    }
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(state), 'utf-8')
  } catch { /* ignore */ }
}

// ── 窗口 ────────────────────────────────────────────────
function createWindow() {
  const savedState = loadWindowState()

  mainWindow = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
    width: savedState.width,
    height: savedState.height,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  // CSP: 限制脚本/样式来源，允许 data: 图片（base64 截图）和 blob:
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self';" +
          " script-src 'self' 'unsafe-inline';" +
          " style-src 'self' 'unsafe-inline';" +
          " img-src 'self' data: blob: https:;" +
          " font-src 'self' data:;" +
          " connect-src 'self' ws: wss: http: https:;" +
          " worker-src 'self' blob:;",
        ],
      },
    })
  })

  if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  // 关闭窗口时最小化到托盘（而非退出），除非用户明确退出
  mainWindow.on('close', (e) => {
    if (mainWindow) saveWindowState(mainWindow)
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    // 生产环境启用自动更新
    initAutoUpdater(mainWindow)
  }
}

// ── 单实例锁：防止多开导致端口冲突或数据竞争 ──────────
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 如果用户尝试打开第二个实例，聚焦到已有窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()
    createTray()
    registerGlobalShortcut()
  })
}

// ── 系统托盘 ──────────────────────────────────────────
function createTray() {
  // 使用「平安」艺术字图标（32x32）
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      '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',
      'base64',
    ),
  )
  tray = new Tray(icon)
  tray.setToolTip('平安 - Claude Code GUI')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

// ── 全局快捷键 ────────────────────────────────────────
function registerGlobalShortcut() {
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })
}

// ── 优雅退出：清理所有活跃资源 ────────────────────────
function cleanupAllResources() {
  for (const sessionId of Array.from(conversationHistories.keys())) {
    cleanupSessionResources(sessionId)
  }

  // 兜底：清理可能未出现在 history map 里的残余资源
  for (const [id, ctrl] of activeAbortControllers) {
    ctrl.aborted = true
    ctrl.destroy?.()
    activeAbortControllers.delete(id)
  }
  for (const [id, pending] of pendingConfirmations) {
    pending.resolve(false)
    pendingConfirmations.delete(id)
  }

  conversationHistories.clear()
  clearAllSnapshots()
  clearAllSessionTurnInfo()
  sessionRuntimeState.clear()
}

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  cleanupAllResources()
})

app.on('window-all-closed', () => {
  cleanupAllResources()
  // 托盘模式下不退出（除非 isQuitting）
  if (isQuitting && process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ── 窗口控制 ────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize())
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window-close', () => mainWindow?.close())

// ── 应用信息 ─────────────────────────────────────────────
ipcMain.handle('get-app-version', () => {
  return { success: true, version: app.getVersion() }
})

// ── 安全存储（API Key 加密）────────────────────────────
const SECURE_STORE_PATH = path.join(userDataPath, 'secure-keys.json')

ipcMain.handle('secure-store-set', async (_event, key: string, value: string) => {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value)
      let store: Record<string, string> = {}
      try {
        if (fs.existsSync(SECURE_STORE_PATH)) {
          store = JSON.parse(fs.readFileSync(SECURE_STORE_PATH, 'utf-8'))
        }
      } catch { /* ignore */ }
      store[key] = encrypted.toString('base64')
      fs.writeFileSync(SECURE_STORE_PATH, JSON.stringify(store), 'utf-8')
      return { success: true }
    }
    return { success: false, error: 'Encryption not available' }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
})

ipcMain.handle('secure-store-get', async (_event, key: string) => {
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(SECURE_STORE_PATH)) {
      const store: Record<string, string> = JSON.parse(fs.readFileSync(SECURE_STORE_PATH, 'utf-8'))
      if (store[key]) {
        const decrypted = safeStorage.decryptString(Buffer.from(store[key], 'base64'))
        return { success: true, value: decrypted }
      }
    }
    return { success: true, value: '' }
  } catch (err) {
    return { success: false, value: '', error: (err as Error).message }
  }
})

ipcMain.handle('secure-store-delete', async (_event, key: string) => {
  try {
    if (fs.existsSync(SECURE_STORE_PATH)) {
      const store: Record<string, string> = JSON.parse(fs.readFileSync(SECURE_STORE_PATH, 'utf-8'))
      delete store[key]
      fs.writeFileSync(SECURE_STORE_PATH, JSON.stringify(store), 'utf-8')
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
})

// ── 选择文件（附加到对话上下文）────────────────────────
ipcMain.handle('select-files', async () => {
  if (!mainWindow) return { canceled: true, files: [] }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: '选择文件附加到对话',
    filters: [
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, files: [] }
  }
  const files: Array<{ name: string; path: string; content: string; isImage: boolean; mediaType?: string; base64?: string }> = []
  for (const fp of result.filePaths.slice(0, 10)) {
    const name = path.basename(fp)
    const ext = path.extname(fp).toLowerCase()
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']
    if (imageExts.includes(ext)) {
      try {
        const buf = fs.readFileSync(fp)
        const mimeMap: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        }
        files.push({ name, path: fp, content: '', isImage: true, mediaType: mimeMap[ext] || 'image/png', base64: buf.toString('base64') })
      } catch { files.push({ name, path: fp, content: `[无法读取图片: ${fp}]`, isImage: false }) }
    } else {
      try {
        let text = fs.readFileSync(fp, 'utf-8')
        if (text.length > 50000) text = text.slice(0, 50000) + '\n... (文件过大，已截断)'
        files.push({ name, path: fp, content: text, isImage: false })
      } catch { files.push({ name, path: fp, content: `[无法读取文件: ${fp}]`, isImage: false }) }
    }
  }
  return { canceled: false, files }
})

// ── 读取目录树 ──────────────────────────────────────────
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', '.cache',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode', '.DS_Store',
  'coverage', '.turbo', '.output', '.svelte-kit',
])

const IGNORED_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.o',
  '.pyc', '.pyo', '.class', '.jar', '.war',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
  '.mp3', '.mp4', '.avi', '.mov', '.wav',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.lock',
])

// 读取单层目录内容（用于懒加载）
function listDirChildren(dirPath: string, showHidden: boolean = false): DirEntry[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const result: DirEntry[] = []
    for (const entry of entries) {
      // 隐藏文件过滤（.env 始终保留）
      if (!showHidden && entry.name.startsWith('.') && entry.name !== '.env') continue
      if (IGNORED_DIRS.has(entry.name)) continue
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        // 探测目录是否有子项（用于前端显示展开箭头）
        let hasChildren = false
        try {
          const sub = fs.readdirSync(fullPath, { withFileTypes: true })
          hasChildren = sub.some(s => {
            if (!showHidden && s.name.startsWith('.') && s.name !== '.env') return false
            if (IGNORED_DIRS.has(s.name)) return false
            return true
          })
        } catch { /* 无法读取 = 无子项 */ }
        result.push({ name: entry.name, path: fullPath, isDir: true, children: hasChildren ? undefined : [] })
      } else {
        const ext = path.extname(entry.name).toLowerCase()
        if (IGNORED_EXTENSIONS.has(ext)) continue
        try {
          const stat = fs.statSync(fullPath)
          result.push({ name: entry.name, path: fullPath, isDir: false, size: stat.size })
        } catch {
          result.push({ name: entry.name, path: fullPath, isDir: false })
        }
      }
    }
    result.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })
    return result
  } catch {
    return []
  }
}

// Windows 路径安全比较
function resolvePathSafe(rawPath: string): string {
  return fs.realpathSync.native(path.resolve(rawPath))
}

function isInsideRoot(root: string, target: string): boolean {
  try {
    const realRoot = resolvePathSafe(root)
    const realTarget = resolvePathSafe(target)
    const rel = path.relative(realRoot, realTarget)
    if (rel === '') return true
    return !(rel.startsWith('..') || path.isAbsolute(rel))
  } catch {
    return false
  }
}

function resolvePathWithinRoot(root: string, rawTarget: string): { root: string; target: string } {
  const rootReal = resolvePathSafe(root)
  const candidate = path.isAbsolute(rawTarget)
    ? path.resolve(rawTarget)
    : path.resolve(rootReal, rawTarget)
  const targetReal = resolvePathSafe(candidate)
  if (!isInsideRoot(rootReal, targetReal)) {
    throw new Error('路径越界')
  }
  return { root: rootReal, target: targetReal }
}

ipcMain.handle('list-directory', async (_event, payload: { root: string; dirPath?: string; showHidden?: boolean }) => {
  try {
    const root = payload?.root?.trim()
    if (!root) return { error: '未设置工作目录', entries: [] }

    const resolvedRoot = resolvePathSafe(root)
    if (!fs.statSync(resolvedRoot).isDirectory()) return { error: `不是目录: ${root}`, entries: [] }

    // 确定要列出的目标目录
    let targetDir = resolvedRoot
    if (payload.dirPath) {
      const resolved = resolvePathWithinRoot(resolvedRoot, payload.dirPath)
      targetDir = resolved.target
    }

    if (!isInsideRoot(resolvedRoot, targetDir)) return { error: '路径越界', entries: [] }
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return { error: `目标目录无效: ${targetDir}`, entries: [] }
    }

    const entries = listDirChildren(targetDir, payload.showHidden || false)
    return { error: null, entries, dirPath: targetDir }
  } catch (err) {
    return { error: (err as Error).message, entries: [] }
  }
})

ipcMain.handle('read-file-content', async (_event, payload: { root: string; filePath: string }) => {
  try {
    const root = payload?.root?.trim()
    if (!root) return { error: '未设置工作目录' }

    const resolvedRoot = resolvePathSafe(root)
    if (!fs.statSync(resolvedRoot).isDirectory()) return { error: 'root 无效' }

    const raw = payload?.filePath
    if (!raw) return { error: 'filePath 不能为空' }

    const { target: fullPath } = resolvePathWithinRoot(resolvedRoot, raw)
    if (!isInsideRoot(resolvedRoot, fullPath)) return { error: '路径越界（不在工作目录内）' }

    if (!fs.existsSync(fullPath)) return { error: '文件不存在' }
    const stat = fs.statSync(fullPath)
    if (stat.size > 500_000) return { error: '文件过大（>500KB）' }
    const content = fs.readFileSync(fullPath, 'utf-8')
    return { content, size: stat.size }
  } catch (err) {
    return { error: (err as Error).message }
  }
})

// ── 写入文件内容 ────────────────────────────────────────
ipcMain.handle('write-file-content', async (_event, payload: { root: string; filePath: string; content: string }) => {
  try {
    const root = payload?.root?.trim()
    if (!root) return { error: '未设置工作目录' }

    const resolvedRoot = resolvePathSafe(root)
    if (!fs.statSync(resolvedRoot).isDirectory()) return { error: 'root 无效' }

    const raw = payload?.filePath
    if (!raw) return { error: 'filePath 不能为空' }

    const candidatePath = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(resolvedRoot, raw)
    const parentDir = path.dirname(candidatePath)
    const parentReal = resolvePathSafe(parentDir)
    if (!isInsideRoot(resolvedRoot, parentReal)) return { error: '路径越界（不在工作目录内）' }

    const fullPath = path.join(parentReal, path.basename(candidatePath))

    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(fullPath, payload.content, 'utf-8')
    return { success: true }
  } catch (err) {
    return { error: (err as Error).message }
  }
})

// ── 选择文件夹 ──────────────────────────────────────────
ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return { canceled: true, path: '' }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择项目工作目录',
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: '' }
  }
  return { canceled: false, path: result.filePaths[0] }
})

// ── 停止指定会话的请求 ────────────────────────────────────
ipcMain.handle('claude-stream-stop', async (_event, sessionId?: string) => {
  if (sessionId) {
    await stopSessionStream(sessionId)
  } else {
    // 兼容旧调用：停止所有
    const sessionIds = new Set<string>([
      ...activeAbortControllers.keys(),
      ...Array.from(pendingConfirmations.values()).map(v => v.sessionId),
    ])
    for (const sid of sessionIds) {
      await stopSessionStream(sid)
    }
  }
  return { success: true }
})

// ── 工具确认响应 ────────────────────────────────────────
ipcMain.handle('tool-confirm-response', async (_event, confirmId: string, approved: boolean) => {
  const pending = pendingConfirmations.get(confirmId)
  if (pending) {
    pending.resolve(approved)
    pendingConfirmations.delete(confirmId)
  }
  return { success: true }
})

// ── 外部链接 / 本地文件打开 ──────────────────────────────
ipcMain.handle('open-external', async (_event, payload: { target: string; root?: string }) => {
  try {
    const target = payload?.target?.trim()
    if (!target) return { success: false, error: '目标不能为空' }

    // 仅允许 http/https
    if (/^https?:\/\//i.test(target)) {
      const parsed = new URL(target)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, error: '不支持的 URL 协议' }
      }
      await shell.openExternal(parsed.toString())
      return { success: true }
    }

    // 本地路径需在 root 内
    if (path.isAbsolute(target) && fs.existsSync(target)) {
      const root = payload?.root?.trim()
      if (!root) return { success: false, error: '缺少工作目录，拒绝打开本地路径' }
      const { root: rootReal, target: targetReal } = resolvePathWithinRoot(root, target)
      if (!isInsideRoot(rootReal, targetReal)) {
        return { success: false, error: '路径越界，拒绝打开' }
      }
      const errMsg = await shell.openPath(targetReal)
      if (errMsg) return { success: false, error: errMsg }
      return { success: true }
    }

    return { success: false, error: '无效的 URL 或文件路径' }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
})

// ── 桌面通知 ────────────────────────────────────────────
ipcMain.handle('show-notification', async (_event, payload: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    const n = new Notification({ title: payload.title, body: payload.body })
    n.show()
    return { success: true }
  }
  return { success: false, error: 'Notification not supported' }
})

// ── Git 状态 ────────────────────────────────────────────
ipcMain.handle('git-status', async (_event, cwd?: string) => {
  return new Promise<{ success: boolean; output: string }>((resolve) => {
    const workdir = cwd?.trim() || undefined
    const validCwd = workdir && fs.existsSync(workdir) && fs.statSync(workdir).isDirectory() ? workdir : undefined

    const git = spawn('git', ['status', '--short', '--branch'], {
      shell: false,
      cwd: validCwd,
    })

    let output = ''
    let error = ''
    git.stdout.on('data', (d) => { output += d.toString() })
    git.stderr.on('data', (d) => { error += d.toString() })

    git.on('close', (code) => {
      if (code === 0) resolve({ success: true, output: output.trim() || '工作区干净' })
      else resolve({ success: false, output: (error || output || 'Git 状态读取失败').trim() })
    })
    git.on('error', (err) => resolve({ success: false, output: err.message }))
  })
})

// ── 连接检测 ────────────────────────────────────────────
ipcMain.handle('check-api-connection', async (_event, config: { endpoint: string; key: string; format: string }) => {
  const startTime = Date.now()
  try {
    const { hostname, port, basePath, protocol } = parseEndpoint(config.endpoint)
    const reqModule = protocol === 'https:' ? https : http

    return await new Promise<{ connected: boolean; latency: number; error?: string }>((resolve) => {
      const req = reqModule.request(
        {
          hostname,
          port,
          path: `${basePath}/v1/models`,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${config.key}`,
            'x-api-key': config.key || 'dummy',
          },
          timeout: 5000,
        },
        (res) => {
          res.on('data', () => { /* drain */ })
          res.on('end', () => {
            const latency = Date.now() - startTime
            // 任何 HTTP 响应都说明服务器在运行（包括 401/404 等）
            resolve({ connected: true, latency })
          })
        },
      )

      req.on('timeout', () => {
        req.destroy()
        resolve({ connected: false, latency: Date.now() - startTime, error: '连接超时 (5s)' })
      })

      req.on('error', (err) => {
        resolve({ connected: false, latency: Date.now() - startTime, error: err.message })
      })

      req.end()
    })
  } catch (err) {
    return { connected: false, latency: Date.now() - startTime, error: (err as Error).message }
  }
})

// ── MCP 连接测试 ────────────────────────────────────────
ipcMain.handle('test-mcp-connection', async (_event, config: { command: string; args: string }) => {
  return new Promise<{ connected: boolean; error?: string }>((resolve) => {
    const command = (config.command || '').trim()
    if (!command) {
      resolve({ connected: false, error: '命令不能为空' })
      return
    }

    // 仅允许可执行文件名/路径，不允许注入控制符
    if (/['"`;&|><\n\r]/.test(command)) {
      resolve({ connected: false, error: '命令包含非法字符' })
      return
    }

    const dangerousCommands = new Set(['cmd', 'powershell', 'pwsh', 'sh', 'bash', 'zsh'])
    const commandBase = path.basename(command).toLowerCase()
    if (dangerousCommands.has(commandBase)) {
      resolve({ connected: false, error: `不允许将高风险命令作为 MCP 启动命令: ${commandBase}` })
      return
    }

    const rawArgs = (config.args || '').trim()
    if (/[\n\r]/.test(rawArgs)) {
      resolve({ connected: false, error: '参数包含非法换行符' })
      return
    }

    const argsArray = rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : []
    if (argsArray.some(a => /[`;&|><]/.test(a))) {
      resolve({ connected: false, error: '参数包含非法控制符' })
      return
    }

    let settled = false
    const done = (result: { connected: boolean; error?: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const child = spawn(command, argsArray, {
      shell: false,
      timeout: 5000,
    })

    let gotOutput = false
    let stderrText = ''
    let killedByProbe = false

    child.stdout?.on('data', () => { gotOutput = true })
    child.stderr?.on('data', (d) => {
      gotOutput = true
      stderrText += d.toString()
    })

    child.on('error', (err) => {
      done({ connected: false, error: err.message })
    })

    // 等待 2 秒，如果进程还在运行说明连接成功
    const probeTimer = setTimeout(() => {
      if (!child.killed) {
        killedByProbe = true
        child.kill()
        done({ connected: true })
      }
    }, 2000)

    child.on('close', (code, signal) => {
      clearTimeout(probeTimer)
      if (killedByProbe || signal === 'SIGTERM') {
        done({ connected: true })
        return
      }
      if (code === 0 || gotOutput) {
        done({ connected: true })
      } else {
        const suffix = stderrText.trim() ? ` (${stderrText.trim().slice(0, 200)})` : ''
        done({ connected: false, error: `进程退出码: ${code}${suffix}` })
      }
    })
  })
})

// ── 对话导出 ────────────────────────────────────────────
ipcMain.handle('export-chat', async (_event, data: {
  messages: Array<{
    role: string
    content: string
    blocks?: Array<{
      type: string
      toolName?: string
      input?: Record<string, unknown>
      output?: string
      content?: string
      round?: number
    }>
    timestamp: string
  }>
  title: string
  model: string
}) => {
  try {
    if (!mainWindow) return { success: false, error: '窗口不存在' }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出对话',
      defaultPath: `${data.title || 'chat'}-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) {
      return { success: false, error: '用户取消' }
    }

    // 构建 Markdown 内容
    let md = `# ${data.title || '对话记录'}\n\n`
    md += `> 模型: ${data.model} | 导出时间: ${new Date().toLocaleString('zh-CN')}\n\n`
    md += `---\n\n`

    for (const msg of data.messages) {
      const time = new Date(msg.timestamp).toLocaleString('zh-CN')

      if (msg.role === 'user') {
        md += `## 用户 <sub>${time}</sub>\n\n`
        md += `${msg.content}\n\n`
      } else {
        md += `## Claude <sub>${time}</sub>\n\n`

        if (msg.blocks && msg.blocks.length > 0) {
          for (const block of msg.blocks) {
            if (block.type === 'text' && block.content) {
              md += `${block.content}\n\n`
            } else if (block.type === 'tool_call') {
              md += `### 工具调用: ${block.toolName}\n\n`
              if (block.toolName === 'bash') {
                md += `\`\`\`bash\n${block.input?.command || ''}\n\`\`\`\n\n`
              } else {
                md += `\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n\n`
              }
            } else if (block.type === 'tool_result') {
              md += `<details>\n<summary>输出 (${block.toolName})</summary>\n\n\`\`\`\n${block.output || ''}\n\`\`\`\n\n</details>\n\n`
            } else if (block.type === 'round') {
              md += `---\n*第 ${block.round} 轮思考*\n\n`
            }
          }
        } else {
          md += `${msg.content}\n\n`
        }
      }

      md += `---\n\n`
    }

    fs.writeFileSync(result.filePath, md, 'utf-8')
    return { success: true, path: result.filePath }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
})

// ── 会话导入（读取 Markdown/JSON 文件）──────────────────
ipcMain.handle('import-chat', async () => {
  try {
    if (!mainWindow) return { success: false, error: '窗口不存在' }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入对话',
      filters: [
        { name: 'Markdown / JSON', extensions: ['md', 'json'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: '用户取消' }
    }

    const filePath = result.filePaths[0]
    const content = fs.readFileSync(filePath, 'utf-8')
    const ext = path.extname(filePath).toLowerCase()

    return { success: true, content, format: ext === '.json' ? 'json' : 'markdown', fileName: path.basename(filePath) }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
})

// ── 核心：Agentic 流式对话（支持工具调用循环）──────────
ipcMain.handle('claude-stream', async (event, payload: ChatPayload) => {
  const prompt = (typeof payload === 'string' ? payload : payload.prompt) || ''
  const model = (typeof payload === 'string' ? DEFAULT_MODEL : payload.model) || DEFAULT_MODEL
  const cwd = (typeof payload === 'string' ? '' : payload.cwd) || ''
  const sessionId = (typeof payload === 'string' ? 'default' : payload.sessionId) || 'default'

  const currentPhase = getSessionPhase(sessionId)
  if (currentPhase === 'streaming' || activeAbortControllers.has(sessionId)) {
    event.sender.send('claude-stream-error', sessionId, '该会话已有任务在运行，请等待当前任务完成后重试')
    event.sender.send('claude-stream-end', sessionId, 1)
    return { code: 1 }
  }
  if (currentPhase === 'rollback' || currentPhase === 'restore') {
    event.sender.send('claude-stream-error', sessionId, '会话正在回滚/恢复，请稍后重试')
    event.sender.send('claude-stream-end', sessionId, 1)
    return { code: 1 }
  }

  setSessionPhase(sessionId, 'streaming')
  const abortCtrl = { aborted: false }
  activeAbortControllers.set(sessionId, abortCtrl)
  const skipPermissions = (typeof payload === 'string' ? false : payload.skipPermissions) || false

  // 解析 API 配置
  const apiConfig: ApiConfig = {
    endpoint: (typeof payload === 'string' ? '' : payload.apiEndpoint) || DEFAULT_API_CONFIG.endpoint,
    key: (typeof payload === 'string' ? '' : payload.apiKey) ?? DEFAULT_API_CONFIG.key,
    format: (typeof payload === 'string' ? 'anthropic' : payload.apiFormat) || DEFAULT_API_CONFIG.format,
  }

  if (!cwd || !fs.existsSync(cwd)) {
    activeAbortControllers.delete(sessionId)
    setSessionPhase(sessionId, 'idle')
    event.sender.send('claude-stream-error', sessionId, '请先在设置中选择一个有效的工作目录')
    event.sender.send('claude-stream-end', sessionId, 1)
    return { code: 1 }
  }

  const history = getOrCreateHistory(sessionId)
  // 构建 user 消息：纯文本或包含图片的多块内容
  const images: ImageAttachment[] = (typeof payload === 'string' ? [] : payload.images) || []
  if (images.length > 0) {
    const userContent: ContentBlock[] = []
    for (const img of images) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
      })
    }
    userContent.push({ type: 'text', text: prompt })
    history.push({ role: 'user', content: userContent })
  } else {
    history.push({ role: 'user', content: prompt })
  }

  // 轮次追踪：每次 stream 调用 = 一个新轮次
  const turnInfo = getOrCreateTurnInfo(sessionId)
  if (
    turnInfo.minRollbackTurn >= 0
    && turnInfo.minRollbackTurn < Number.MAX_SAFE_INTEGER
    && turnInfo.currentTurn < turnInfo.minRollbackTurn - 1
  ) {
    turnInfo.currentTurn = turnInfo.minRollbackTurn - 1
  }
  turnInfo.currentTurn++
  const currentTurn = turnInfo.currentTurn

  // ── 上下文窗口管理：估算 token 数，超限时自动摘要压缩 ──
  const MAX_CONTEXT_CHARS = 400_000 // ~100k tokens (粗估 1 token ≈ 4 chars)
  const SUMMARY_THRESHOLD = 300_000 // 达到此阈值时触发自动摘要

  // 自动摘要：上下文过长时，将前半部分对话压缩为摘要
  if (!abortCtrl.aborted && history.length > 4 && estimateChars(history) > SUMMARY_THRESHOLD) {
    event.sender.send('claude-stream-data', sessionId, JSON.stringify({
      type: 'text',
      content: '\n[系统: 对话历史较长，正在自动生成摘要以压缩上下文...]\n',
    }))

    // 取前半部分消息用于摘要（保留最近 4 条消息不被摘要）
    const keepRecent = 4
    const toSummarize = history.slice(0, history.length - keepRecent)
    const recentMessages = history.slice(history.length - keepRecent)

    // 将待摘要的消息转为文本
    const summaryText = toSummarize.map(m => {
      const role = m.role === 'user' ? '用户' : '助手'
      let text = ''
      if (typeof m.content === 'string') {
        text = m.content.slice(0, 500)
      } else {
        for (const b of m.content) {
          if (b.type === 'text') text += (b as ContentBlockText).text.slice(0, 300) + '\n'
          else if (b.type === 'tool_use') text += `[工具调用: ${(b as ContentBlockToolUse).name}]\n`
          else if (b.type === 'tool_result') text += `[工具结果: ${(b as ContentBlockToolResult).content.slice(0, 200)}]\n`
        }
      }
      return `${role}: ${text.trim()}`
    }).join('\n---\n')

    try {
      // 用非流式调用生成摘要（复用 callAPI）
      const summarySystemPrompt = '你是一个对话摘要助手。请简洁准确地总结对话内容。'
      const summaryUserContent = `请用中文简洁地总结以下对话的关键内容（包括讨论的问题、做出的决定、修改的文件、重要代码变更）。保留技术细节但去掉冗余。限制在 500 字以内。\n\n${summaryText.slice(0, 20000)}`

      let body: string
      if (apiConfig.format === 'openai') {
        body = JSON.stringify({
          model,
          messages: [
            { role: 'system', content: summarySystemPrompt },
            { role: 'user', content: summaryUserContent },
          ],
          max_tokens: 1000,
          stream: false,
        })
      } else {
        body = JSON.stringify({
          model,
          system: summarySystemPrompt,
          messages: [{ role: 'user', content: summaryUserContent }],
          max_tokens: 1000,
        })
      }

      const { statusCode, data } = await callAPI(body, apiConfig)
      let summaryResult = '(摘要生成失败)'
      try {
        const json = JSON.parse(data)
        if (statusCode >= 400) {
          const errMsg = json?.error?.message || json?.message
          summaryResult = `(摘要请求失败: HTTP ${statusCode}${errMsg ? ` - ${errMsg}` : ''})`
        } else if (apiConfig.format === 'openai') {
          summaryResult = json.choices?.[0]?.message?.content || '(摘要生成失败)'
        } else {
          const textBlock = json.content?.find((b: { type: string }) => b.type === 'text')
          summaryResult = textBlock?.text || '(摘要生成失败)'
        }
      } catch {
        summaryResult = statusCode >= 400 ? `(摘要请求失败: HTTP ${statusCode})` : '(摘要解析失败)'
      }

      // 用摘要替换早期消息（确保以 user 角色开头，满足 Anthropic API 要求）
      const oldHistoryLength = history.length
      history.length = 0
      history.push({
        role: 'user',
        content: `[系统自动摘要] 以下是之前对话的摘要，请基于此上下文继续工作：\n\n${String(summaryResult).trim()}`,
      })
      history.push({
        role: 'assistant',
        content: '好的，我已了解之前的对话内容。请继续。',
      })
      // 确保 recentMessages 不会导致连续相同角色
      if (recentMessages.length > 0) {
        if (recentMessages[0].role === 'assistant') {
          // recentMessages 以 assistant 开头，移除占位 assistant 避免连续 assistant
          history.pop()
        } else if (recentMessages[0].role === 'user') {
          // recentMessages 以 user 开头，占位 assistant 正好隔开 user-assistant-user
        }
      }
      history.push(...recentMessages)

      rebaseTurnInfoAfterHistoryRewrite(
        sessionId,
        oldHistoryLength - keepRecent,
        history.length - recentMessages.length,
        history.length,
      )

      event.sender.send('claude-stream-data', sessionId, JSON.stringify({
        type: 'text',
        content: `\n[系统: 已自动生成摘要并压缩上下文（${toSummarize.length} 条消息 → 摘要）]\n`,
      }))
    } catch {
      // 摘要失败时回退到简单截断：从头部逐条移除，保留最近消息
      let shiftedInFallback = 0
      while (history.length > 2 && estimateChars(history) > MAX_CONTEXT_CHARS) {
        history.shift()
        shiftedInFallback++
      }
      // 确保首条消息是 user role（Anthropic API 要求）
      while (history.length > 0 && history[0].role !== 'user') {
        history.shift()
        shiftedInFallback++
      }
      if (shiftedInFallback > 0) {
        rebaseTurnInfoAfterHistoryRewrite(sessionId, shiftedInFallback, 0, history.length)
      }
      event.sender.send('claude-stream-data', sessionId, JSON.stringify({
        type: 'text',
        content: '\n[系统: 自动摘要失败，已截断早期消息]\n',
      }))
    }
  }

  // 兜底：如果摘要后仍超限，从头部逐条移除
  let shiftedBySizeLimit = 0
  while (history.length > 2 && estimateChars(history) > MAX_CONTEXT_CHARS) {
    history.shift()
    shiftedBySizeLimit++
  }
  // 确保首条消息是 user role
  let shiftedByRoleFix = 0
  while (history.length > 0 && history[0].role !== 'user') {
    history.shift()
    shiftedByRoleFix++
  }

  const shiftedCount = shiftedBySizeLimit + shiftedByRoleFix
  if (shiftedCount > 0) {
    rebaseTurnInfoAfterHistoryRewrite(sessionId, shiftedCount, 0, history.length)
    event.sender.send('claude-stream-data', sessionId, JSON.stringify({
      type: 'text',
      content: `\n[系统: 已重建回滚索引（历史头部裁剪 ${shiftedCount} 条）]\n`,
    }))
  }

  // 优化：将非最新消息中的图片 base64 替换为占位文本，节省大量 token
  for (let i = 0; i < history.length - 1; i++) {
    const msg = history[i]
    if (typeof msg.content !== 'string' && Array.isArray(msg.content)) {
      let hasImage = false
      for (const block of msg.content) {
        if (block.type === 'image' && 'source' in block) {
          hasImage = true
          break
        }
      }
      if (hasImage) {
        history[i] = {
          ...msg,
          content: (msg.content as ContentBlock[]).map(block => {
            if (block.type === 'image' && 'source' in block) {
              return { type: 'text', text: '[图片已省略以节省上下文]' } as ContentBlockText
            }
            return block
          }),
        }
      }
    }
  }

  const customSysPrompt = (typeof payload === 'string' ? undefined : payload.customSystemPrompt) || undefined
  const useClaudeCodePrompt = (typeof payload === 'string' ? false : payload.useClaudeCodePrompt) || false
  const maxTokens = (typeof payload === 'string' ? 8192 : payload.maxTokens) || 8192
  const systemPrompt = buildSystemPrompt(cwd, customSysPrompt, useClaudeCodePrompt)

  try {
    let round = 0
    while (round < MAX_TOOL_ROUNDS) {
      if (abortCtrl.aborted) {
        event.sender.send('claude-stream-end', sessionId, 0)
        break
      }

      round++
      const orderedBlocks: ContentBlock[] = []

      // 通知前端当前轮次
      if (round > 1) {
        event.sender.send('claude-stream-data', sessionId, JSON.stringify({
          type: 'round',
          round,
        }))
      }

      // 按流式事件顺序追加文本/工具块（保持原始交错顺序）
      const appendText = (text: string) => {
        const last = orderedBlocks[orderedBlocks.length - 1]
        if (last && last.type === 'text') {
          (last as ContentBlockText).text += text
        } else {
          orderedBlocks.push({ type: 'text', text })
        }
        event.sender.send('claude-stream-data', sessionId, JSON.stringify({ type: 'text', content: text }))
      }

      const appendToolUse = (id: string, name: string, input: ToolInput) => {
        orderedBlocks.push({ type: 'tool_use', id, name, input })
        event.sender.send('claude-stream-data', sessionId, JSON.stringify({
          type: 'tool_call',
          toolId: id,
          toolName: name,
          input,
        }))
      }

      const appendImage = (url: string, alt?: string) => {
        event.sender.send('claude-stream-data', sessionId, JSON.stringify({
          type: 'image',
          url,
          alt,
        }))
      }

      const reportUsage = (inputTokens: number, outputTokens: number) => {
        event.sender.send('claude-stream-data', sessionId, JSON.stringify({
          type: 'usage',
          inputTokens,
          outputTokens,
        }))
      }

      let streamResult: { stopReason: string | null; contentBlocks: ContentBlock[] } | null = null

      // 带重试的流式调用（最多重试 2 次，对 5xx / 网络错误 / 429）
      const MAX_RETRIES = 2
      let lastError: Error | null = null
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (abortCtrl.aborted) break
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
          event.sender.send('claude-stream-data', sessionId, JSON.stringify({
            type: 'text',
            content: `\n[系统: API 请求失败，${delay / 1000}s 后重试 (${attempt}/${MAX_RETRIES})...]\n`,
          }))
          await new Promise(r => setTimeout(r, delay))
          if (abortCtrl.aborted) break
          // 重试时清空本轮已收集的 blocks（避免重复）
          orderedBlocks.length = 0
        }
        try {
          if (apiConfig.format === 'openai') {
            streamResult = await callOpenAIStream(
              history, systemPrompt, model, apiConfig, abortCtrl,
              appendText, appendToolUse, appendImage, reportUsage, maxTokens,
            )
          } else {
            const body = JSON.stringify({
              model, max_tokens: maxTokens, stream: true,
              system: systemPrompt, tools: TOOLS_ANTHROPIC, messages: history,
            })
            streamResult = await callAnthropicStream(
              body, apiConfig, abortCtrl,
              appendText, appendToolUse, appendImage, reportUsage,
            )
          }
          lastError = null
          break // 成功，跳出重试循环
        } catch (err) {
          lastError = err as Error
          const msg = lastError.message || ''
          // 仅对 5xx、429、网络错误重试
          const isRetryable = /5\d{2}|429|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|超时/i.test(msg)
          if (!isRetryable || attempt >= MAX_RETRIES) {
            throw lastError
          }
        }
      }
      if (abortCtrl.aborted && !streamResult) {
        event.sender.send('claude-stream-end', sessionId, 0)
        break
      }

      if (!streamResult) {
        // 一般只会发生在中途被 abort（或极端情况下未能成功发起请求）
        if (lastError) throw lastError
        event.sender.send('claude-stream-end', sessionId, 1)
        break
      }

      const { stopReason } = streamResult

      // 合入 stream 中发现的额外 blocks（安全网）
      for (const block of streamResult.contentBlocks) {
        if (block.type === 'tool_use' && !orderedBlocks.find((b) => b.type === 'tool_use' && (b as ContentBlockToolUse).id === block.id)) {
          orderedBlocks.push(block)
        }
      }

      // 按原始顺序构建 assistant 消息
      if (orderedBlocks.length > 0) {
        history.push({ role: 'assistant', content: orderedBlocks })
      }

      // 提取工具调用
      const allToolUses = orderedBlocks.filter((b): b is ContentBlockToolUse => b.type === 'tool_use')

      // 如果没有工具调用，完成
      if (stopReason !== 'tool_use' || allToolUses.length === 0) {
        break
      }

      // 执行所有工具调用并回传结果
      if (abortCtrl.aborted) break

      const toolResults: ContentBlockToolResult[] = []

      for (const tu of allToolUses) {
        if (abortCtrl.aborted) break

        // 非只读工具需要用户确认（除非 skipPermissions）
        // skipPermissions 模式下，仍需拦截高危命令（如 rm -rf /）
        let approved = true
        const toolSafe = isToolSafe(tu.name, tu.input)
        const isDangerous = tu.name === 'bash' && tu.input.command && isDangerousCommand(tu.input.command)
        if (!toolSafe && (!skipPermissions || isDangerous)) {
          const confirmId = `confirm-${Date.now()}-${tu.id}`
          approved = await requestToolConfirmation(event.sender, sessionId, confirmId, tu.name, tu.input)
        }

        if (!approved) {
          event.sender.send('claude-stream-data', sessionId, JSON.stringify({
            type: 'tool_result',
            toolId: tu.id,
            toolName: tu.name,
            output: '[用户拒绝执行此操作]',
            isError: true,
          }))
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: '[error] 用户拒绝执行此操作',
          })
          continue
        }

        const result = await executeTool(tu.name, tu.input, cwd, abortCtrl, {
          sessionId,
          turnNumber: currentTurn,
          toolId: tu.id,
        }, saveSnapshot)

        const shortResult = result.length > 2000
          ? result.slice(0, 2000) + '\n... (output truncated in display)'
          : result
        event.sender.send('claude-stream-data', sessionId, JSON.stringify({
          type: 'tool_result',
          toolId: tu.id,
          toolName: tu.name,
          output: shortResult,
          isError: result.startsWith('[error]'),
        }))

        // 截断过长工具结果以节省上下文窗口（API 侧不需要完整输出）
        const MAX_TOOL_RESULT_CHARS = 8000
        const historyResult = result.length > MAX_TOOL_RESULT_CHARS
          ? result.slice(0, MAX_TOOL_RESULT_CHARS) + `\n... (output truncated, original ${result.length} chars)`
          : result
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: historyResult,
        })
      }

      // 把工具结果作为 user 消息加入历史
      history.push({ role: 'user', content: toolResults })
    }

    // 记录本轮结束时的 history 长度（用于回滚时精确截断）
    turnInfo.turnEndHistoryIndex.set(currentTurn, history.length)
    recomputeMinRollbackTurn(sessionId)

    if (!abortCtrl.aborted && round >= MAX_TOOL_ROUNDS) {
      activeAbortControllers.delete(sessionId)
      setSessionPhase(sessionId, 'idle')
      const roundLimitError = `工具调用轮次达到上限 (${MAX_TOOL_ROUNDS})，任务已终止`
      event.sender.send('claude-stream-error', sessionId, roundLimitError)
      event.sender.send('claude-stream-end', sessionId, 1)
      return { code: 1 }
    }

    activeAbortControllers.delete(sessionId)
    setSessionPhase(sessionId, 'idle')
    event.sender.send('claude-stream-end', sessionId, 0)
    return { code: 0 }
  } catch (err) {
    // 即使出错也记录 history 端点
    turnInfo.turnEndHistoryIndex.set(currentTurn, history.length)
    recomputeMinRollbackTurn(sessionId)

    activeAbortControllers.delete(sessionId)
    setSessionPhase(sessionId, 'idle')
    event.sender.send('claude-stream-error', sessionId, (err as Error).message)
    event.sender.send('claude-stream-end', sessionId, 1)
    return { code: 1 }
  }
})

// ── 非流式执行（保留兼容，现已接入对话历史）──────────────
ipcMain.handle('claude-execute', async (_event, payload: ChatPayload) => {
  const prompt = (typeof payload === 'string' ? payload : payload.prompt) || ''
  const model = (typeof payload === 'string' ? DEFAULT_MODEL : payload.model) || DEFAULT_MODEL
  const sessionId = (typeof payload === 'string' ? 'execute-default' : payload.sessionId) || 'execute-default'
  const cwd = (typeof payload === 'string' ? '' : payload.cwd) || ''

  const apiConfig: ApiConfig = {
    endpoint: (typeof payload === 'string' ? '' : payload.apiEndpoint) || DEFAULT_API_CONFIG.endpoint,
    key: (typeof payload === 'string' ? '' : payload.apiKey) ?? DEFAULT_API_CONFIG.key,
    format: (typeof payload === 'string' ? 'anthropic' : payload.apiFormat) || DEFAULT_API_CONFIG.format,
  }

  const history = getOrCreateHistory(sessionId)
  history.push({ role: 'user', content: prompt })

  const useClaudeCodePromptExec = (typeof payload === 'string' ? false : payload.useClaudeCodePrompt) || false
  const maxTokens = (typeof payload === 'string' ? 8192 : payload.maxTokens) || 8192
  const systemPrompt = cwd ? buildSystemPrompt(cwd, undefined, useClaudeCodePromptExec) : ''

  try {
    let messages: unknown
    if (apiConfig.format === 'openai') {
      messages = convertMessagesToOpenAI(history, systemPrompt)
    } else {
      messages = history
    }

    const bodyObj: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages,
    }
    if (apiConfig.format !== 'openai' && systemPrompt) {
      bodyObj.system = systemPrompt
    }

    const body = JSON.stringify(bodyObj)
    const res = await callAPI(body, apiConfig)

    // 检查 HTTP 状态码
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { success: false, output: `API 错误 (HTTP ${res.statusCode}): ${res.data.slice(0, 500)}` }
    }

    const result = JSON.parse(res.data)

    // 适配 OpenAI 和 Anthropic 格式
    let text = ''
    if (apiConfig.format === 'openai') {
      text = result.choices?.[0]?.message?.content || ''
    } else {
      text = result.content?.[0]?.text || ''
    }

    // 将助手回复加入历史
    history.push({ role: 'assistant', content: text })

    return { success: true, output: text }
  } catch (err) {
    return { success: false, output: `错误: ${(err as Error).message}` }
  }
})

// ── 清除会话历史 ────────────────────────────────────────
ipcMain.handle('clear-history', async (_event, sessionId?: string) => {
  if (sessionId) {
    cleanupSessionResources(sessionId)
  } else {
    cleanupAllResources()
  }
  return { success: true }
})

ipcMain.handle('sync-session-history', async (_event, payload: { sessionId: string; messages: HistorySyncMessage[] }) => {
  const { sessionId, messages } = payload
  if (!sessionId) return { success: false, error: '缺少 sessionId' }
  if (!Array.isArray(messages)) return { success: false, error: 'messages 必须是数组' }

  try {
    return syncSessionHistoryFromRenderer(sessionId, messages)
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
})

// ── 回滚：恢复文件并截断对话历史 ──────────────────────
ipcMain.handle('rollback', async (_event, payload: {
  sessionId: string
  targetTurn: number  // 回滚到该轮次（保留该轮及之前，-1 表示全部回滚）
}) => {
  const { sessionId, targetTurn } = payload

  try {
    return await withSessionExclusive(sessionId, 'rollback', async () => {
      const turnInfoData = getSessionTurnInfo(sessionId)

      if (targetTurn < -1) {
        return {
          success: false,
          restored: 0,
          errors: [`无效的目标轮次: ${targetTurn}`],
          retainedSnapshots: 0,
        }
      }

      if (turnInfoData && targetTurn >= 0 && targetTurn < turnInfoData.minRollbackTurn) {
        return {
          success: false,
          restored: 0,
          errors: [`目标轮次 ${targetTurn} 早于可精确回滚下界 ${turnInfoData.minRollbackTurn}`],
          retainedSnapshots: getSnapshots(sessionId).filter(s => s.turnNumber > targetTurn).length,
          minRollbackTurn: turnInfoData.minRollbackTurn,
        }
      }

      // 1. 先校验 history 索引，再执行快照恢复，避免“文件已回滚但历史未截断”
      const history = conversationHistories.get(sessionId)
      let validatedEndIndex: number | null = null

      if (history && turnInfoData) {
        if (targetTurn >= 0) {
          const endIndex = turnInfoData.turnEndHistoryIndex.get(targetTurn)
          if (endIndex === undefined) {
            return {
              success: false,
              restored: 0,
              errors: [`轮次 ${targetTurn} 的历史索引不存在，无法精确回滚`],
              retainedSnapshots: getSnapshots(sessionId).filter(s => s.turnNumber > targetTurn).length,
              minRollbackTurn: turnInfoData.minRollbackTurn,
            }
          }
          if (endIndex < 0 || endIndex > history.length) {
            return {
              success: false,
              restored: 0,
              errors: [`轮次 ${targetTurn} 的历史索引越界: ${endIndex} / ${history.length}`],
              retainedSnapshots: getSnapshots(sessionId).filter(s => s.turnNumber > targetTurn).length,
              minRollbackTurn: turnInfoData.minRollbackTurn,
            }
          }
          validatedEndIndex = endIndex
        }
      }

      // 2. 恢复文件快照
      const { restored, errors, retainedSnapshots } = rollbackSnapshots(sessionId, targetTurn)

      // 3. 截断对话历史（使用 turnEndHistoryIndex 精确定位）
      if (history && turnInfoData) {
        if (targetTurn < 0) {
          // 全部回滚：清空 history
          history.length = 0
        } else if (validatedEndIndex !== null) {
          history.length = validatedEndIndex
        }

        // 清理已回滚轮次的记录
        for (const [turn] of turnInfoData.turnEndHistoryIndex) {
          if (turn > targetTurn) {
            turnInfoData.turnEndHistoryIndex.delete(turn)
          }
        }
        turnInfoData.currentTurn = targetTurn
        recomputeMinRollbackTurn(sessionId)
      }

      return {
        success: true,
        restored,
        errors,
        retainedSnapshots,
        minRollbackTurn: turnInfoData?.minRollbackTurn,
      }
    })
  } catch (err) {
    return {
      success: false,
      restored: 0,
      errors: [(err as Error).message],
      retainedSnapshots: 0,
    }
  }
})

// ── 单文件恢复：仅恢复/删除指定文件，不影响其他文件或对话历史 ─────────
ipcMain.handle('restore-file', async (_event, payload: { sessionId: string; filePath: string }) => {
  const { sessionId, filePath } = payload

  try {
    return await withSessionExclusive(sessionId, 'restore', async () => {
      const snapshots = getSnapshots(sessionId)
      const related = snapshots.filter(s => s.filePath === filePath)

      if (related.length === 0) {
        return { success: false, error: '未找到该文件的快照记录' }
      }

      // 最早的快照即“第一次修改前”的状态
      related.sort((a, b) => a.turnNumber - b.turnNumber)
      const base = related[0]

      try {
        if (base.existed && base.content !== null) {
          const dir = path.dirname(base.filePath)
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
          fs.writeFileSync(base.filePath, base.content, 'utf-8')
        } else if (!base.existed) {
          if (fs.existsSync(base.filePath)) fs.unlinkSync(base.filePath)
        }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }

      // 移除该文件相关快照（表示这些变更已被“手动撤销”）
      deleteSnapshots(sessionId)
      const remaining = snapshots.filter(s => s.filePath !== filePath)
      for (const snap of remaining) saveSnapshot(sessionId, snap)

      return {
        success: true,
        removedSnapshots: related.length,
        filePath,
      }
    })
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
})

// ── 查询快照信息（供前端判断哪些消息可回滚）──────────
ipcMain.handle('get-snapshots', async (_event, sessionId: string) => {
  const snapshots = getSnapshots(sessionId)
  // 只返回摘要信息，不返回文件内容
  return snapshots.map(s => ({
    filePath: s.filePath,
    toolName: s.toolName,
    toolId: s.toolId,
    turnNumber: s.turnNumber,
    existed: s.existed,
  }))
})
