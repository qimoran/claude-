import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppSettings } from './useAppSettings'
import { calculateCost } from '../utils/pricing'
import { createSession, loadSessionsFromStorage, saveSessionsToStorage, idbSaveSessions, idbLoadSessions, migrateFromLocalStorage } from '../utils/sessionStorage'
import type { ChatSession } from '../utils/sessionStorage'

// ── 结构化消息内容块 ──────────────────────────────────────
export interface TextBlock {
  type: 'text'
  content: string
}

export interface ToolCallBlock {
  type: 'tool_call'
  toolId: string
  toolName: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  toolId: string
  toolName: string
  output: string
  isError: boolean
}

export interface RoundBlock {
  type: 'round'
  round: number
}

export interface ToolConfirmBlock {
  type: 'tool_confirm'
  confirmId: string
  toolName: string
  input: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected'
}

export interface ImageBlock {
  type: 'image'
  url: string
  alt?: string
}

export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock | RoundBlock | ToolConfirmBlock | ImageBlock

// ── Token 用量统计 ──────────────────────────────────────
export interface SessionUsage {
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number      // 美元
  requestCount: number   // API 调用轮次（含工具回传）
  messageCount: number   // 用户主动发送消息的次数
}

export interface ImageAttachment {
  mediaType: string  // e.g. 'image/png'
  base64: string     // base64 编码的图片数据
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string           // 纯文本（user消息 + 向下兼容）
  blocks: ContentBlock[]    // 结构化块（assistant消息用）
  timestamp: Date
  images?: ImageAttachment[] // 用户消息附带的图片
}

// ChatSession 类型从 utils/sessionStorage 导入
export type { ChatSession } from '../utils/sessionStorage'

interface UseClaudeCodeReturn {
  messages: Message[]
  isLoading: boolean
  error: string | null
  streamBlocks: ContentBlock[]
  loadingSessions: ReadonlySet<string>  // 哪些会话正在运行（用于 UI 显示状态指示器）
  rollbackingSessions: ReadonlySet<string>
  sessions: ChatSession[]
  activeSessionId: string
  activeSessionModel: string
  sessionUsage: SessionUsage
  sendMessage: (content: string, images?: ImageAttachment[]) => Promise<void>
  executeCommand: (command: string) => Promise<string>
  clearMessages: () => void
  createSession: () => void
  switchSession: (sessionId: string) => void
  closeSession: (sessionId: string) => void
  setActiveSessionModel: (model: string) => void
  importSessionMessages: (messages: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp?: string
  }>, title?: string) => void
  toggleAutoIncludeGitStatus: (enabled: boolean) => void
  refreshGitStatus: () => Promise<void>
  stopCurrentTask: () => Promise<void>
  confirmTool: (confirmId: string, approved: boolean, trustSession?: boolean) => void
  resetUsage: () => void
  editMessage: (messageId: string, newContent: string) => Promise<void>
  regenerateMessage: (messageId: string) => Promise<void>
  rollbackToMessage: (messageId: string) => Promise<void>
  rollbackToTurn: (targetTurn: number, note?: string) => Promise<void>
  setCustomSystemPrompt: (prompt: string) => void
  activeSessionCustomSystemPrompt: string
  activeSessionCwd: string  // 当前会话的有效工作目录（会话级 > 全局）
  setActiveSessionCwd: (cwd: string) => void

  // 小体检增强：显示“将使用/上次使用”的端点与 Key 来源（打码）
  plannedRouting: RequestRouting
  lastRouting: RequestRouting | null
}

export type KeySource = '主端点' | '备用端点' | '中转站'

export interface RequestRouting {
  model: string
  endpoint: string
  keySource: KeySource
  keyMasked: string
}

const DEFAULT_USAGE: SessionUsage = { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, requestCount: 0, messageCount: 0 }

