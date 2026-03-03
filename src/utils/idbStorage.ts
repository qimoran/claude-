import { openDB, type IDBPDatabase } from 'idb'
import type { ChatSession } from './sessionStorage'

const DB_NAME = 'claude-code-gui'
const DB_VERSION = 1
const SESSIONS_STORE = 'sessions'
const META_STORE = 'meta'

let dbPromise: Promise<IDBPDatabase> | null = null

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE)
        }
      },
    })
  }
  return dbPromise
}

export async function idbSaveSessions(sessions: ChatSession[], counter: number): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction([SESSIONS_STORE, META_STORE], 'readwrite')
    const sessionsStore = tx.objectStore(SESSIONS_STORE)
    const metaStore = tx.objectStore(META_STORE)

    // 清除旧数据
    await sessionsStore.clear()

    // 写入所有会话
    for (const session of sessions) {
      await sessionsStore.put(session)
    }

    // 保存计数器和会话 ID 顺序
    await metaStore.put(counter, 'sessionCounter')
    await metaStore.put(sessions.map(s => s.id), 'sessionOrder')

    await tx.done
  } catch (err) {
    console.warn('[idbStorage] save failed:', err)
  }
}

export async function idbLoadSessions(): Promise<{ sessions: ChatSession[]; counter: number } | null> {
  try {
    const db = await getDB()

    const counter = (await db.get(META_STORE, 'sessionCounter')) as number | undefined
    const order = (await db.get(META_STORE, 'sessionOrder')) as string[] | undefined
    const allSessions = await db.getAll(SESSIONS_STORE) as ChatSession[]

    if (!allSessions || allSessions.length === 0) return null

    // 按保存的顺序排列
    let sessions: ChatSession[]
    if (order && order.length > 0) {
      const map = new Map(allSessions.map(s => [s.id, s]))
      sessions = order.map(id => map.get(id)).filter(Boolean) as ChatSession[]
      // 添加不在 order 中的会话
      for (const s of allSessions) {
        if (!order.includes(s.id)) sessions.push(s)
      }
    } else {
      sessions = allSessions
    }

    // 恢复 Date 对象
    for (const session of sessions) {
      for (const msg of session.messages) {
        msg.timestamp = new Date(msg.timestamp)
      }
      if (session.model) {
        session.model = ''
      }
    }

    return { sessions, counter: counter ?? 2 }
  } catch (err) {
    console.warn('[idbStorage] load failed:', err)
    return null
  }
}

// 从 localStorage 迁移到 IndexedDB（仅执行一次）
export async function migrateFromLocalStorage(): Promise<boolean> {
  try {
    const db = await getDB()
    const existing = await db.count(SESSIONS_STORE)
    if (existing > 0) return false // 已有数据，无需迁移

    const raw = localStorage.getItem('claude-code-gui-sessions')
    if (!raw) return false

    const parsed = JSON.parse(raw) as ChatSession[]
    if (!Array.isArray(parsed) || parsed.length === 0) return false

    const counter = parseInt(localStorage.getItem('claude-code-gui-session-counter') || '2', 10)

    // 恢复 Date 对象
    for (const session of parsed) {
      for (const msg of session.messages) {
        msg.timestamp = new Date(msg.timestamp)
      }
      if (session.model) session.model = ''
    }

    await idbSaveSessions(parsed, counter)

    // 迁移成功后清理 localStorage 中的会话数据
    localStorage.removeItem('claude-code-gui-sessions')
    localStorage.removeItem('claude-code-gui-session-counter')

    console.log(`[idbStorage] migrated ${parsed.length} sessions from localStorage`)
    return true
  } catch (err) {
    console.warn('[idbStorage] migration failed:', err)
    return false
  }
}
