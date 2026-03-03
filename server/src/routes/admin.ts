import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { config } from '../config'
import { queryOne, queryAll, execute, transaction } from '../db'
import { authMiddleware, adminMiddleware } from '../middleware/auth'
import { invalidateSettingsCache } from '../utils/settings-cache'

const router = Router()

// 所有管理路由都需要管理员权限
router.use(authMiddleware, adminMiddleware)

// ── 用户管理 ──────────────────────────────────────────

// 用户列表
router.get('/users', (_req: Request, res: Response) => {
  const users = queryAll(`
    SELECT id, username, email, role, api_key, status,
      max_tokens_per_day,
      CASE WHEN last_reset_date = date('now') THEN tokens_used_today ELSE 0 END as tokens_used_today,
      total_tokens_used, total_requests,
      note, created_at, updated_at
    FROM users ORDER BY created_at DESC
  `)
  res.json({ users })
})

// 创建用户
router.post('/users', async (req: Request, res: Response) => {
  try {
    const { username, email, password, role, maxTokensPerDay, note } = req.body
    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' })
      return
    }

    const existing = queryOne('SELECT id FROM users WHERE username = ?', [username])
    if (existing) {
      res.status(409).json({ error: '用户名已存在' })
      return
    }

    const id = uuidv4()
    const passwordHash = await bcrypt.hash(password, 10)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let apiKey = 'sk-'
    for (let i = 0; i < 48; i++) apiKey += chars.charAt(Math.floor(Math.random() * chars.length))

    execute(`
      INSERT INTO users (id, username, email, password_hash, role, api_key, max_tokens_per_day, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, username, email || null, passwordHash,
      role || 'user', apiKey,
      maxTokensPerDay || config.defaultDailyTokenLimit,
      note || null
    ])

    const user = queryOne('SELECT * FROM users WHERE id = ?', [id])
    res.json({ user })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 更新用户
router.put('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { username, email, password, role, status, maxTokensPerDay, note } = req.body

    const user = queryOne('SELECT id FROM users WHERE id = ?', [id])
    if (!user) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    if (username) {
      const dup = queryOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, id])
      if (dup) {
        res.status(409).json({ error: '用户名已被占用' })
        return
      }
    }

    const updates: string[] = []
    const values: unknown[] = []

    if (username) { updates.push('username = ?'); values.push(username) }
    if (email !== undefined) { updates.push('email = ?'); values.push(email || null) }
    if (role) { updates.push('role = ?'); values.push(role) }
    if (status) { updates.push('status = ?'); values.push(status) }
    if (maxTokensPerDay !== undefined) { updates.push('max_tokens_per_day = ?'); values.push(maxTokensPerDay) }
    if (note !== undefined) { updates.push('note = ?'); values.push(note || null) }
    if (password) {
      const hash = await bcrypt.hash(password, 10)
      updates.push('password_hash = ?'); values.push(hash)
    }

    if (updates.length === 0) {
      res.status(400).json({ error: '没有需要更新的字段' })
      return
    }

    updates.push('updated_at = datetime("now")')
    values.push(id)

    execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values)

    const updated = queryOne(`
      SELECT id, username, email, role, api_key, status,
        max_tokens_per_day, tokens_used_today, total_tokens_used, total_requests,
        note, created_at, updated_at
      FROM users WHERE id = ?
    `, [id])
    res.json({ user: updated })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 删除用户
router.delete('/users/:id', (req: Request, res: Response) => {
  const { id } = req.params
  if (id === req.user!.userId) {
    res.status(400).json({ error: '不能删除自己' })
    return
  }
  execute('DELETE FROM users WHERE id = ?', [id])
  res.json({ success: true })
})

// 重置用户每日用量
router.post('/users/:id/reset-usage', (req: Request, res: Response) => {
  const { id } = req.params
  execute('UPDATE users SET tokens_used_today = 0, updated_at = datetime("now") WHERE id = ?', [id])
  res.json({ success: true })
})

// 重新生成用户 API Key
router.post('/users/:id/regenerate-key', (req: Request, res: Response) => {
  const { id } = req.params
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let apiKey = 'sk-'
  for (let i = 0; i < 48; i++) apiKey += chars.charAt(Math.floor(Math.random() * chars.length))
  execute('UPDATE users SET api_key = ?, updated_at = datetime("now") WHERE id = ?', [apiKey, id])
  res.json({ apiKey })
})

// ── 统计 ──────────────────────────────────────────────

// 总览统计
router.get('/stats/overview', (_req: Request, res: Response) => {
  const totalUsers = (queryOne('SELECT COUNT(*) as c FROM users') as { c: number })?.c ?? 0
  const activeUsers = (queryOne("SELECT COUNT(*) as c FROM users WHERE status = 'active'") as { c: number })?.c ?? 0
  const totalRequests = (queryOne('SELECT COALESCE(SUM(total_requests), 0) as c FROM users') as { c: number })?.c ?? 0
  const totalTokens = (queryOne('SELECT COALESCE(SUM(total_tokens_used), 0) as c FROM users') as { c: number })?.c ?? 0
  const todayTokens = (queryOne(
    "SELECT COALESCE(SUM(total_tokens), 0) as c FROM usage_logs WHERE created_at >= date('now')"
  ) as { c: number })?.c ?? 0

  const todayRequests = (queryOne(
    "SELECT COUNT(*) as c FROM usage_logs WHERE created_at >= date('now')"
  ) as { c: number })?.c ?? 0

  res.json({ totalUsers, activeUsers, totalRequests, totalTokens, todayRequests, todayTokens })
})

// 最近用量（按天统计，近 30 天）
router.get('/stats/daily', (_req: Request, res: Response) => {
  const rows = queryAll(`
    SELECT date(created_at) as date,
      COUNT(*) as requests,
      COALESCE(SUM(total_tokens), 0) as tokens,
      COUNT(DISTINCT user_id) as active_users
    FROM usage_logs
    WHERE created_at >= date('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `)
  res.json({ daily: rows })
})

// 用户排行（按总用量）
router.get('/stats/top-users', (_req: Request, res: Response) => {
  const rows = queryAll(`
    SELECT id, username, total_tokens_used, total_requests,
      CASE WHEN last_reset_date = date('now') THEN tokens_used_today ELSE 0 END as tokens_used_today
    FROM users ORDER BY total_tokens_used DESC LIMIT 20
  `)
  res.json({ users: rows })
})

// 最近请求日志
router.get('/stats/logs', (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200)
  const offset = parseInt(req.query.offset as string) || 0
  const userId = req.query.userId as string

  let sql = `
    SELECT l.*, u.username
    FROM usage_logs l
    LEFT JOIN users u ON l.user_id = u.id
  `
  const params: unknown[] = []

  if (userId) {
    sql += ' WHERE l.user_id = ?'
    params.push(userId)
  }

  sql += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const rows = queryAll(sql, params)
  const total = userId
    ? (queryOne('SELECT COUNT(*) as c FROM usage_logs WHERE user_id = ?', [userId]) as { c: number })?.c ?? 0
    : (queryOne('SELECT COUNT(*) as c FROM usage_logs') as { c: number })?.c ?? 0

  res.json({ logs: rows, total })
})

// ── 系统设置 ──────────────────────────────────────────

// 获取设置
router.get('/settings', (_req: Request, res: Response) => {
  const rows = queryAll('SELECT key, value FROM settings') as { key: string; value: string }[]
  const settings: Record<string, string> = {}
  for (const row of rows) settings[row.key] = row.value
  res.json({ settings })
})

// 更新设置
router.put('/settings', (req: Request, res: Response) => {
  const { settings } = req.body
  if (!settings || typeof settings !== 'object') {
    res.status(400).json({ error: '无效的设置数据' })
    return
  }

  transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      execute(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
      `, [key, String(value)])
    }
  })

  invalidateSettingsCache()
  res.json({ success: true })
})

export default router
