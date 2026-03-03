import express from 'express'
import cors from 'cors'
import compression from 'compression'
import path from 'path'
import { config } from './config'
import { initDatabase, execute } from './db'
import authRouter from './routes/auth'
import proxyRouter from './routes/proxy'
import adminRouter from './routes/admin'
import { securityHeaders } from './middleware/security'
import { apiLimiter } from './middleware/rate-limit'

// ── 日志自动清理（保留 90 天） ─────────────────────────
function scheduleLogCleanup() {
  const cleanup = () => {
    try {
      execute("DELETE FROM usage_logs WHERE created_at < datetime('now', '-90 days')")
    } catch { /* ignore */ }
  }
  cleanup() // 启动时清理一次
  setInterval(cleanup, 24 * 60 * 60 * 1000) // 每 24 小时清理
}

async function main() {
  // 初始化数据库
  await initDatabase()

  const app = express()

  // ── 安全与性能中间件 ─────────────────────────────────
  app.use(securityHeaders)
  app.use(compression())
  app.use(cors({ origin: config.corsOrigins, credentials: true }))

  // 请求体大小限制：API 代理允许较大请求体，其他接口收紧
  app.use('/api/proxy', express.json({ limit: '10mb' }))
  app.use('/api/auth', express.json({ limit: '100kb' }))
  app.use('/api/admin', express.json({ limit: '1mb' }))
  app.use(express.json({ limit: '100kb' })) // 默认

  // 静态文件（管理后台）
  app.use('/admin', express.static(path.resolve(__dirname, '..', 'public', 'admin')))

  // ── 路由 ──────────────────────────────────────────
  app.use('/api/auth', authRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/proxy', apiLimiter, proxyRouter)

  // 健康检查
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() })
  })

  // 根路径重定向到管理后台
  app.get('/', (_req, res) => {
    res.redirect('/admin/')
  })

  // ── 启动 ──────────────────────────────────────────
  scheduleLogCleanup()

  app.listen(config.port, () => {
    console.log(``)
    console.log(`  Claude Code GUI 后台服务已启动`)
    console.log(`  地址: http://localhost:${config.port}`)
    console.log(`  管理后台: http://localhost:${config.port}/admin/`)
    console.log(`  API 中转: http://localhost:${config.port}/api/proxy/v1/chat/completions`)
    console.log(``)
  })
}

main().catch(err => {
  console.error('启动失败:', err)
  process.exit(1)
})
