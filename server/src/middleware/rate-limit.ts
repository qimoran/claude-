import { Request, Response, NextFunction } from 'express'

// ── 内存限流器（无需外部依赖） ──────────────────────────
interface RateEntry {
  count: number
  resetAt: number
}

const stores = new Map<string, Map<string, RateEntry>>()

// 定期清理过期条目（每 60 秒）
setInterval(() => {
  const now = Date.now()
  for (const store of stores.values()) {
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }
}, 60_000)

interface RateLimitOptions {
  windowMs: number       // 时间窗口（毫秒）
  max: number            // 窗口内最大请求数
  keyFn?: (req: Request) => string  // 自定义 key 生成
  message?: string       // 超限提示
  storeName?: string     // 存储名（多个限流器互不干扰）
}

export function rateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyFn = (req) => (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown',
    message = '请求过于频繁，请稍后再试',
    storeName = 'default',
  } = options

  if (!stores.has(storeName)) stores.set(storeName, new Map())
  const store = stores.get(storeName)!

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn(req)
    const now = Date.now()
    const entry = store.get(key)

    if (!entry || now > entry.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    entry.count++
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      res.set('Retry-After', String(retryAfter))
      res.status(429).json({ error: message })
      return
    }

    next()
  }
}

// 预定义：登录接口限流（每 IP 每 15 分钟最多 10 次）
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: '登录尝试过于频繁，请 15 分钟后再试',
  storeName: 'login',
})

// 预定义：API 代理限流（每 Key 每分钟最多 30 次）
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyFn: (req) => {
    const apiKey = req.headers['x-api-key'] as string
      || req.headers.authorization?.replace('Bearer ', '')
    if (apiKey) return `api:${apiKey}`

    const clientIp = (req.headers['x-forwarded-for'] as string)
      || req.socket.remoteAddress
      || 'unknown'
    return `ip:${clientIp}`
  },
  message: '请求过于频繁，请稍后再试（每分钟最多 30 次）',
  storeName: 'api',
})

// 预定义：注册接口限流（每 IP 每小时最多 5 次）
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: '注册过于频繁，请 1 小时后再试',
  storeName: 'register',
})
