import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { config } from '../config'
import { queryOne, execute } from '../db'
import { authMiddleware } from '../middleware/auth'
import { loginLimiter, registerLimiter } from '../middleware/rate-limit'

const router = Router()

// 生成 API Key
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'sk-'
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return key
}

// 注册
router.post('/register', registerLimiter, async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body
    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' })
      return
    }
    if (username.length < 2 || username.length > 32) {
      res.status(400).json({ error: '用户名长度 2-32 位' })
      return
    }
    if (password.length < 6) {
      res.status(400).json({ error: '密码至少 6 位' })
      return
    }

    const existing = queryOne('SELECT id FROM users WHERE username = ?', [username])
    if (existing) {
      res.status(409).json({ error: '用户名已存在' })
      return
    }

    const id = uuidv4()
    const passwordHash = await bcrypt.hash(password, 10)
    const apiKey = generateApiKey()

    execute(`
      INSERT INTO users (id, username, email, password_hash, role, api_key, max_tokens_per_day)
      VALUES (?, ?, ?, ?, 'user', ?, ?)
    `, [id, username, email || null, passwordHash, apiKey, config.defaultDailyTokenLimit])

    const token = jwt.sign({ userId: id, username, role: 'user' }, config.jwtSecret, { expiresIn: '7d' })

    res.json({
      token,
      user: { id, username, email, role: 'user', apiKey },
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 登录
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body
    if (!username || !password) {
      res.status(400).json({ error: '用户名和密码不能为空' })
      return
    }

    const user = queryOne(
      'SELECT id, username, email, password_hash, role, api_key, status FROM users WHERE username = ?',
      [username]
    ) as {
      id: string; username: string; email: string | null; password_hash: string
      role: string; api_key: string; status: string
    } | undefined

    if (!user) {
      res.status(401).json({ error: '用户名或密码错误' })
      return
    }

    if (user.status !== 'active') {
      res.status(403).json({ error: '账户已停用' })
      return
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      res.status(401).json({ error: '用户名或密码错误' })
      return
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      config.jwtSecret,
      { expiresIn: '7d' }
    )

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        apiKey: user.api_key,
      },
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 获取当前用户信息
router.get('/me', authMiddleware, (req: Request, res: Response) => {
  const user = queryOne(
    'SELECT id, username, email, role, api_key, status, max_tokens_per_day, tokens_used_today, total_tokens_used, total_requests, created_at FROM users WHERE id = ?',
    [req.user!.userId]
  ) as Record<string, unknown> | undefined

  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }
  res.json({ user })
})

// 重新生成 API Key
router.post('/regenerate-key', authMiddleware, (req: Request, res: Response) => {
  const newKey = generateApiKey()
  execute('UPDATE users SET api_key = ?, updated_at = datetime("now") WHERE id = ?',
    [newKey, req.user!.userId])
  res.json({ apiKey: newKey })
})

export default router
