import { contextBridge, ipcRenderer } from 'electron'
import type { ChatPayload } from './shared-types'

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // 聊天
  execute: (payload: ChatPayload) => ipcRenderer.invoke('claude-execute', payload),
  stream: (payload: ChatPayload) => ipcRenderer.invoke('claude-stream', payload),
  stopStream: (sessionId?: string) => ipcRenderer.invoke('claude-stream-stop', sessionId),
  clearHistory: (sessionId?: string) => ipcRenderer.invoke('clear-history', sessionId),
  syncSessionHistory: (payload: {
    sessionId: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  }) => ipcRenderer.invoke('sync-session-history', payload),
  confirmTool: (confirmId: string, approved: boolean) =>
    ipcRenderer.invoke('tool-confirm-response', confirmId, approved),

  // 文件夹选择
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // 文件选择（附加到对话）
  selectFiles: () => ipcRenderer.invoke('select-files'),

  // Git
  getGitStatus: (cwd?: string) => ipcRenderer.invoke('git-status', cwd),

  // 连接检测
  checkApiConnection: (config: { endpoint: string; key: string; format: string }) =>
    ipcRenderer.invoke('check-api-connection', config),

  // MCP 测试
  testMcpConnection: (config: { command: string; args: string; env?: Record<string, string> }) =>
    ipcRenderer.invoke('test-mcp-connection', config),

  // 对话导出
  exportChat: (data: { messages: unknown[]; title: string; model: string }) =>
    ipcRenderer.invoke('export-chat', data),

  // 对话导入
  importChat: () => ipcRenderer.invoke('import-chat'),

  // 回滚
  rollback: (payload: { sessionId: string; targetTurn: number }) =>
    ipcRenderer.invoke('rollback', payload),
  restoreFile: (payload: { sessionId: string; filePath: string }) =>
    ipcRenderer.invoke('restore-file', payload),
  getSnapshots: (sessionId: string) =>
    ipcRenderer.invoke('get-snapshots', sessionId),

  // 目录树和文件读取
  listDirectory: (root: string, dirPath?: string, showHidden?: boolean) =>
    ipcRenderer.invoke('list-directory', { root, dirPath, showHidden }),
  readFileContent: (root: string, filePath: string) =>
    ipcRenderer.invoke('read-file-content', { root, filePath }),
  writeFileContent: (root: string, filePath: string, content: string) =>
    ipcRenderer.invoke('write-file-content', { root, filePath, content }),

  // 外部链接 / 本地文件打开
  openExternal: (payload: { target: string; root?: string }) => ipcRenderer.invoke('open-external', payload),

  // 桌面通知
  showNotification: (title: string, body: string) =>
    ipcRenderer.invoke('show-notification', { title, body }),

  // 安全存储（加密 API Key）
  secureStoreSet: (key: string, value: string) =>
    ipcRenderer.invoke('secure-store-set', key, value),
  secureStoreGet: (key: string) =>
    ipcRenderer.invoke('secure-store-get', key),
  secureStoreDelete: (key: string) =>
    ipcRenderer.invoke('secure-store-delete', key),

  // 应用版本 & 自动更新
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback: (data: {
    status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
    version?: string
    releaseNotes?: unknown
    percent?: number
    error?: string
  }) => void) => {
    ipcRenderer.removeAllListeners('update-status')
    ipcRenderer.on('update-status', (_event, data) => callback(data))
  },
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-status')
  },

  // 流式事件（每次注册前先移除旧监听器，防止累积泄漏）
  // 所有回调第一个参数为 sessionId，支持多会话并行
  onStreamData: (callback: (sessionId: string, data: string) => void) => {
    ipcRenderer.removeAllListeners('claude-stream-data')
    ipcRenderer.on('claude-stream-data', (_event, sessionId: string, data: string) => callback(sessionId, data))
  },
  onStreamError: (callback: (sessionId: string, error: string) => void) => {
    ipcRenderer.removeAllListeners('claude-stream-error')
    ipcRenderer.on('claude-stream-error', (_event, sessionId: string, error: string) => callback(sessionId, error))
  },
  onStreamEnd: (callback: (sessionId: string, code: number) => void) => {
    ipcRenderer.removeAllListeners('claude-stream-end')
    ipcRenderer.on('claude-stream-end', (_event, sessionId: string, code: number) => callback(sessionId, code))
  },
  removeStreamListeners: () => {
    ipcRenderer.removeAllListeners('claude-stream-data')
    ipcRenderer.removeAllListeners('claude-stream-error')
    ipcRenderer.removeAllListeners('claude-stream-end')
  },
})
