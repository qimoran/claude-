import { Router, Request, Response } from 'express'
import https from 'https'
import http from 'http'
import { URL } from 'url'
import { config } from '../config'
import { queryOne, execute } from '../db'
import { apiKeyMiddleware } from '../middleware/auth'
import { getCachedSetting } from '../utils/settings-cache'

const router = Router()

interface LogPayloadSummary {
  messageCount: number
  hasStream: boolean
  maxTokens?: number
}

function summarizeRequestPayload(rawBody: string | null): string | null {
  if (!rawBody) return null
  try {
    const parsed = JSON.parse(rawBody) as {
      messages?: unknown[]
      stream?: boolean
      max_tokens?: number
      max_completion_tokens?: number
    }
    const summary: LogPayloadSummary = {
      messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
      hasStream: parsed.stream === true,
    }
    const maxTokens = typeof parsed.max_tokens === 'number'
      ? parsed.max_tokens
      : (typeof parsed.max_completion_tokens === 'number' ? parsed.max_completion_tokens : undefined)
    if (typeof maxTokens === 'number') summary.maxTokens = maxTokens
    return JSON.stringify(summary)
  } catch {
    return '[unparsed-request]'
  }
}

function summarizeResponsePayload(rawBody: string | null): string | null {
  if (!rawBody) return null
  try {
    const parsed = JSON.parse(rawBody) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
      choices?: unknown[]
    }
    const usage = parsed.usage
    return JSON.stringify({
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          }
        : undefined,
      choiceCount: Array.isArray(parsed.choices) ? parsed.choices.length : 0,
    })
  } catch {
    return '[response-redacted]'
  }
}

function shouldLogFullPayload(): boolean {
  const raw = getCachedSetting('log_full_payload')
  return raw === 'true'
}

// 记录用量
function logUsage(
  userId: string, model: string,
  tokensIn: number, tokensOut: number,
  durationMs: number, status: string,
  errorMessage: string | null, ip: string,
  requestBody: string | null = null,
  responseBody: string | null = null,
  fullPayloadMode?: boolean
) {
  const totalTokens = tokensIn + tokensOut
  const keepFull = fullPayloadMode ?? shouldLogFullPayload()
  const requestLogged = keepFull ? requestBody : summarizeRequestPayload(requestBody)
  const responseLogged = keepFull ? responseBody : summarizeResponsePayload(responseBody)
  execute(`
    INSERT INTO usage_logs (user_id, model, tokens_in, tokens_out, total_tokens, duration_ms, status, error_message, ip_address, request_body, response_body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [userId, model, tokensIn, tokensOut, totalTokens, durationMs, status, errorMessage, ip, requestLogged, responseLogged])

  // 检查是否跨天，跨天则重置 tokens_used_today
  const today = new Date().toISOString().slice(0, 10)
  const user = queryOne('SELECT last_reset_date FROM users WHERE id = ?', [userId]) as { last_reset_date: string | null } | undefined
  if (user && user.last_reset_date !== today) {
    execute(`
      UPDATE users SET
        tokens_used_today = ?,
        total_tokens_used = total_tokens_used + ?,
        total_requests = total_requests + 1,
        last_reset_date = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [totalTokens, totalTokens, today, userId])
  } else {
    execute(`
      UPDATE users SET
        tokens_used_today = tokens_used_today + ?,
        total_tokens_used = total_tokens_used + ?,
        total_requests = total_requests + 1,
        last_reset_date = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `, [totalTokens, totalTokens, today, userId])
  }
}

// 获取可用的 API 配置（支持多组，轮询选择）
let apiConfigIndex = 0

interface ApiConfigItem {
  name?: string
  endpoint: string
  apiKey: string
  enabled?: boolean
}

function getApiConfigs(): ApiConfigItem[] {
  const raw = getCachedSetting('api_configs')
  if (raw) {
    try {
      const configs = JSON.parse(raw) as ApiConfigItem[]
      const enabled = configs.filter(c => c.enabled !== false && c.endpoint && c.apiKey)
      if (enabled.length > 0) return enabled
    } catch { /* fallback */ }
  }
  // 兼容旧的单组配置
  const endpoint = getCachedSetting('api_endpoint') || config.defaultApiEndpoint
  const apiKey = getCachedSetting('api_key') || config.defaultApiKey
  if (endpoint && apiKey) return [{ endpoint, apiKey }]
  return []
}

function getApiConfig(): { endpoint: string; apiKey: string } {
  const configs = getApiConfigs()
  if (configs.length === 0) {
    return { endpoint: config.defaultApiEndpoint, apiKey: config.defaultApiKey }
  }
  const idx = apiConfigIndex % configs.length
  apiConfigIndex++
  return { endpoint: configs[idx].endpoint, apiKey: configs[idx].apiKey }
}

