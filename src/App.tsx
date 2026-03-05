import { useState, useEffect, useCallback } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { useAppSettings } from './hooks/useAppSettings'
import Sidebar from './components/Sidebar'
import ChatPanel from './components/Chat/ChatPanel'
import CommandPanel from './components/Commands/CommandPanel'
import ToolsPanel from './components/Tools/ToolsPanel'
import SettingsPanel from './components/Settings/SettingsPanel'
import FileBrowserPanel from './components/FileBrowser/FileBrowserPanel'
import SessionArchivePanel from './components/SessionArchive/SessionArchivePanel'
import DataAnalysisPanel from './components/Analytics/DataAnalysisPanel'

type Panel = 'chat' | 'commands' | 'tools' | 'settings' | 'files' | 'history' | 'analytics'

const SHORTCUTS = [
  { keys: 'Ctrl+N', desc: '新建会话' },
  { keys: 'Ctrl+L', desc: '清除对话' },
  { keys: 'Ctrl+E', desc: '导出对话' },
  { keys: 'Ctrl+F', desc: '搜索消息' },
  { keys: 'Ctrl+,', desc: '打开设置' },
  { keys: 'Ctrl+1~7', desc: '切换面板' },
  { keys: 'Ctrl+/', desc: '快捷键帮助' },
  { keys: 'Esc', desc: '停止当前任务' },
  { keys: 'Enter', desc: '发送消息' },
  { keys: 'Shift+Enter', desc: '换行' },
]

