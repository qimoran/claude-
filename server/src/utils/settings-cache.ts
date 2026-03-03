import { queryOne } from '../db'

// ── Settings 查询缓存（减少数据库访问） ──────────────────
interface CacheEntry {
  value: string | undefined
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const DEFAULT_TTL = 30_000 // 30 秒

export function getCachedSetting(key: string): string | undefined {
  const now = Date.now()
  const entry = cache.get(key)
  if (entry && now < entry.expiresAt) {
    return entry.value
  }
  // 缓存未命中或过期，查数据库
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]) as { value: string } | undefined
  cache.set(key, { value: row?.value, expiresAt: now + DEFAULT_TTL })
  return row?.value
}

// 写入设置时清除缓存
export function invalidateSettingsCache() {
  cache.clear()
}
