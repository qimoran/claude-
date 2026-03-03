import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, Pin, PinOff, Tag, MessageSquare, Clock, X } from 'lucide-react'
import { idbLoadSessions, loadSessionsFromStorage } from '../../utils/sessionStorage'

interface ArchivedSession {
  id: string
  title: string
  model: string
  messageCount: number
  firstMessageTime?: string
  lastMessageTime?: string
  pinned?: boolean
  tags?: string[]
}

const ARCHIVE_META_KEY = 'claude-code-gui-archive-meta'

interface ArchiveMeta {
  pinned: string[]
  tags: Record<string, string[]>
}

function loadArchiveMeta(): ArchiveMeta {
  try {
    const raw = localStorage.getItem(ARCHIVE_META_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { pinned: [], tags: {} }
}

function saveArchiveMeta(meta: ArchiveMeta) {
  try {
    localStorage.setItem(ARCHIVE_META_KEY, JSON.stringify(meta))
  } catch { /* ignore */ }
}

function mapToArchivedSessions(parsed: Array<{
  id: string
  title: string
  model: string
  messages: Array<{ timestamp?: string | Date }>
}>): ArchivedSession[] {
  const meta = loadArchiveMeta()
  return parsed.map((s) => {
    const msgs = s.messages || []
    const times = msgs
      .map((m) => m.timestamp)
      .filter(Boolean)
      .map((ts) => ts instanceof Date ? ts.toISOString() : String(ts))
    return {
      id: s.id,
      title: s.title || '未命名会话',
      model: s.model || '',
      messageCount: msgs.length,
      firstMessageTime: times[0] || undefined,
      lastMessageTime: times[times.length - 1] || undefined,
      pinned: meta.pinned.includes(s.id),
      tags: meta.tags[s.id] || [],
    }
  })
}

async function loadSessions(): Promise<ArchivedSession[]> {
  const idbData = await idbLoadSessions()
  if (idbData && idbData.sessions.length > 0) {
    return mapToArchivedSessions(idbData.sessions)
  }

  const fallback = loadSessionsFromStorage()
  if (fallback && fallback.sessions.length > 0) {
    return mapToArchivedSessions(fallback.sessions)
  }

  return []
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '未知'
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) {
      return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    } else if (days === 1) {
      return '昨天'
    } else if (days < 7) {
      return `${days}天前`
    } else {
      return `${d.getMonth() + 1}/${d.getDate()}`
    }
  } catch {
    return '未知'
  }
}

function groupByDate(sessions: ArchivedSession[]): Record<string, ArchivedSession[]> {
  const groups: Record<string, ArchivedSession[]> = {}
  for (const s of sessions) {
    let key = '更早'
    if (s.lastMessageTime) {
      try {
        const d = new Date(s.lastMessageTime)
        const now = new Date()
        const diff = now.getTime() - d.getTime()
        const days = Math.floor(diff / (1000 * 60 * 60 * 24))
        if (days === 0) key = '今天'
        else if (days === 1) key = '昨天'
        else if (days < 7) key = '本周'
        else if (days < 30) key = '本月'
        else key = '更早'
      } catch { /* use default */ }
    }
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  }
  return groups
}

interface SessionArchivePanelProps {
  onSwitchToSession?: (sessionId: string) => void
}