function App() {
  const [activePanel, setActivePanel] = useState<Panel>('chat')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const { settings } = useAppSettings()

  // 同步主题 class 到 document
  useEffect(() => {
    const root = document.documentElement
    if (settings.chatTheme === 'light') {
      root.classList.add('theme-light')
    } else {
      root.classList.remove('theme-light')
    }
  }, [settings.chatTheme])

  const handleWindowControl = (action: 'minimize' | 'maximize' | 'close') => {
    if (window.electronAPI) {
      switch (action) {
        case 'minimize':
          window.electronAPI.minimize()
          break
        case 'maximize':
          window.electronAPI.maximize()
          break
        case 'close':
          window.electronAPI.close()
          break
      }
    }
  }

  // ── 全局键盘快捷键 ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey

      if (!isCtrl) {
        // Escape — 停止当前任务
        if (e.key === 'Escape') {
          window.dispatchEvent(new CustomEvent('app:stop'))
          return
        }
        return
      }

      // Ctrl+N — 新建会话
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('app:new-session'))
        setActivePanel('chat')
        return
      }

      // Ctrl+L — 清除对话
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('app:clear'))
        return
      }

      // Ctrl+, — 打开设置
      if (e.key === ',') {
        e.preventDefault()
        setActivePanel('settings')
        return
      }

      // Ctrl+E — 导出对话
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('app:export'))
        return
      }

      // Ctrl+F — 搜索消息
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('app:search'))
        setActivePanel('chat')
        return
      }

      // Ctrl+/ — 快捷键参考
      if (e.key === '/' || e.key === '?') {
        e.preventDefault()
        setShowShortcuts((prev) => !prev)
        return
      }

      // Ctrl+1~7 — 面板切换
      const panels: Panel[] = ['chat', 'files', 'history', 'commands', 'tools', 'analytics', 'settings']
      const num = parseInt(e.key)
      if (num >= 1 && num <= 7) {
        e.preventDefault()
        setActivePanel(panels[num - 1])
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // CommandPanel 的回调
  const handleCommandClear = useCallback(() => {
    window.dispatchEvent(new CustomEvent('app:clear'))
    setActivePanel('chat')
  }, [])

  const handleCommandSwitchPanel = useCallback((panel: string) => {
    if (['chat', 'commands', 'tools', 'settings', 'files', 'history', 'analytics'].includes(panel)) {
      setActivePanel(panel as Panel)
    }
  }, [])

  const handleSwitchToSession = useCallback((sessionId: string) => {
    setActivePanel('chat')
    // 通过自定义事件通知 ChatPanel 切换到指定会话
    window.dispatchEvent(new CustomEvent('app:switch-session', { detail: sessionId }))
  }, [])

  return (
    <div className="h-screen flex flex-col bg-claude-bg">
      {/* Title Bar */}
      <div className="titlebar h-11 bg-claude-surface/80 backdrop-blur-md flex items-center justify-between px-4 border-b border-claude-border/60">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-claude-primary"></div>
          <span className="text-[13px] font-semibold text-claude-text tracking-wide">Claude Code</span>
          <span className="text-[10px] text-claude-accent font-mono">GUI</span>
        </div>
        <div className="flex items-center">
          <button
            onClick={() => handleWindowControl('minimize')}
            className="w-10 h-8 flex items-center justify-center hover:bg-[var(--c-white-alpha-4)] rounded transition-colors"
          >
            <Minus size={14} className="text-claude-text-muted" />
          </button>
          <button
            onClick={() => handleWindowControl('maximize')}
            className="w-10 h-8 flex items-center justify-center hover:bg-[var(--c-white-alpha-4)] rounded transition-colors"
          >
            <Square size={11} className="text-claude-text-muted" />
          </button>
          <button
            onClick={() => handleWindowControl('close')}
            className="w-10 h-8 flex items-center justify-center hover:bg-red-500/20 rounded transition-colors group"
          >
            <X size={14} className="text-claude-text-muted group-hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* Main Content — 所有面板始终挂载，用 display 控制可见性，防止切换时丢失流式数据 */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar activePanel={activePanel} onPanelChange={setActivePanel} />
        <main className="flex-1 overflow-hidden relative">
          <div className={`absolute inset-0 ${activePanel === 'chat' ? '' : 'hidden'}`}>
            <ChatPanel isActive={activePanel === 'chat'} />
          </div>
          <div className={`absolute inset-0 ${activePanel === 'commands' ? '' : 'hidden'}`}>
            <CommandPanel
              onClearChat={handleCommandClear}
              onSwitchPanel={handleCommandSwitchPanel}
            />
          </div>
          <div className={`absolute inset-0 ${activePanel === 'tools' ? '' : 'hidden'}`}>
            <ToolsPanel />
          </div>
          <div className={`absolute inset-0 ${activePanel === 'settings' ? '' : 'hidden'}`}>
            <SettingsPanel />
          </div>
          <div className={`absolute inset-0 ${activePanel === 'files' ? '' : 'hidden'}`}>
            <FileBrowserPanel />
          </div>
          <div className={`absolute inset-0 ${activePanel === 'history' ? '' : 'hidden'}`}>
            <SessionArchivePanel onSwitchToSession={handleSwitchToSession} />
          </div>
          <div className={`absolute inset-0 ${activePanel === 'analytics' ? '' : 'hidden'}`}>
            <DataAnalysisPanel isActive={activePanel === 'analytics'} />
          </div>
        </main>
      </div>

      {/* 快捷键参考弹窗 */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowShortcuts(false)}>
          <div className="bg-claude-surface border border-claude-border rounded-xl p-5 max-w-sm w-full shadow-[0_8px_32px_rgba(0,0,0,0.6)]" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-claude-text mb-3">快捷键参考</h2>
            <div className="space-y-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between py-0.5">
                  <span className="text-xs text-claude-text-muted">{s.desc}</span>
                  <kbd className="px-2 py-0.5 bg-claude-bg/80 border border-claude-border/50 rounded-md text-[11px] font-mono text-claude-text">{s.keys}</kbd>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowShortcuts(false)}
              className="mt-4 w-full py-1.5 bg-claude-surface-light/50 hover:bg-claude-surface-light rounded-lg text-xs text-claude-text-muted hover:text-claude-text transition-colors"
            >
              关闭 (Ctrl+/)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