export function useClaudeCode(): UseClaudeCodeReturn {
  const { settings, activeModel } = useAppSettings()

  const isAltEndpointModel = useCallback((modelId: string) => {
    return modelId.startsWith('gemini-')
      || modelId.startsWith('claude-sonnet-4-5')
      || modelId.startsWith('claude-opus-4-6')
  }, [])

  const maskKey = useCallback((key: string) => {
    const k = (key || '').trim()
    if (!k) return '(未设置)'
    if (k.length <= 8) return `${'*'.repeat(Math.max(0, k.length - 2))}${k.slice(-2)}`
    return `${k.slice(0, 2)}****${k.slice(-4)}`
  }, [])

  const normalizeModelToSend = useCallback((selected: string) => {
    // 保持用户选择的模型原样透传，避免错误改写模型 ID
    return selected
  }, [])

  const resolveModelEndpointSlot = useCallback((modelId: string): 'main' | 'alt' | 'third' => {
    // 优先检查模型配置中显式指定的端点
    const modelCfg = settings.models.find(m => m.modelId === modelId)
    if (modelCfg?.endpoint && modelCfg.endpoint !== 'auto') {
      return modelCfg.endpoint
    }
    // 回退到前缀自动匹配
    if (isAltEndpointModel(modelId)) return 'alt'
    return 'main'
  }, [isAltEndpointModel, settings.models])

  const selectRouting = useCallback((modelId: string): Omit<RequestRouting, 'model'> => {
    const slot = resolveModelEndpointSlot(modelId)
    if (slot === 'third') {
      return { endpoint: settings.thirdApiEndpoint, keySource: '中转站', keyMasked: maskKey(settings.thirdApiKey) }
    }
    if (slot === 'alt') {
      return { endpoint: settings.altApiEndpoint, keySource: '备用端点', keyMasked: maskKey(settings.altApiKey) }
    }
    return { endpoint: settings.apiEndpoint, keySource: '主端点', keyMasked: maskKey(settings.apiKey) }
  }, [resolveModelEndpointSlot, maskKey, settings.thirdApiEndpoint, settings.thirdApiKey, settings.altApiEndpoint, settings.altApiKey, settings.apiEndpoint, settings.apiKey])

  // 初始化：同步加载 localStorage 作为即时值，异步加载 IndexedDB 后覆盖
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const stored = loadSessionsFromStorage()
    if (stored) return stored.sessions
    const initial = createSession(1)
    return [initial]
  })
  const [activeSessionId, setActiveSessionId] = useState<string>('')
  // ── Per-session 流式状态（支持多会话并行）──
  const [loadingSessions, setLoadingSessions] = useState<Set<string>>(new Set())
  const [rollbackingSessions, setRollbackingSessions] = useState<Set<string>>(new Set())
  const [streamBlocksMap, setStreamBlocksMap] = useState<Record<string, ContentBlock[]>>({})
  const streamBlocksRef = useRef<Record<string, ContentBlock[]>>({})
  const [errorMap, setErrorMap] = useState<Record<string, string>>({})
  const [pendingMergeSessions, setPendingMergeSessions] = useState<Set<string>>(new Set())
  const [lastRouting, setLastRouting] = useState<RequestRouting | null>(null)
  const rollbackEpochRef = useRef<Record<string, number>>({})
  const sessionCounterRef = useRef((() => {
    const stored = loadSessionsFromStorage()
    return stored ? stored.counter : 2
  })())

  // 异步加载 IndexedDB（优先），并执行 localStorage → IDB 一次性迁移
  const idbLoadedRef = useRef(false)
  useEffect(() => {
    if (idbLoadedRef.current) return
    idbLoadedRef.current = true
      ; (async () => {
        await migrateFromLocalStorage()
        const idbData = await idbLoadSessions()
        if (idbData && idbData.sessions.length > 0) {
          setSessions(idbData.sessions)
          sessionCounterRef.current = idbData.counter
        }
      })()
  }, [])

  // ── 用于流式回调中读取最新值（避免闭包捕获陈旧值）
  const activeModelRef = useRef(activeModel)
  const activeSessionRef = useRef<ChatSession | undefined>(undefined)
  const activeSessionIdRef = useRef(activeSessionId)
  const sessionsRef = useRef(sessions)
  // 已信任的会话（自动批准后续所有工具调用）
  const trustedSessionsRef = useRef<Set<string>>(new Set())

  // ── Token 用量累积（按会话，持久化）────────────────────
  const [sessionUsage, setSessionUsage] = useState<SessionUsage>(() => {
    const activeSession = sessions.find(session => session.id === activeSessionId)
    return activeSession?.usage || DEFAULT_USAGE
  })

  const resetUsage = useCallback(() => {
    setSessionUsage(DEFAULT_USAGE)
  }, [])

  useEffect(() => {
    if (sessions.length === 0) {
      const initial = createSession(1)
      setSessions([initial])
      setActiveSessionId(initial.id)
      return
    }

    if (!activeSessionId || !sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id)
    }
  }, [sessions, activeSessionId])

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId],
  )

  // 保持 ref 同步
  useEffect(() => { activeModelRef.current = activeModel }, [activeModel])
  useEffect(() => { activeSessionRef.current = activeSession }, [activeSession])
  useEffect(() => { activeSessionIdRef.current = activeSessionId }, [activeSessionId])
  useEffect(() => { sessionsRef.current = sessions }, [sessions])

  // 切换会话时恢复 usage
  const usageFromSessionRef = useRef(false)
  useEffect(() => {
    usageFromSessionRef.current = true
    if (activeSession?.usage) {
      setSessionUsage(activeSession.usage)
    } else {
      setSessionUsage(DEFAULT_USAGE)
    }
  }, [activeSessionId])

  // usage 变化时同步到 session（持久化）
  // usageFromSessionRef 跳过"切换会话恢复 usage 后立即写回"的多余循环
  useEffect(() => {
    if (!activeSessionId || sessionUsage.requestCount === 0) return
    if (usageFromSessionRef.current) {
      usageFromSessionRef.current = false
      return
    }
    setSessions((prev) => prev.map((s) =>
      s.id === activeSessionId ? { ...s, usage: sessionUsage } : s
    ))
  }, [sessionUsage, activeSessionId])

  // 持久化 sessions 到 IndexedDB（debounce 1.5s，避免高频写入）
  // 保留 localStorage 作为同步 fallback（页面意外关闭时的兜底）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      idbSaveSessions(sessions, sessionCounterRef.current)
      saveSessionsToStorage(sessions, sessionCounterRef.current)
    }, 1500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [sessions])

  // 通知归档面板等消费者：会话数据已变化
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('app:sessions-updated'))
  }, [sessions])

  const updateSession = useCallback((sessionId: string, updater: (session: ChatSession) => ChatSession) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(session) : session)))
  }, [])

  const cleanupSessionCaches = useCallback((sessionId: string) => {
    setLoadingSessions((prev) => {
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
    setRollbackingSessions((prev) => {
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
    setStreamBlocksMap((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      streamBlocksRef.current = next
      return next
    })
    setErrorMap((prev) => {
      const next = { ...prev }
      delete next[sessionId]
      return next
    })
    setPendingMergeSessions((prev) => {
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })
    trustedSessionsRef.current.delete(sessionId)
    delete rollbackEpochRef.current[sessionId]
  }, [])

  // 处理流式数据（使用缓冲区 + rAF 批量刷新，减少高频重渲染）
  // 每条事件携带 sessionId，支持多会话并行
  const pendingEventsRef = useRef<Array<{ sessionId: string; parsed: boolean; data: string; evt?: Record<string, unknown>; epoch: number }>>([])
  const rafIdRef = useRef<number | null>(null)

  useEffect(() => {
    const electronAPI = window.electronAPI
    if (!electronAPI) return

    const extractDataImageUrls = (content: string): { text: string; urls: string[] } => {
      if (!content || !content.includes('data:image/')) return { text: content, urls: [] }

      const regex = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/g
      const urls: string[] = []
      let text = content

      text = text.replace(regex, (full) => {
        const normalized = full.replace(/[\r\n]/g, '')
        urls.push(normalized)
        return '[生成图片]'
      })

      return { text, urls }
    }

    // 将缓冲区中的事件按 sessionId 分组，批量应用到对应 streamBlocksMap
    const flushPendingEvents = () => {
      rafIdRef.current = null
      const events = pendingEventsRef.current.splice(0)
      if (events.length === 0) return

      // 按 sessionId 分组
      const grouped = new Map<string, typeof events>()
      for (const item of events) {
        const currentEpoch = rollbackEpochRef.current[item.sessionId] || 0
        if (item.epoch !== currentEpoch) continue
        const arr = grouped.get(item.sessionId) || []
        arr.push(item)
        grouped.set(item.sessionId, arr)
      }

      setStreamBlocksMap((prev) => {
        const next = { ...prev }
        for (const [sid, items] of grouped) {
          let blocks = [...(next[sid] || [])]
          for (const item of items) {
            if (item.parsed && item.evt) {
              const evt = item.evt
              if (evt.type === 'text') {
                const { text, urls } = extractDataImageUrls((evt.content as string) || '')

                const last = blocks[blocks.length - 1]
                if (text && last && last.type === 'text') {
                  blocks = [
                    ...blocks.slice(0, -1),
                    { ...last, content: last.content + text },
                  ]
                } else if (text) {
                  blocks = [...blocks, { type: 'text', content: text }]
                }

                if (urls.length > 0) {
                  blocks = [
                    ...blocks,
                    ...urls.map((url) => ({ type: 'image' as const, url })),
                  ]
                }
              } else if (evt.type === 'tool_call') {
                blocks = [...blocks, {
                  type: 'tool_call',
                  toolId: evt.toolId as string,
                  toolName: evt.toolName as string,
                  input: evt.input as Record<string, unknown>,
                }]
              } else if (evt.type === 'tool_result') {
                blocks = [...blocks, {
                  type: 'tool_result',
                  toolId: evt.toolId as string,
                  toolName: evt.toolName as string,
                  output: evt.output as string,
                  isError: evt.isError as boolean,
                }]
              } else if (evt.type === 'round') {
                blocks = [...blocks, { type: 'round', round: evt.round as number }]
              } else if (evt.type === 'tool_confirm') {
                blocks = [...blocks, {
                  type: 'tool_confirm',
                  confirmId: evt.confirmId as string,
                  toolName: evt.toolName as string,
                  input: evt.input as Record<string, unknown>,
                  status: evt.autoApproved ? 'approved' as const : 'pending' as const,
                }]
              } else if (evt.type === 'image' && typeof evt.url === 'string') {
                blocks = [...blocks, {
                  type: 'image',
                  url: evt.url,
                  alt: typeof evt.alt === 'string' ? evt.alt : undefined,
                }]
              }
            } else {
              const last = blocks[blocks.length - 1]
              if (last && last.type === 'text') {
                blocks = [
                  ...blocks.slice(0, -1),
                  { ...last, content: last.content + item.data },
                ]
              } else {
                blocks = [...blocks, { type: 'text', content: item.data }]
              }
            }
          }
          next[sid] = blocks
        }
        streamBlocksRef.current = next
        return next
      })
    }

    const scheduleFlush = () => {
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flushPendingEvents)
      }
    }

    electronAPI.onStreamData((sid, data) => {
      try {
        const evt = JSON.parse(data) as Record<string, unknown>
        if (evt.type === 'usage') {
          const inputTk = (evt.inputTokens as number) || 0
          const outputTk = (evt.outputTokens as number) || 0
          // 根据该会话的模型计算费用
          const targetSession = sessionsRef.current.find(s => s.id === sid)
          const modelForCost = targetSession?.model || activeModelRef.current
          const cost = calculateCost(modelForCost, inputTk, outputTk)

          if (sid === activeSessionIdRef.current) {
            // 当前活跃会话：直接更新 UI state
            setSessionUsage((prev) => ({
              ...prev,
              totalInputTokens: prev.totalInputTokens + inputTk,
              totalOutputTokens: prev.totalOutputTokens + outputTk,
              totalCost: prev.totalCost + cost,
              requestCount: prev.requestCount + 1,
            }))
          } else {
            // 非活跃会话：累积到 session 的 usage 字段（切换后恢复）
            setSessions(prev => prev.map(s => {
              if (s.id !== sid) return s
              const u = s.usage || DEFAULT_USAGE
              return {
                ...s, usage: {
                  ...u,
                  totalInputTokens: u.totalInputTokens + inputTk,
                  totalOutputTokens: u.totalOutputTokens + outputTk,
                  totalCost: u.totalCost + cost,
                  requestCount: u.requestCount + 1,
                }
              }
            }))
          }
        } else if (evt.type === 'tool_confirm' && trustedSessionsRef.current.has(sid)) {
          // 已信任的会话：自动批准，UI 上显示为已批准
          const confirmId = evt.confirmId as string
          electronAPI.confirmTool(confirmId, true)
          const autoEvt = { ...evt, autoApproved: true }
          pendingEventsRef.current.push({
            sessionId: sid,
            parsed: true,
            data,
            evt: autoEvt,
            epoch: rollbackEpochRef.current[sid] || 0,
          })
          scheduleFlush()
        } else {
          pendingEventsRef.current.push({
            sessionId: sid,
            parsed: true,
            data,
            evt,
            epoch: rollbackEpochRef.current[sid] || 0,
          })
          scheduleFlush()
        }
      } catch {
        pendingEventsRef.current.push({
          sessionId: sid,
          parsed: false,
          data,
          epoch: rollbackEpochRef.current[sid] || 0,
        })
        scheduleFlush()
      }
    })

    electronAPI.onStreamError((sid, streamError) => {
      if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
      flushPendingEvents()
      setErrorMap((prev) => ({ ...prev, [sid]: streamError }))
      setLoadingSessions((prev) => { const next = new Set(prev); next.delete(sid); return next })
      setRollbackingSessions((prev) => { const next = new Set(prev); next.delete(sid); return next })
      // 非当前会话完成时发送桌面通知
      if (sid !== activeSessionIdRef.current && electronAPI.showNotification) {
        const s = sessionsRef.current.find(x => x.id === sid)
        electronAPI.showNotification(s?.title || '会话', `任务失败: ${streamError.slice(0, 100)}`)
      }
    })

    electronAPI.onStreamEnd((sid) => {
      if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
      flushPendingEvents()
      setLoadingSessions((prev) => { const next = new Set(prev); next.delete(sid); return next })
      setRollbackingSessions((prev) => { const next = new Set(prev); next.delete(sid); return next })
      const hasPendingForEpoch = pendingEventsRef.current.some(e => e.sessionId === sid && e.epoch === (rollbackEpochRef.current[sid] || 0))
      const hasBlocks = (streamBlocksRef.current[sid] || []).length > 0
      if (hasBlocks || hasPendingForEpoch) {
        setPendingMergeSessions((prev) => new Set(prev).add(sid))
      }
      // 非当前会话完成时发送桌面通知
      if (sid !== activeSessionIdRef.current && electronAPI.showNotification) {
        const s = sessionsRef.current.find(x => x.id === sid)
        electronAPI.showNotification(s?.title || '会话', '任务已完成')
      }
    })

    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
      electronAPI.removeStreamListeners()
    }
  }, [])

  // 流结束后，把对应会话的 streamBlocks 合并成 assistant message
  useEffect(() => {
    if (pendingMergeSessions.size === 0) return

    for (const sid of pendingMergeSessions) {
      const rawBlocks = streamBlocksMap[sid] || []
      const hasPendingForEpoch = pendingEventsRef.current.some(e => e.sessionId === sid && e.epoch === (rollbackEpochRef.current[sid] || 0))
      if (rawBlocks.length === 0 || hasPendingForEpoch) continue

      // 流结束：对所有 text 块做完整的 base64 提取，拆为 image 块
      const blocks: ContentBlock[] = []
      for (const block of rawBlocks) {
        if (block.type === 'text' && block.content.includes('data:image/')) {
          const regex = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/g
          const urls: string[] = []
          let text = block.content.replace(regex, (full) => {
            urls.push(full.replace(/[\r\n]/g, ''))
            return ''
          })
          // 清理残余 markdown 图片语法
          text = text.replace(/!\[[^\]]*\]\(\s*\)/g, '').trim()
          if (text) blocks.push({ ...block, content: text })
          for (const url of urls) {
            blocks.push({ type: 'image', url })
          }
        } else {
          blocks.push(block)
        }
      }

      const textParts = blocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.content)
      const plainContent = textParts.join('') || '(工具执行完成)'

      const assistantMessage: Message = {
        id: `${Date.now()}-${sid}`,
        role: 'assistant',
        content: plainContent,
        blocks: [...blocks],
        timestamp: new Date(),
      }

      updateSession(sid, (session) => ({
        ...session,
        messages: [...session.messages, assistantMessage],
      }))
    }

    // 清理已合并会话的 blocks
    setStreamBlocksMap((prev) => {
      const next = { ...prev }
      for (const sid of pendingMergeSessions) {
        const hasPendingForEpoch = pendingEventsRef.current.some(e => e.sessionId === sid && e.epoch === (rollbackEpochRef.current[sid] || 0))
        if (!hasPendingForEpoch) {
          delete next[sid]
        }
      }
      streamBlocksRef.current = next
      return next
    })
    setPendingMergeSessions(new Set())
  }, [pendingMergeSessions, streamBlocksMap, updateSession])

  // 会话级工作目录优先于全局设置
  const effectiveCwd = (activeSession?.workingDirectory?.trim() || settings.workingDirectory.trim())

  const readGitStatus = useCallback(async (): Promise<string> => {
    const electronAPI = window.electronAPI
    if (!electronAPI) return ''

    const result = await electronAPI.getGitStatus(effectiveCwd || undefined)
    if (!result.success) {
      throw new Error(result.output || '读取 Git 状态失败')
    }
    return result.output.trim()
  }, [effectiveCwd])

  const syncBackendHistory = useCallback(async (session: ChatSession) => {
    const electronAPI = window.electronAPI
    if (!electronAPI?.syncSessionHistory) return

    const messages = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const result = await electronAPI.syncSessionHistory({ sessionId: session.id, messages })
    if (!result.success) {
      throw new Error(result.error || '同步会话历史失败')
    }
  }, [])

  const sendMessage = useCallback(async (content: string, images?: ImageAttachment[]) => {
    if ((!content.trim() && (!images || images.length === 0)) || !activeSession) return
    if (rollbackingSessions.has(activeSession.id)) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      blocks: [],
      timestamp: new Date(),
      images: images && images.length > 0 ? images : undefined,
    }

    updateSession(activeSession.id, (session) => {
      let title = session.title
      if (session.messages.length === 0) {
        // 智能提取标题：移除 context/git 附加内容、代码块，取首个有意义的句子
        let raw = content
          .replace(/\n\[Context:.*$/s, '')   // 移除 git status 附加
          .replace(/```[\s\S]*?```/g, '')    // 移除代码块
          .replace(/\n+/g, ' ')              // 合并换行
          .trim()
        // 取第一句（句号/问号/感叹号/逗号截断）
        const sentenceMatch = raw.match(/^(.{4,40}[。？！?!,，])/)
        if (sentenceMatch) {
          raw = sentenceMatch[1]
        } else {
          raw = raw.slice(0, 40)
        }
        title = raw.trim() || session.title
      }
      return {
        ...session,
        title,
        messages: [...session.messages, userMessage],
      }
    })

    const sid = activeSession.id
    setSessionUsage(prev => ({ ...prev, messageCount: prev.messageCount + 1 }))
    setLoadingSessions((prev) => new Set(prev).add(sid))
    setErrorMap((prev) => { const next = { ...prev }; delete next[sid]; return next })
    setStreamBlocksMap((prev) => {
      const next = { ...prev, [sid]: [] }
      streamBlocksRef.current = next
      return next
    })

    try {
      let finalPrompt = content
      let gitStatusToUse = activeSession.lastGitStatus

      if (activeSession.autoIncludeGitStatus) {
        if (!gitStatusToUse) {
          gitStatusToUse = await readGitStatus()
          updateSession(sid, (session) => ({
            ...session,
            lastGitStatus: gitStatusToUse,
          }))
        }

        if (gitStatusToUse) {
          finalPrompt += `\n\n[Context: git status]\n${gitStatusToUse}`
        }
      }

      if (window.electronAPI) {
        await syncBackendHistory(activeSession)

        const selectedModel = normalizeModelToSend(activeSession.model || activeModel)
        const routing = selectRouting(selectedModel)
        setLastRouting({ model: selectedModel, ...routing })
        await window.electronAPI.stream({
          prompt: finalPrompt,
          model: selectedModel,
          sessionId: sid,
          cwd: effectiveCwd || undefined,
          skipPermissions: settings.dangerouslySkipPermissions,
          apiEndpoint: routing.endpoint,
          apiKey: routing.keySource === '中转站' ? settings.thirdApiKey : routing.keySource === '备用端点' ? settings.altApiKey : settings.apiKey,
          apiFormat: routing.keySource === '中转站' ? (settings.thirdApiFormat || settings.apiFormat) : routing.keySource === '备用端点' ? (settings.altApiFormat || settings.apiFormat) : settings.apiFormat,
          images: images && images.length > 0 ? images : undefined,
          customSystemPrompt: activeSession.customSystemPrompt || undefined,
          useClaudeCodePrompt: settings.useClaudeCodePrompt,
          maxTokens: settings.maxTokens,
        })
      } else {
        setTimeout(() => {
          updateSession(sid, (session) => ({
            ...session,
            messages: [
              ...session.messages,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `这是对 "${content}" 的模拟响应。`,
                blocks: [{ type: 'text', content: `这是对 "${content}" 的模拟响应。` }],
                timestamp: new Date(),
              },
            ],
          }))
          setLoadingSessions((prev) => { const next = new Set(prev); next.delete(sid); return next })
        }, 1000)
      }
    } catch (err) {
      setErrorMap((prev) => ({ ...prev, [sid]: err instanceof Error ? err.message : '发生错误' }))
      setLoadingSessions((prev) => { const next = new Set(prev); next.delete(sid); return next })
    }
  }, [
    activeSession,
    activeModel,
    normalizeModelToSend,
    selectRouting,
    readGitStatus,
    settings.dangerouslySkipPermissions,
    effectiveCwd,
    settings.apiEndpoint,
    settings.altApiEndpoint,
    settings.thirdApiEndpoint,
    settings.altApiKey,
    settings.thirdApiKey,
    settings.apiKey,
    settings.apiFormat,
    settings.altApiFormat,
    settings.thirdApiFormat,
    updateSession,
    rollbackingSessions,
    syncBackendHistory,
  ])

  const executeCommand = useCallback(async (command: string): Promise<string> => {
    if (!window.electronAPI) return 'electronAPI 不可用'
    try {
      const selectedModel = normalizeModelToSend(activeSession?.model || activeModel)
      const routing = selectRouting(selectedModel)
      setLastRouting({ model: selectedModel, ...routing })

      const result = await window.electronAPI.execute({
        prompt: command,
        model: selectedModel,
        apiEndpoint: routing.endpoint,
        apiKey: routing.keySource === '中转站' ? settings.thirdApiKey : routing.keySource === '备用端点' ? settings.altApiKey : settings.apiKey,
        apiFormat: routing.keySource === '中转站' ? (settings.thirdApiFormat || settings.apiFormat) : routing.keySource === '备用端点'
          ? (settings.altApiFormat || settings.apiFormat)
          : settings.apiFormat,
      })
      return result.output
    } catch (err) {
      throw err instanceof Error ? err : new Error('命令执行失败')
    }
  }, [
    activeSession?.model,
    activeModel,
    normalizeModelToSend,
    selectRouting,
    settings.apiEndpoint,
    settings.altApiEndpoint,
    settings.thirdApiEndpoint,
    settings.altApiKey,
    settings.thirdApiKey,
    settings.apiKey,
    settings.altApiFormat,
    settings.thirdApiFormat,
    settings.apiFormat,
  ])

  const clearMessages = useCallback(() => {
    if (!activeSession || rollbackingSessions.has(activeSession.id)) return
    updateSession(activeSession.id, (session) => ({
      ...session,
      messages: [],
      lastGitStatus: '',
      usage: DEFAULT_USAGE,
    }))
    window.electronAPI?.clearHistory(activeSession.id)
    cleanupSessionCaches(activeSession.id)
    resetUsage()
  }, [activeSession, rollbackingSessions, updateSession, cleanupSessionCaches, resetUsage])

  const createNewSession = useCallback(() => {
    const next = createSession(sessionCounterRef.current, settings.workingDirectory.trim() || undefined)
    sessionCounterRef.current += 1
    setSessions((prev) => [...prev, next])
    setActiveSessionId(next.id)
  }, [settings.workingDirectory])

  const switchSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
  }, [])

  const closeSession = useCallback((sessionId: string) => {
    if (sessions.length <= 1 || rollbackingSessions.has(sessionId)) return

    cleanupSessionCaches(sessionId)

    setSessions((prev) => {
      return prev.filter((session) => session.id !== sessionId)
    })

    window.electronAPI?.clearHistory(sessionId)

    if (activeSessionId === sessionId) {
      const fallback = sessions.find((session) => session.id !== sessionId)
      if (fallback) {
        setActiveSessionId(fallback.id)
      }
    }
  }, [activeSessionId, sessions, rollbackingSessions, cleanupSessionCaches])

  const importSessionMessages = useCallback((imported: Array<{
    role: 'user' | 'assistant'
    content: string
    timestamp?: string
  }>, title?: string) => {
    const cleaned = imported
      .map((m, i): Message => ({
        id: `import-${Date.now()}-${i}`,
        role: m.role,
        content: m.content,
        blocks: m.role === 'assistant'
          ? [{ type: 'text', content: m.content }]
          : [],
        timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
      }))
      .filter((m) => m.content.trim().length > 0)

    const next = createSession(sessionCounterRef.current, settings.workingDirectory.trim() || undefined)
    sessionCounterRef.current += 1

    const nextTitle = (title && title.trim())
      ? title.trim().slice(0, 50)
      : (cleaned.find((m) => m.role === 'user')?.content.replace(/\n.*/s, '').trim().slice(0, 50) || next.title)

    const importedSession: ChatSession = {
      ...next,
      title: nextTitle || next.title,
      messages: cleaned,
    }

    setSessions((prev) => [...prev, importedSession])
    setActiveSessionId(importedSession.id)
  }, [settings.workingDirectory])

  const setActiveSessionModel = useCallback((model: string) => {
    if (!activeSession) return
    updateSession(activeSession.id, (session) => ({ ...session, model }))
  }, [activeSession, updateSession])

  const toggleAutoIncludeGitStatus = useCallback((enabled: boolean) => {
    if (!activeSession) return
    updateSession(activeSession.id, (session) => ({
      ...session,
      autoIncludeGitStatus: enabled,
    }))
  }, [activeSession, updateSession])

  const refreshGitStatus = useCallback(async () => {
    if (!activeSession) return
    try {
      const status = await readGitStatus()
      updateSession(activeSession.id, (session) => ({
        ...session,
        autoIncludeGitStatus: true,
        lastGitStatus: status,
      }))
      if (activeSession) setErrorMap((prev) => { const next = { ...prev }; delete next[activeSession.id]; return next })
    } catch (err) {
      if (activeSession) setErrorMap((prev) => ({ ...prev, [activeSession.id]: err instanceof Error ? err.message : '读取 Git 状态失败' }))
    }
  }, [activeSession, readGitStatus, updateSession])

  const confirmTool = useCallback((confirmId: string, approved: boolean, trustSession?: boolean) => {
    window.electronAPI?.confirmTool(confirmId, approved)
    // 如果选择"全部允许"，将当前会话加入信任列表
    if (trustSession && approved && activeSessionIdRef.current) {
      trustedSessionsRef.current.add(activeSessionIdRef.current)
    }
    // 更新所有会话的 streamBlocks 中匹配的确认块
    setStreamBlocksMap((prev) => {
      const next = { ...prev }
      for (const sid of Object.keys(next)) {
        next[sid] = next[sid].map((block) =>
          block.type === 'tool_confirm' && block.confirmId === confirmId
            ? { ...block, status: approved ? 'approved' : 'rejected' }
            : block
        )
      }
      streamBlocksRef.current = next
      return next
    })
  }, [])

  const stopCurrentTask = useCallback(async () => {
    if (!window.electronAPI || !activeSession) return
    const sid = activeSession.id
    if (!loadingSessions.has(sid) && !rollbackingSessions.has(sid)) return
    await window.electronAPI.stopStream(sid)
    setLoadingSessions((prev) => { const next = new Set(prev); next.delete(sid); return next })
    setRollbackingSessions((prev) => { const next = new Set(prev); next.delete(sid); return next })
  }, [activeSession, loadingSessions, rollbackingSessions])

  // 编辑用户消息并重新发送（截断该消息之后的所有历史）
  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    if (!activeSession || loadingSessions.has(activeSession.id) || rollbackingSessions.has(activeSession.id)) return
    const msgIndex = activeSession.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1 || activeSession.messages[msgIndex].role !== 'user') return

    updateSession(activeSession.id, (session) => ({
      ...session,
      messages: session.messages.slice(0, msgIndex),
    }))

    window.electronAPI?.clearHistory(activeSession.id)

    await sendMessage(newContent)
  }, [activeSession, loadingSessions, rollbackingSessions, updateSession, sendMessage])

  // 统一回滚语义：
  // - 点击 user 消息：回滚到该 user 之前（不含该消息）
  // - 点击 assistant 消息：回滚到该轮结束（含该 assistant）
  const resolveRollbackTargetByMessage = useCallback((msgs: Message[], msgIndex: number): { targetTurn: number; cutIndex: number } => {
    const msg = msgs[msgIndex]

    if (msg.role === 'user') {
      const userCountBefore = msgs.slice(0, msgIndex).filter(m => m.role === 'user').length
      const targetTurn = userCountBefore - 1
      return { targetTurn, cutIndex: msgIndex }
    }

    const userCountBeforeOrAt = msgs.slice(0, msgIndex + 1).filter(m => m.role === 'user').length
    const targetTurn = userCountBeforeOrAt - 1
    let cutIndex = msgIndex + 1
    while (cutIndex < msgs.length && msgs[cutIndex].role !== 'user') cutIndex++
    return { targetTurn, cutIndex }
  }, [])

  const getCutIndexByTurn = useCallback((msgs: Message[], t: number) => {
    if (t < 0) return 0
    let userTurn = -1
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role === 'user') {
        userTurn++
        if (userTurn === t) {
          let j = i + 1
          while (j < msgs.length && msgs[j].role !== 'user') j++
          return j
        }
      }
    }
    return msgs.length
  }, [])

  const buildRollbackSummaryMessage = useCallback((result: { restored: number; errors: string[]; retainedSnapshots?: number; minRollbackTurn?: number }, detail: string): Message => ({
    id: `rollback-${Date.now()}`,
    role: 'assistant',
    content: result.restored > 0
      ? `[系统] 已回滚：恢复了 ${result.restored} 个文件${result.errors.length > 0 ? `，${result.errors.length} 个失败` : ''}`
      : '[系统] 已回滚（无文件需要恢复）',
    blocks: [{
      type: 'text',
      content: `${detail}${result.errors.length > 0 ? `\n\n恢复失败：\n${result.errors.join('\n')}` : ''}${(result.retainedSnapshots || 0) > 0 ? `\n\n已保留 ${result.retainedSnapshots} 条失败快照，可重试。` : ''}${typeof result.minRollbackTurn === 'number' && result.minRollbackTurn >= 0 ? `\n\n最早可精确回滚轮次：${result.minRollbackTurn}` : ''}`,
    }],
    timestamp: new Date(),
  }), [])

  const runRollback = useCallback(async (targetTurn: number, cutIndex: number, detail: string) => {
    if (!activeSession || loadingSessions.has(activeSession.id) || rollbackingSessions.has(activeSession.id)) return
    if (targetTurn < -1) return
    const electronAPI = window.electronAPI
    if (!electronAPI) return

    const sid = activeSession.id
    setRollbackingSessions((prev) => {
      const next = new Set(prev)
      next.add(sid)
      return next
    })

    try {
      await syncBackendHistory(activeSession)
      const result = await electronAPI.rollback({ sessionId: sid, targetTurn })

      if (!result.success) {
        const err = result.error || (result.errors && result.errors.length > 0 ? result.errors.join('\n') : '回滚失败')
        const failMsg: Message = {
          id: `rollback-failed-${Date.now()}`,
          role: 'assistant',
          content: `[系统] 回滚失败：${err}`,
          blocks: [{ type: 'text', content: `回滚失败：${err}` }],
          timestamp: new Date(),
        }
        updateSession(sid, (session) => ({ ...session, messages: [...session.messages, failMsg] }))
        return
      }

      rollbackEpochRef.current[sid] = (rollbackEpochRef.current[sid] || 0) + 1
      pendingEventsRef.current = pendingEventsRef.current.filter(e => e.sessionId !== sid)
      setStreamBlocksMap((prev) => {
        const next = { ...prev }
        delete next[sid]
        streamBlocksRef.current = next
        return next
      })
      setPendingMergeSessions((prev) => {
        const next = new Set(prev)
        next.delete(sid)
        return next
      })

      const rollbackMsg = buildRollbackSummaryMessage(result, detail)
      updateSession(sid, (session) => ({
        ...session,
        messages: [...session.messages.slice(0, cutIndex), rollbackMsg],
      }))
    } catch (err) {
      const failMsg: Message = {
        id: `rollback-failed-${Date.now()}`,
        role: 'assistant',
        content: `[系统] 回滚失败：${(err as Error).message}`,
        blocks: [{ type: 'text', content: `回滚失败：${(err as Error).message}` }],
        timestamp: new Date(),
      }
      updateSession(sid, (session) => ({ ...session, messages: [...session.messages, failMsg] }))
    } finally {
      setRollbackingSessions((prev) => {
        const next = new Set(prev)
        next.delete(sid)
        return next
      })
    }
  }, [activeSession, loadingSessions, rollbackingSessions, updateSession, buildRollbackSummaryMessage, syncBackendHistory])

  // 回滚到指定消息（统一语义）
  const rollbackToMessage = useCallback(async (messageId: string) => {
    if (!activeSession) return
    const msgIndex = activeSession.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) return

    const { targetTurn, cutIndex } = resolveRollbackTargetByMessage(activeSession.messages, msgIndex)
    const detail = activeSession.messages[msgIndex].role === 'user'
      ? '已回滚到该用户消息之前。'
      : '已回滚到该助手回复所在轮次末尾。'

    await runRollback(targetTurn, cutIndex, detail)
  }, [activeSession, resolveRollbackTargetByMessage, runRollback])

  // 按轮次回滚（主要用于“文件变更”面板）
  const rollbackToTurn = useCallback(async (targetTurn: number, note?: string) => {
    if (!activeSession) return
    const cutIndex = getCutIndexByTurn(activeSession.messages, targetTurn)
    const detail = `${note ? `${note}\n\n` : ''}已回滚到轮次 ${targetTurn}。`
    await runRollback(targetTurn, cutIndex, detail)
  }, [activeSession, getCutIndexByTurn, runRollback])

  // 重新生成助手回复（删除该助手消息，重发前一条用户消息）
  const regenerateMessage = useCallback(async (messageId: string) => {
    if (!activeSession || loadingSessions.has(activeSession.id) || rollbackingSessions.has(activeSession.id)) return
    const msgIndex = activeSession.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1 || activeSession.messages[msgIndex].role !== 'assistant') return

    // 找到该助手消息前的最后一条用户消息
    let userMsgIndex = msgIndex - 1
    while (userMsgIndex >= 0 && activeSession.messages[userMsgIndex].role !== 'user') {
      userMsgIndex--
    }
    if (userMsgIndex < 0) return
    const userContent = activeSession.messages[userMsgIndex].content

    // 截断从用户消息开始（含）的所有消息
    updateSession(activeSession.id, (session) => ({
      ...session,
      messages: session.messages.slice(0, userMsgIndex),
    }))

    window.electronAPI?.clearHistory(activeSession.id)
    await sendMessage(userContent)
  }, [activeSession, loadingSessions, rollbackingSessions, updateSession, sendMessage])

  // ── 派生值：当前活跃会话的状态 ──
  const isLoading = loadingSessions.has(activeSessionId)
  const streamBlocks = streamBlocksMap[activeSessionId] || []
  const error = errorMap[activeSessionId] || null

  const plannedRoutingMemo = useMemo<RequestRouting>(() => {
    const selectedModel = normalizeModelToSend(activeSession?.model || activeModel)
    const routing = selectRouting(selectedModel)
    return { model: selectedModel, ...routing }
  }, [activeSession?.model, activeModel, normalizeModelToSend, selectRouting])

  return {
    messages: activeSession?.messages || [],
    isLoading,
    error,
    streamBlocks,
    loadingSessions,
    rollbackingSessions,
    sessions,
    activeSessionId,
    activeSessionModel: activeSession?.model || activeModel,
    sessionUsage,
    sendMessage,
    executeCommand,
    clearMessages,
    createSession: createNewSession,
    switchSession,
    closeSession,
    setActiveSessionModel,
    importSessionMessages,
    toggleAutoIncludeGitStatus,
    refreshGitStatus,
    stopCurrentTask,
    confirmTool,
    resetUsage,
    editMessage,
    regenerateMessage,
    rollbackToMessage,
    rollbackToTurn,
    setCustomSystemPrompt: useCallback((prompt: string) => {
      if (!activeSession) return
      updateSession(activeSession.id, (session) => ({ ...session, customSystemPrompt: prompt }))
    }, [activeSession, updateSession]),
    activeSessionCustomSystemPrompt: activeSession?.customSystemPrompt || '',
    activeSessionCwd: effectiveCwd,
    setActiveSessionCwd: useCallback((cwd: string) => {
      if (!activeSession) return
      updateSession(activeSession.id, (session) => ({ ...session, workingDirectory: cwd || undefined }))
    }, [activeSession, updateSession]),

    plannedRouting: plannedRoutingMemo,
    lastRouting,
  }
}
