import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { queryOne, execute } from '../db'

export interface JwtPayload {
  userId: string
  username: string
  role: string
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

// JWT 认证中间件（用于管理后台）
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    res.status(401).json({ error: '未登录' })
    return
  }
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload
    req.user = decoded
    next()
  } catch {
    res.status(401).json({ error: '登录已过期' })
  }
}

// 管理员权限中间件
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' })
    return
  }
  next()
}

// API Key 认证中间件（用于 API 中转）
export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string
    || req.headers.authorization?.replace('Bearer ', '')

  if (!apiKey) {
    res.status(401).json({ error: '缺少 API Key' })
    return
  }

  const user = queryOne(
    'SELECT id, username, role, status, max_tokens_per_day, tokens_used_today, last_reset_date FROM users WHERE api_key = ?',
    [apiKey]
  ) as {
    id: string; username: string; role: string; status: string
    max_tokens_per_day: number; tokens_used_today: number; last_reset_date: string | null
  } | undefined

  if (!user) {
    res.status(401).json({ error: 'API Key 无效' })
    return
  }

  if (user.status !== 'active') {
    res.status(403).json({ error: '账户已停用' })
    return
  }

  // 检查是否需要重置每日用量
  const today = new Date().toISOString().slice(0, 10)
  if (user.last_reset_date !== today) {
    execute('UPDATE users SET tokens_used_today = 0, last_reset_date = ? WHERE id = ?', [today, user.id])
    user.tokens_used_today = 0
  }

  // 检查每日用量限制
  if (user.tokens_used_today >= user.max_tokens_per_day) {
    res.status(429).json({ error: '已达到每日 token 限额', limit: user.max_tokens_per_day, used: user.tokens_used_today })
    return
  }

  req.user = { userId: user.id, username: user.username, role: user.role }
  next()
}