export default function SessionArchivePanel({ onSwitchToSession }: SessionArchivePanelProps) {
  const [sessions, setSessions] = useState<ArchivedSession[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTag, setFilterTag] = useState<string | null>(null)
  const [showTagInput, setShowTagInput] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')

  const reload = useCallback(() => {
    loadSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    const onSessionsUpdated = () => reload()
    window.addEventListener('app:sessions-updated', onSessionsUpdated)
    return () => window.removeEventListener('app:sessions-updated', onSessionsUpdated)
  }, [reload])

  // 所有标签
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    sessions.forEach(s => s.tags?.forEach(t => tagSet.add(t)))
    return Array.from(tagSet).sort()
  }, [sessions])

  // 过滤和排序
  const filtered = useMemo(() => {
    let list = sessions
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.model.toLowerCase().includes(q) ||
        s.tags?.some(t => t.toLowerCase().includes(q))
      )
    }
    if (filterTag) {
      list = list.filter(s => s.tags?.includes(filterTag))
    }
    // 置顶在前，然后按最近时间降序
    return [...list].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      const ta = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0
      const tb = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0
      return tb - ta
    })
  }, [sessions, searchQuery, filterTag])

  const grouped = useMemo(() => groupByDate(filtered), [filtered])

  const togglePin = useCallback((sessionId: string) => {
    const meta = loadArchiveMeta()
    if (meta.pinned.includes(sessionId)) {
      meta.pinned = meta.pinned.filter(id => id !== sessionId)
    } else {
      meta.pinned.push(sessionId)
    }
    saveArchiveMeta(meta)
    reload()
  }, [reload])

  const addTag = useCallback((sessionId: string, tag: string) => {
    if (!tag.trim()) return
    const meta = loadArchiveMeta()
    if (!meta.tags[sessionId]) meta.tags[sessionId] = []
    if (!meta.tags[sessionId].includes(tag.trim())) {
      meta.tags[sessionId].push(tag.trim())
    }
    saveArchiveMeta(meta)
    setShowTagInput(null)
    setTagInput('')
    reload()
  }, [reload])

  const removeTag = useCallback((sessionId: string, tag: string) => {
    const meta = loadArchiveMeta()
    if (meta.tags[sessionId]) {
      meta.tags[sessionId] = meta.tags[sessionId].filter(t => t !== tag)
      if (meta.tags[sessionId].length === 0) delete meta.tags[sessionId]
    }
    saveArchiveMeta(meta)
    reload()
  }, [reload])

  const dateOrder = ['今天', '昨天', '本周', '本月', '更早']

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* 标题栏 */}
      <div className="px-4 py-3 border-b border-claude-border bg-claude-surface">
        <h2 className="text-sm font-semibold text-claude-text mb-2">会话归档</h2>
        <div className="flex items-center gap-2 bg-claude-bg rounded-md border border-claude-border px-2 py-1">
          <Search size={14} className="text-claude-text-muted flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话..."
            className="flex-1 bg-transparent text-xs text-claude-text placeholder-claude-text-muted focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-claude-text-muted hover:text-claude-text">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 标签过滤 */}
      {allTags.length > 0 && (
        <div className="px-4 py-2 border-b border-claude-border flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilterTag(null)}
            className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
              !filterTag ? 'bg-claude-primary text-white' : 'bg-claude-surface text-claude-text-muted hover:text-claude-text'
            }`}
          >
            全部
          </button>
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
              className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                filterTag === tag ? 'bg-claude-primary text-white' : 'bg-claude-surface text-claude-text-muted hover:text-claude-text'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* 统计 */}
      <div className="px-4 py-1.5 text-[10px] text-claude-text-muted border-b border-claude-border/30">
        共 {sessions.length} 个会话{filtered.length !== sessions.length ? `，匹配 ${filtered.length} 个` : ''}
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center">
            <Clock size={32} className="mx-auto mb-2 text-claude-text-muted opacity-40" />
            <p className="text-xs text-claude-text-muted">
              {searchQuery ? '没有找到匹配的会话' : '暂无会话'}
            </p>
          </div>
        ) : (
          dateOrder.filter(key => grouped[key]).map(dateKey => (
            <div key={dateKey}>
              <div className="px-4 py-1.5 bg-claude-surface/30 border-b border-claude-border/20">
                <span className="text-[10px] font-medium text-claude-text-muted uppercase">{dateKey}</span>
              </div>
              {grouped[dateKey].map(session => (
                <div
                  key={session.id}
                  className="px-4 py-2.5 border-b border-claude-border/20 hover:bg-claude-surface-light transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare size={14} className="text-claude-text-muted mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {session.pinned && <Pin size={10} className="text-claude-primary flex-shrink-0" />}
                        <button
                          onClick={() => onSwitchToSession?.(session.id)}
                          className="text-xs text-claude-text font-medium truncate hover:text-claude-primary transition-colors text-left"
                          title={session.title}
                        >
                          {session.title}
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-claude-text-muted">{session.model || '默认'}</span>
                        <span className="text-[10px] text-claude-text-muted">{session.messageCount} 消息</span>
                        <span className="text-[10px] text-claude-text-muted">{formatDate(session.lastMessageTime)}</span>
                      </div>
                      {/* 标签 */}
                      {session.tags && session.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {session.tags.map(tag => (
                            <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[9px] bg-claude-primary/15 text-claude-primary rounded">
                              {tag}
                              <button onClick={() => removeTag(session.id, tag)} className="hover:text-red-400">
                                <X size={8} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {/* 添加标签输入 */}
                      {showTagInput === session.id && (
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            autoFocus
                            type="text"
                            value={tagInput}
                            onChange={(e) => setTagInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') addTag(session.id, tagInput)
                              if (e.key === 'Escape') { setShowTagInput(null); setTagInput('') }
                            }}
                            placeholder="输入标签..."
                            className="flex-1 px-1.5 py-0.5 text-[10px] bg-claude-bg border border-claude-border rounded text-claude-text focus:outline-none focus:border-claude-primary"
                          />
                          <button
                            onClick={() => addTag(session.id, tagInput)}
                            className="text-[10px] text-claude-primary hover:text-claude-primary-light"
                          >
                            添加
                          </button>
                        </div>
                      )}
                    </div>
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => togglePin(session.id)}
                        className="p-1 text-claude-text-muted hover:text-claude-primary rounded hover:bg-claude-surface"
                        title={session.pinned ? '取消置顶' : '置顶'}
                      >
                        {session.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                      </button>
                      <button
                        onClick={() => { setShowTagInput(showTagInput === session.id ? null : session.id); setTagInput('') }}
                        className="p-1 text-claude-text-muted hover:text-green-400 rounded hover:bg-claude-surface"
                        title="添加标签"
                      >
                        <Tag size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