// OpenAI 兼容格式 - 聊天补全（非流式）
router.post('/v1/chat/completions', apiKeyMiddleware, async (req: Request, res: Response) => {
  const startTime = Date.now()
  const userId = req.user!.userId
  const model = req.body.model || 'unknown'
  const isStream = req.body.stream === true
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || ''
  const keepFullLog = shouldLogFullPayload()

  try {
    const apiConfig = getApiConfig()
    if (!apiConfig.apiKey) {
      res.status(500).json({ error: '服务端未配置 API Key' })
      return
    }

    // 确保端点包含 /v1
    const base = apiConfig.endpoint.replace(/\/+$/, '')
    const v1Base = base.endsWith('/v1') ? base : `${base}/v1`
    const targetUrl = new URL(`${v1Base}/chat/completions`)
    const bodyStr = JSON.stringify(req.body)

    const options: https.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    }

    const transport = targetUrl.protocol === 'https:' ? https : http

    const proxyReq = transport.request(options, (proxyRes) => {
      if (isStream) {
        // 流式响应
        res.writeHead(proxyRes.statusCode || 200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        let totalChunks = 0
        const streamChunks: Buffer[] = []
        proxyRes.on('data', (chunk: Buffer) => {
          totalChunks += chunk.length
          streamChunks.push(chunk)
          res.write(chunk)
        })

        proxyRes.on('end', () => {
          res.end()
          const durationMs = Date.now() - startTime
          // 提取流式内容和 usage
          const streamText = Buffer.concat(streamChunks).toString('utf-8')
          let streamTokensIn = 0
          let streamTokensOut = 0
          let streamFinalText = ''
          for (const line of streamText.split('\n')) {
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
            try {
              const d = JSON.parse(line.slice(6)) as {
                usage?: { prompt_tokens?: number; completion_tokens?: number }
                choices?: Array<{ delta?: { content?: string } }>
              }
              // 很多 API 在最后一个 chunk 包含 usage
              if (d.usage) {
                streamTokensIn = d.usage.prompt_tokens || 0
                streamTokensOut = d.usage.completion_tokens || 0
              }
              const deltaContent = d.choices?.[0]?.delta?.content
              if (typeof deltaContent === 'string') streamFinalText += deltaContent
            } catch { /* skip */ }
          }
          // 如果 API 没返回 usage，用粗估
          if (!streamTokensOut) streamTokensOut = Math.ceil(totalChunks / 4)
          const streamSummary = JSON.stringify({
            chunks: streamChunks.length,
            totalBytes: totalChunks,
            usage: {
              promptTokens: streamTokensIn,
              completionTokens: streamTokensOut,
              totalTokens: streamTokensIn + streamTokensOut,
            },
          })
          const responseForLog = keepFullLog ? (streamFinalText || streamText) : streamSummary
          logUsage(userId, model, streamTokensIn, streamTokensOut, durationMs, 'success', null, ip, bodyStr, responseForLog, keepFullLog)
        })
      } else {
        // 非流式响应
        const chunks: Buffer[] = []
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          const durationMs = Date.now() - startTime

          try {
            const parsed = JSON.parse(body)
            const tokensIn = parsed.usage?.prompt_tokens || 0
            const tokensOut = parsed.usage?.completion_tokens || 0
            // 传入原始响应体，logUsage 内部会最小化为 usage/choiceCount 摘要
            logUsage(userId, model, tokensIn, tokensOut, durationMs, 'success', null, ip, bodyStr, body, keepFullLog)
            res.status(proxyRes.statusCode || 200).json(parsed)
          } catch {
            logUsage(userId, model, 0, 0, durationMs, 'error', 'Invalid JSON response', ip, bodyStr, body, keepFullLog)
            res.status(proxyRes.statusCode || 502).send(body)
          }
        })
      }
    })

    proxyReq.on('error', (err) => {
      const durationMs = Date.now() - startTime
      logUsage(userId, model, 0, 0, durationMs, 'error', err.message, ip, bodyStr, null, keepFullLog)
      res.status(502).json({ error: `代理请求失败: ${err.message}` })
    })

    proxyReq.write(bodyStr)
    proxyReq.end()
  } catch (err) {
    const durationMs = Date.now() - startTime
    logUsage(userId, model, 0, 0, durationMs, 'error', (err as Error).message, ip, null, null, keepFullLog)
    res.status(500).json({ error: (err as Error).message })
  }
})

// 列出可用模型
router.get('/v1/models', apiKeyMiddleware, async (_req: Request, res: Response) => {
  try {
    const apiConfig = getApiConfig()
    if (!apiConfig.apiKey) {
      res.json({ data: [] })
      return
    }

    const base = apiConfig.endpoint.replace(/\/+$/, '')
    const v1Base = base.endsWith('/v1') ? base : `${base}/v1`
    const targetUrl = new URL(`${v1Base}/models`)
    const transport = targetUrl.protocol === 'https:' ? https : http

    const proxyReq = transport.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiConfig.apiKey}` },
    }, (proxyRes) => {
      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        try {
          res.status(proxyRes.statusCode || 200).json(JSON.parse(body))
        } catch {
          res.status(502).send(body)
        }
      })
    })

    proxyReq.on('error', (err) => {
      res.status(502).json({ error: err.message })
    })
    proxyReq.end()
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
