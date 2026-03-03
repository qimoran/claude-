import type { Message, SessionUsage } from '../hooks/useClaudeCode'
export { idbSaveSessions, idbLoadSessions, migrateFromLocalStorage } from './idbStorage'

export interface ChatSession {
  id: string
  title: string
  model: string
  messages: Message[]
  autoIncludeGitStatus: boolean
  lastGitStatus: string
  usage?: SessionUsage
  customSystemPrompt?: string
  workingDirectory?: string
}

const SESSIONS_STORAGE_KEY = 'claude-code-gui-sessions'
const SESSION_COUNTER_KEY = 'claude-code-gui-session-counter'

export function createSession(index: number, initialCwd?: string): ChatSession {
  return {
    id: `session-${Date.now()}-${index}`,
    title: `会话 ${index}`,
    model: '',
    messages: [],
    autoIncludeGitStatus: false,
    lastGitStatus: '',
    workingDirectory: initialCwd || undefined,
  }
}

export function loadSessionsFromStorage(): { sessions: ChatSession[]; counter: number } | null {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY)
    const counter = parseInt(localStorage.getItem(SESSION_COUNTER_KEY) || '2', 10)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ChatSession[]
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    for (const session of parsed) {
      for (const msg of session.messages) {
        msg.timestamp = new Date(msg.timestamp)
      }
    }
    return { sessions: parsed, counter }
  } catch {
    return null
  }
}

const MAX_STORAGE_BYTES = 4 * 1024 * 1024

export function saveSessionsToStorage(sessions: ChatSession[], counter: number) {
  try {
    const trimmedSessions = sessions.map(s => ({ ...s, messages: [...s.messages] }))
    let data = JSON.stringify(trimmedSessions)
    while (data.length > MAX_STORAGE_BYTES && trimmedSessions.length > 1) {
      const oldest = trimmedSessions.reduce((prev, curr) =>
        prev.messages.length >= curr.messages.length ? prev : curr
      )
      oldest.messages = oldest.messages.slice(-10)
      data = JSON.stringify(trimmedSessions)
    }
    if (data.length > MAX_STORAGE_BYTES && trimmedSessions.length === 1) {
      const half = Math.floor(trimmedSessions[0].messages.length / 2)
      trimmedSessions[0].messages = trimmedSessions[0].messages.slice(half)
      data = JSON.stringify(trimmedSessions)
    }
    localStorage.setItem(SESSIONS_STORAGE_KEY, data)
    localStorage.setItem(SESSION_COUNTER_KEY, String(counter))
  } catch {
    try {
      const minimal = sessions.slice(-1).map(s => ({ ...s, messages: s.messages.slice(-20) }))
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(minimal))
    } catch { /* 彻底放弃 */ }
  }
}
