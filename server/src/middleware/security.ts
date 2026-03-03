import { Request, Response, NextFunction } from 'express'

// ── 安全响应头（替代 helmet，无需外部依赖） ─────────────
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // 防止 MIME 类型嗅探
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // 防止点击劫持
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  // XSS 过滤（旧浏览器）
  res.setHeader('X-XSS-Protection', '1; mode=block')
  // 控制 Referrer 信息泄漏
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // 禁止浏览器缓存敏感 API 响应
  if (_req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
  }
  next()
}
