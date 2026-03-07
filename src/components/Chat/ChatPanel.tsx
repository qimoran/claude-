import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Plus, X, Download, Upload, Search, MessageSquare, FileText, MoreHorizontal, Trash2, GitBranch, FolderOpen, Sun, Moon } from 'lucide-react'
import { useClaudeCode } from '../../hooks/useClaudeCode'
import MessageList from './MessageList'
import InputArea from './InputArea'
import FileChangesPanel from './FileChangesPanel'
import { useAppSettings } from '../../hooks/useAppSettings'
import { formatTokens, formatCost } from '../../utils/pricing'

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '--'
  if (ms < 1000) return `${ms}ms`
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

interface ChatPanelProps {
  isActive?: boolean
}

export default function ChatPanel({ isActive = true }: ChatPanelProps) {
  const {
    messages,
    isLoading,
    error,
    streamBlocks,
    sendMessage,
    importSessionMessages,
    clearMessages,
    sessions,
    activeSessionId,
    activeSessionModel,
    sessionUsage,
    createSession,
    switchSession,
    closeSession,
    setActiveSessionModel,
    toggleAutoIncludeGitStatus,
    refreshGitStatus,
    stopCurrentTask,
    confirmTool,
    resetUsage,
    editMessage,
    regenerateMessage,
    rollbackToMessage,
    rollbackToTurn,
    setCustomSystemPrompt,
    activeSessionCustomSystemPrompt,
    activeSessionCwd,
    setActiveSessionCwd,
    loadingSessions,
    rollbackingSessions,
    plannedRouting,
    lastRouting,
  } = useClaudeCode()

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const isRollbacking = rollbackingSessions.has(activeSessionId)
  const { settings, updateSettings, saveSettings } = useAppSettings()

  const toggleTheme = useCallback(() => {
    const next = settings.chatTheme === 'dark' ? 'light' : 'dark'
    updateSettings({ chatTheme: next })
    saveSettings({ chatTheme: next })
  }, [settings.chatTheme, updateSettings, saveSettings])

  // ── 系统提示词编辑 ──
  const [showSysPrompt, setShowSysPrompt] = useState(false)
  const [sysPromptDraft, setSysPromptDraft] = useState('')

  // ── 文件变更面板 ──
  const [showFileChanges, setShowFileChanges] = useState(false)

  // ── 消息搜索 ──
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // 切换会话时：关闭弹出面板、清空搜索
  const prevSessionIdRef = useRef(activeSessionId)
  useEffect(() => {
    if (prevSessionIdRef.current !== activeSessionId) {
      prevSessionIdRef.current = activeSessionId
      setShowMoreMenu(false)
      setShowSearch(false)
      setSearchQuery('')
      setShowSysPrompt(false)
    }
  }, [activeSessionId])

  const filteredMessages = useMemo(() => (
    searchQuery.trim()
      ? messages.filter((m) => {
        const q = searchQuery.toLowerCase()
        // 纯文本内容
        if (m.content.toLowerCase().includes(q)) return true
        // 从 blocks 中提取文本搜索
        if (m.blocks) {
          for (const b of m.blocks) {
            if (b.type === 'text' && b.content.toLowerCase().includes(q)) return true
            if (b.type === 'tool_result' && b.output?.toLowerCase().includes(q)) return true
          }
        }
        return false
      })
      : messages
  ), [messages, searchQuery])

  const searchMatchCount = searchQuery.trim() ? filteredMessages.length : 0

  // ── 连接状态 ──
  const [connStatus, setConnStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown')
  const [connLatency, setConnLatency] = useState(0)

  const checkConnection = useCallback(async () => {
    if (!window.electronAPI) {
      setConnStatus('disconnected')
      return
    }

    const routingKey = plannedRouting.keySource
    const routingKeyValue = routingKey === '中转站'
      ? settings.thirdApiKey
      : routingKey === '备用端点'
        ? settings.altApiKey
        : settings.apiKey

    try {
      const result = await window.electronAPI.checkApiConnection({
        endpoint: plannedRouting.endpoint,
        key: routingKeyValue,
        format: plannedRouting.apiFormat,
      })
      if (result.connected) {
        setConnStatus('connected')
        setConnLatency(result.latency)
      } else {
        setConnStatus('disconnected')
      }
    } catch {
      setConnStatus('disconnected')
    }
  }, [
    plannedRouting.endpoint,
    plannedRouting.keySource,
    plannedRouting.apiFormat,
    settings.apiKey,
    settings.altApiKey,
    settings.thirdApiKey,
  ])

  // 初次挂载及每 30 秒检测
  useEffect(() => {
    checkConnection()
    const interval = setInterval(checkConnection, 30_000)
    return () => clearInterval(interval)
  }, [checkConnection])

  // ── 导出对话 ──
  const handleExport = useCallback(async () => {
    if (!window.electronAPI || messages.length === 0) return
    const exportMessages = messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      blocks: msg.blocks.map((b) => {
        if (b.type === 'text') return { type: 'text', content: b.content }
        if (b.type === 'image') return { type: 'image', content: b.url }
        if (b.type === 'tool_call') return { type: 'tool_call', toolName: b.toolName, input: b.input }
        if (b.type === 'tool_result') return { type: 'tool_result', toolName: b.toolName, output: b.output }
        if (b.type === 'round') return { type: 'round', round: b.round }
        return { type: b.type }
      }),
      timestamp: msg.timestamp.toISOString(),
    }))

    await window.electronAPI.exportChat({
      messages: exportMessages,
      title: activeSession?.title || '对话',
      model: activeSessionModel,
    })
  }, [messages, activeSession?.title, activeSessionModel])

  // ── 会话导入 ──
  const handleImport = useCallback(async () => {
    if (!window.electronAPI) return
    const result = await window.electronAPI.importChat()
    if (!result.success || !result.content) return

    const importedMessages: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: string }> = []

    if (result.format === 'json') {
      try {
        const parsed = JSON.parse(result.content)
        const jsonMessages = Array.isArray(parsed)
          ? parsed
          : (Array.isArray(parsed?.messages) ? parsed.messages : [])

        for (const item of jsonMessages) {
          if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue
          const content = typeof item.content === 'string' ? item.content : ''
          if (!content.trim()) continue
          importedMessages.push({
            role: item.role,
            content,
            timestamp: typeof item.timestamp === 'string' ? item.timestamp : undefined,
          })
        }
      } catch {
        // JSON 解析失败，回退到 Markdown/纯文本解析
      }
    }

    // Markdown / 回退解析
    if (importedMessages.length === 0) {
      const sections = result.content.split(/^## /m).filter(Boolean)
      for (const section of sections) {
        const lines = section.split('\n')
        const header = lines[0] || ''
        const body = lines.slice(1).join('\n').replace(/^---\s*$/m, '').trim()
        if (!body) continue

        if (header.startsWith('用户')) {
          importedMessages.push({ role: 'user', content: body })
        } else if (header.startsWith('Claude')) {
          importedMessages.push({ role: 'assistant', content: body })
        }
      }
    }

    if (importedMessages.length === 0) {
      importedMessages.push({ role: 'user', content: result.content })
    }

    const title = result.fileName?.replace(/\.[^.]+$/, '') || '导入的对话'
    importSessionMessages(importedMessages, title)
  }, [importSessionMessages])

  // ── 监听全局快捷键事件（来自 App.tsx）──
  useEffect(() => {
    const onNewSession = () => createSession()
    const onClear = () => { clearMessages(); resetUsage() }
    const onExport = () => { handleExport() }
    const onStop = () => stopCurrentTask()
    const onSearch = () => {
      setShowSearch((prev) => {
        if (!prev) setTimeout(() => searchInputRef.current?.focus(), 50)
        return !prev
      })
    }

    const onSwitchSession = (e: Event) => {
      const sessionId = (e as CustomEvent).detail
      if (sessionId) switchSession(sessionId)
    }

    window.addEventListener('app:new-session', onNewSession)
    window.addEventListener('app:clear', onClear)
    window.addEventListener('app:export', onExport)
    window.addEventListener('app:stop', onStop)
    window.addEventListener('app:search', onSearch)
    window.addEventListener('app:switch-session', onSwitchSession)

    return () => {
      window.removeEventListener('app:new-session', onNewSession)
      window.removeEventListener('app:clear', onClear)
      window.removeEventListener('app:export', onExport)
      window.removeEventListener('app:stop', onStop)
      window.removeEventListener('app:search', onSearch)
      window.removeEventListener('app:switch-session', onSwitchSession)
    }
  }, [createSession, clearMessages, resetUsage, handleExport, stopCurrentTask, switchSession])

  // 广播会话级工作目录变化，供 FileBrowserPanel 等消费
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('app:cwd-change', { detail: activeSessionCwd }))
  }, [activeSessionCwd])

  // 模型选项：从 settings.models 动态生成 + "跟随全局" 选项
  const modelOptions = [
    { value: '', label: '跟随全局设置' },
    ...settings.models.map((m) => ({
      value: m.modelId,
      label: `${m.name}`,
    })),
  ]

  const hasUsageStats = sessionUsage.requestCount > 0 || sessionUsage.totalDurationMs > 0

  // ── 更多操作下拉菜单 ──
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showMoreMenu) return
    const handler = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setShowMoreMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMoreMenu])

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* 顶部工具栏 */}
      <div className="px-3 py-1.5 border-b border-claude-border/50 flex items-center gap-1.5 bg-claude-surface/30" style={{ fontSize: `${settings.fontSizeUI}px` }}>
        {/* 连接状态 */}
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${connStatus === 'connected' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]'
            : connStatus === 'disconnected' ? 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.4)]'
              : 'bg-claude-text-muted animate-pulse'
            }`}
          title={connStatus === 'connected'
            ? `已连接 (${connLatency}ms) | ${plannedRouting.keySource} ${plannedRouting.endpoint}`
            : connStatus === 'disconnected'
              ? `无法连接 API 端点 (${plannedRouting.keySource} ${plannedRouting.endpoint})`
              : '检测中...'
          }
        />

        {/* 会话选择器 */}
        <select
          value={activeSessionId}
          onChange={(e) => switchSession(e.target.value)}
          className="bg-transparent border border-claude-border/50 rounded-md px-2 py-1 text-xs text-claude-text min-w-[100px] max-w-[160px] focus:outline-none focus:border-claude-primary/50 transition-colors"
        >
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {loadingSessions.has(session.id) ? '\u25B6 ' : ''}{session.title}
            </option>
          ))}
        </select>

        <button onClick={createSession} className="p-1 text-claude-text-muted hover:text-claude-text hover:bg-[var(--c-white-alpha-4)] rounded transition-colors" title="新建会话 (Ctrl+N)">
          <Plus size={14} />
        </button>

        <div className="w-px h-4 bg-claude-border/40 mx-0.5" />

        {/* 模型选择 */}
        <select
          value={activeSession?.model || ''}
          onChange={(e) => setActiveSessionModel(e.target.value)}
          className="bg-transparent border border-claude-border/50 rounded-md px-2 py-1 text-xs text-claude-text focus:outline-none focus:border-claude-primary/50 transition-colors"
          title={`当前模型: ${activeSessionModel}\n路由: ${plannedRouting.keySource} → ${plannedRouting.endpoint}${lastRouting ? `\n上次: ${lastRouting.keySource} → ${lastRouting.endpoint}` : ''}`}
        >
          {modelOptions.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>

        <span className="text-[10px] text-claude-text-dim truncate max-w-[160px] hidden lg:inline" title={`${activeSessionModel} | ${plannedRouting.keySource}`}>
          {activeSessionModel}
        </span>

        {/* 靠右区域 */}
        <div className="ml-auto flex items-center gap-0.5">
          {/* Token 用量 */}
          {hasUsageStats && (
            <span className="text-[10px] text-claude-text-dim mr-2 hidden sm:inline" title={`对话: ${sessionUsage.messageCount} | 调用: ${sessionUsage.requestCount} | 输入: ${formatTokens(sessionUsage.totalInputTokens)} | 输出: ${formatTokens(sessionUsage.totalOutputTokens)} | 费用: ${formatCost(sessionUsage.totalCost)} | 耗时: ${formatDuration(sessionUsage.totalDurationMs)}${sessionUsage.lastDurationMs > 0 ? ` (最近 ${formatDuration(sessionUsage.lastDurationMs)})` : ''} | 模型耗时: ${formatDuration(sessionUsage.modelTotalDurationMs)}${sessionUsage.lastModelDurationMs > 0 ? ` (最近 ${formatDuration(sessionUsage.lastModelDurationMs)})` : ''}`}>
              {formatTokens(sessionUsage.totalInputTokens + sessionUsage.totalOutputTokens)} | {formatCost(sessionUsage.totalCost)} | {formatDuration(sessionUsage.totalDurationMs)}
            </span>
          )}

          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md transition-colors text-claude-text-muted hover:text-claude-text hover:bg-[var(--c-white-alpha-4)]"
            title={settings.chatTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            {settings.chatTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <button
            onClick={() => { setShowSearch((p) => { if (!p) setTimeout(() => searchInputRef.current?.focus(), 50); return !p }) }}
            className={`p-1.5 rounded-md transition-colors ${showSearch ? 'text-claude-primary bg-claude-primary/10' : 'text-claude-text-muted hover:text-claude-text hover:bg-[var(--c-white-alpha-4)]'}`}
            title="搜索消息 (Ctrl+F)"
          >
            <Search size={14} />
          </button>

          <button
            onClick={() => { setShowSysPrompt((p) => { if (!p) setSysPromptDraft(activeSessionCustomSystemPrompt); return !p }) }}
            className={`p-1.5 rounded-md transition-colors ${activeSessionCustomSystemPrompt ? 'text-claude-primary bg-claude-primary/10' : 'text-claude-text-muted hover:text-claude-text hover:bg-[var(--c-white-alpha-4)]'}`}
            title="自定义系统提示词"
          >
            <MessageSquare size={14} />
          </button>

          <button
            onClick={() => setShowFileChanges(p => !p)}
            className={`p-1.5 rounded-md transition-colors ${showFileChanges ? 'text-claude-primary bg-claude-primary/10' : 'text-claude-text-muted hover:text-claude-text hover:bg-[var(--c-white-alpha-4)]'}`}
            title="文件变更历史"
          >
            <FileText size={14} />
          </button>

          {/* 更多操作下拉 */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setShowMoreMenu(p => !p)}
              className="p-1.5 text-claude-text-muted hover:text-claude-text hover:bg-[var(--c-white-alpha-4)] rounded-md transition-colors"
              title="更多操作"
            >
              <MoreHorizontal size={14} />
            </button>
            {showMoreMenu && (
              <div className="dropdown-menu absolute top-full right-0 mt-1 w-48 bg-claude-surface border border-claude-border/60 rounded-xl shadow-panel z-50 py-1 backdrop-blur-md">
                <button onClick={() => { refreshGitStatus(); setShowMoreMenu(false) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-claude-text hover:bg-[var(--c-white-alpha-4)]">
                  <GitBranch size={13} /> 刷新 Git 状态
                </button>
                <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-claude-text hover:bg-[var(--c-white-alpha-4)] cursor-pointer">
                  <input type="checkbox" checked={Boolean(activeSession?.autoIncludeGitStatus)} onChange={(e) => { toggleAutoIncludeGitStatus(e.target.checked) }} className="rounded" />
                  自动附加 Git
                </label>
                <div className="border-t border-claude-border/40 my-1" />
                <button onClick={() => { handleExport(); setShowMoreMenu(false) }} disabled={messages.length === 0} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-claude-text hover:bg-[var(--c-white-alpha-4)] disabled:opacity-40">
                  <Download size={13} /> 导出对话
                </button>
                <button onClick={() => { handleImport(); setShowMoreMenu(false) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-claude-text hover:bg-[var(--c-white-alpha-4)]">
                  <Upload size={13} /> 导入对话
                </button>
                <div className="border-t border-claude-border/40 my-1" />
                <button onClick={() => { clearMessages(); resetUsage(); setShowMoreMenu(false) }} disabled={messages.length === 0} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-claude-text hover:bg-[var(--c-white-alpha-4)] disabled:opacity-40">
                  <X size={13} /> 清空消息
                </button>
                <button onClick={() => {
                  if (sessions.length <= 1) {
                    // 最后一个会话：清空内容并重置
                    clearMessages()
                    resetUsage()
                  } else {
                    closeSession(activeSessionId)
                  }
                  setShowMoreMenu(false)
                }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10">
                  <Trash2 size={13} /> 删除对话
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 搜索栏 */}
      {showSearch && (
        <div className="px-4 py-1.5 border-b border-claude-border/40 bg-claude-surface/20 flex items-center gap-2">
          <Search size={13} className="text-claude-text-dim flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery('') } }}
            placeholder="搜索消息内容..."
            className="flex-1 bg-transparent text-xs text-claude-text placeholder-claude-text-dim focus:outline-none"
          />
          {searchQuery && (
            <span className="text-[10px] text-claude-text-dim">
              {searchMatchCount} 条匹配
            </span>
          )}
          <button
            onClick={() => { setShowSearch(false); setSearchQuery('') }}
            className="p-0.5 text-claude-text-muted hover:text-claude-text rounded"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* 系统提示词编辑面板 */}
      {showSysPrompt && (
        <div className="px-4 py-2.5 border-b border-claude-border/40 bg-claude-surface/20">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-claude-text">系统提示词配置</span>
            <button onClick={() => setShowSysPrompt(false)} className="p-0.5 text-claude-text-muted hover:text-claude-text rounded">
              <X size={13} />
            </button>
          </div>

          {/* Claude Code 提示词开关 */}
          <label className="flex items-center gap-2 mb-2 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={settings.useClaudeCodePrompt}
              onChange={(e) => { updateSettings({ useClaudeCodePrompt: e.target.checked }); saveSettings({ useClaudeCodePrompt: e.target.checked }) }}
              className="w-3.5 h-3.5 rounded border-claude-border text-claude-primary accent-claude-primary cursor-pointer"
            />
            <span className="text-[11px] text-claude-text group-hover:text-claude-primary transition-colors">
              启用 Claude Code 系统提示词
            </span>
            <span className="text-[10px] text-claude-text-dim">（全局生效）</span>
          </label>

          {/* 自定义提示词 */}
          <p className="text-[10px] text-claude-text-dim mb-1">自定义提示词（本会话生效）:</p>
          <textarea
            value={sysPromptDraft}
            onChange={(e) => setSysPromptDraft(e.target.value)}
            placeholder="例如：你是一个 React + TypeScript 专家，所有代码使用函数式组件..."
            rows={3}
            className="w-full bg-claude-bg/60 border border-claude-border/50 rounded-lg px-3 py-2 text-xs text-claude-text
                       placeholder-claude-text-dim resize-none focus:outline-none focus:border-claude-primary/50 transition-colors"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button
              onClick={() => { setCustomSystemPrompt(sysPromptDraft); setShowSysPrompt(false) }}
              className="px-3 py-1 text-[11px] bg-claude-primary hover:bg-claude-primary-light text-white rounded-md transition-colors"
            >
              保存
            </button>
            {activeSessionCustomSystemPrompt && (
              <button
                onClick={() => { setCustomSystemPrompt(''); setSysPromptDraft(''); setShowSysPrompt(false) }}
                className="px-3 py-1 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md transition-colors"
              >
                清除
              </button>
            )}
            <span className="text-[10px] text-claude-text-dim ml-auto">
              {settings.useClaudeCodePrompt ? 'Claude Code 提示词 + 自定义提示词' : '自定义提示词追加到内置指令之后'}
            </span>
          </div>
        </div>
      )}

      {/* Token 用量统计栏 */}
      {hasUsageStats && (
        <div className="px-4 py-1 border-b border-claude-border/30 flex items-center gap-3 text-[10px] text-claude-text-dim">
          <span>对话: {sessionUsage.messageCount}</span>
          <span>调用: {sessionUsage.requestCount}</span>
          <span>输入: {formatTokens(sessionUsage.totalInputTokens)}</span>
          <span>输出: {formatTokens(sessionUsage.totalOutputTokens)}</span>
          <span>费用: {formatCost(sessionUsage.totalCost)}</span>
          <span>耗时: {formatDuration(sessionUsage.totalDurationMs)}</span>
          <span>最近: {formatDuration(sessionUsage.lastDurationMs)}</span>
          <span>模型耗时: {formatDuration(sessionUsage.modelTotalDurationMs)}</span>
          <span>模型最近: {formatDuration(sessionUsage.lastModelDurationMs)}</span>
        </div>
      )}

      {activeSessionCwd ? (
        <div className="px-4 py-1.5 border-b border-claude-border/30 flex items-center gap-2">
          <p className="text-[10px] text-claude-text-dim flex-1 truncate font-mono" title={activeSessionCwd}>
            {activeSessionCwd}
            {activeSession?.workingDirectory && activeSession.workingDirectory !== settings.workingDirectory && (
              <span className="ml-1 text-claude-primary font-sans">(独立)</span>
            )}
          </p>
          <button
            onClick={async () => {
              if (!window.electronAPI) return
              const result = await window.electronAPI.selectFolder()
              if (!result.canceled && result.path) {
                setActiveSessionCwd(result.path)
              }
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] border border-claude-border/40 rounded-md text-claude-text-dim hover:text-claude-text hover:border-claude-border transition-colors"
            title="更换当前会话的工作目录"
          >
            <FolderOpen size={10} />
            更换
          </button>
          {activeSession?.workingDirectory && (
            <button
              onClick={() => setActiveSessionCwd('')}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] border border-claude-border/40 rounded-md text-claude-text-dim hover:text-claude-text hover:border-claude-border transition-colors"
              title="恢复使用全局工作目录"
            >
              <X size={10} />
              重置
            </button>
          )}
        </div>
      ) : (
        <div className="px-4 py-2 border-b border-claude-border/30 bg-amber-500/5">
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-amber-400/80 flex-1">请选择工作目录后再开始对话</p>
            <button
              onClick={async () => {
                if (!window.electronAPI) return
                const result = await window.electronAPI.selectFolder()
                if (!result.canceled && result.path) {
                  setActiveSessionCwd(result.path)
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] bg-claude-primary hover:bg-claude-primary-light text-white rounded-md transition-all"
            >
              <FolderOpen size={12} />
              选择文件夹
            </button>
          </div>
        </div>
      )}

      {/* 断线提示 */}
      {connStatus === 'disconnected' && (
        <div className="px-4 py-1.5 border-b border-red-500/20 bg-red-500/5">
          <p className="text-[11px] text-red-400/80">
            无法连接到 API ({plannedRouting.endpoint})
          </p>
        </div>
      )}

      {Boolean(activeSession?.autoIncludeGitStatus && activeSession?.lastGitStatus) && (
        <div className="px-4 py-1 border-b border-claude-border/30">
          <p className="text-[10px] text-claude-text-dim truncate font-mono">git: {activeSession?.lastGitStatus}</p>
        </div>
      )}

      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-hidden">
            <MessageList
              messages={filteredMessages}
              isLoading={isLoading}
              streamBlocks={streamBlocks}
              confirmTool={confirmTool}
              editMessage={editMessage}
              regenerateMessage={regenerateMessage}
              rollbackToMessage={rollbackToMessage}
              isRollbacking={isRollbacking}
              searchQuery={searchQuery}
              sessionId={activeSessionId}
              isActive={isActive}
            />
          </div>

          {error && (
            <div className="px-6 py-2 bg-red-500/10 border-t border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <InputArea onSend={sendMessage} onStop={stopCurrentTask} isLoading={isLoading} />
        </div>

        {/* 文件变更面板 */}
        {showFileChanges && (
          <FileChangesPanel
            sessionId={activeSessionId}
            onClose={() => setShowFileChanges(false)}
            onRollbackToTurn={rollbackToTurn}
            isRollbacking={isRollbacking}
          />
        )}
      </div>
    </div>
  )
}
