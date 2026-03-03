import { autoUpdater } from 'electron-updater'
import { BrowserWindow, ipcMain } from 'electron'

let mainWin: BrowserWindow | null = null
let listenersRegistered = false
let handlersRegistered = false
let periodicCheckTimer: NodeJS.Timeout | null = null
let isCheckingForUpdates = false

async function checkForUpdatesSafely() {
  if (isCheckingForUpdates) return null
  isCheckingForUpdates = true
  try {
    return await autoUpdater.checkForUpdates()
  } finally {
    isCheckingForUpdates = false
  }
}

export function initAutoUpdater(win: BrowserWindow) {
  mainWin = win

  // 不自动下载，先通知用户
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  if (!listenersRegistered) {
    listenersRegistered = true

    autoUpdater.on('checking-for-update', () => {
      sendToRenderer('update-status', { status: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      sendToRenderer('update-status', {
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes,
      })
    })

    autoUpdater.on('update-not-available', () => {
      sendToRenderer('update-status', { status: 'up-to-date' })
    })

    autoUpdater.on('download-progress', (progress) => {
      sendToRenderer('update-status', {
        status: 'downloading',
        percent: Math.round(progress.percent),
      })
    })

    autoUpdater.on('update-downloaded', () => {
      sendToRenderer('update-status', { status: 'downloaded' })
    })

    autoUpdater.on('error', (err) => {
      sendToRenderer('update-status', {
        status: 'error',
        error: err.message,
      })
    })
  }

  if (!handlersRegistered) {
    handlersRegistered = true

    // IPC: 前端触发检查更新
    ipcMain.handle('check-for-update', async () => {
      try {
        const result = await checkForUpdatesSafely()
        return { success: true, version: result?.updateInfo?.version, checking: result === null }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    })

    // IPC: 前端触发下载更新
    ipcMain.handle('download-update', async () => {
      try {
        await autoUpdater.downloadUpdate()
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    })

    // IPC: 前端触发安装更新（重启）
    ipcMain.handle('install-update', () => {
      try {
        autoUpdater.quitAndInstall(false, true)
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    })
  }

  // 启动后 10 秒自动检查一次
  setTimeout(() => {
    checkForUpdatesSafely().catch(() => {})
  }, 10_000)

  // 之后每 30 分钟自动检查一次
  if (!periodicCheckTimer) {
    periodicCheckTimer = setInterval(() => {
      checkForUpdatesSafely().catch(() => {})
    }, 30 * 60 * 1000)
  }
}

function sendToRenderer(channel: string, data: unknown) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send(channel, data)
  }
}
