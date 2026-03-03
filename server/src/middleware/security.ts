import { Request, Response, NextFunction } from 'express'

// ── 安全响应头（替代 helmet，无需外部依赖） ─────────────
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // 防止 MIME 类型嗅探
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // 防止点击劫持
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  // XSS 过滤（旧浏览器）
  res.setHeader('X-XSS-Protection', '1; mode=block')
  // 控制 Referrer 信息泄漏
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // 禁止浏览器推测执行读取跨站资源
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  // 限制权限能力
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  // HSTS 仅在 HTTPS 下发送，避免影响本地 http 开发
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  const requestPath = (req.originalUrl || req.path || '').split('?')[0]

  if (requestPath.startsWith('/admin')) {
    // 管理后台暂时保留 tailwind CDN 与内联脚本能力
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
  } else {
    // 其他页面默认禁用内联脚本
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
  }

  // 禁止浏览器缓存敏感 API 响应
  if (requestPath.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
  }
  next()
}
