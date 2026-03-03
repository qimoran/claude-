import http from 'node:http'
import https from 'node:https'
import type {
  ApiConfig, ToolInput, ContentBlock, ContentBlockText,
  ContentBlockToolUse, ContentBlockToolResult, ContentBlockImage,
  AnthropicMessage,
} from './types'
import { convertToolsToOpenAI } from './tools'
import type { AnthropicToolDefinition } from './tools'

// ── 端点解析 ─────────────────────────────────────────────
export function parseEndpoint(endpoint: string): { protocol: string; hostname: string; port: number; basePath: string } {
  try {
    const url = new URL(endpoint)
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
      basePath: url.pathname.replace(/\/$/, ''),
    }
  } catch {
    return { protocol: 'http:', hostname: '127.0.0.1', port: 3456, basePath: '' }
  }
}

// ── Anthropic 格式流式调用 ──────────────────────────────
export function callAnthropicStream(
  body: string,
  apiConfig: ApiConfig,
  abortCtrl: { aborted: boolean; destroy?: () => void },
  onText: (text: string) => void,
  onToolUse: (id: string, name: string, input: ToolInput) => void,
  onImage: (url: string, alt?: string) => void,
  onUsage: (inputTokens: number, outputTokens: number) => void,
): Promise<{
  stopReason: string | null
  contentBlocks: ContentBlock[]
}> {
  return new Promise((resolve, reject) => {
    const { hostname, port, basePath, protocol } = parseEndpoint(apiConfig.endpoint)
    const reqModule = protocol === 'https:' ? https : http
    const bodyBuffer = Buffer.from(body, 'utf-8')

    const req = reqModule.request(
      {
        hostname,
        port,
        path: `${basePath}/v1/messages`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': bodyBuffer.length,
          'Authorization': `Bearer ${apiConfig.key}`,
          'x-api-key': apiConfig.key || 'dummy',
          'anthropic-version': '2023-06-01',
        },
        timeout: 120_000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errBody = ''
          res.on('data', (chunk) => { errBody += chunk.toString() })
          res.on('end', () => reject(new Error(`API 错误 ${res.statusCode}: ${errBody}`)))
          return
        }

        let sseBuffer = ''
        const contentBlocks: ContentBlock[] = []
        let currentToolUse: { id: string; name: string; jsonBuf: string } | null = null
        let stopReason: string | null = null
        let totalInputTokens = 0
        let totalOutputTokens = 0

        let lastEventType = ''

        res.on('data', (chunk: Buffer) => {
          sseBuffer += chunk.toString()
          const lines = sseBuffer.split('\n')
          sseBuffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              lastEventType = line.slice(7).trim()
              continue
            }
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') continue

            // 处理错误事件
            if (lastEventType === 'error') {
              try {
                const errEvt = JSON.parse(data)
                reject(new Error(`API 错误事件: ${errEvt.error?.message || errEvt.message || data}`))
              } catch {
                reject(new Error(`API 错误事件: ${data}`))
              }
              return
            }
            lastEventType = ''

            try {
              const evt = JSON.parse(data)

              if (evt.type === 'message_start' && evt.message?.usage) {
                totalInputTokens = evt.message.usage.input_tokens || 0
              } else if (evt.type === 'content_block_start') {
                if (evt.content_block?.type === 'tool_use') {
                  currentToolUse = {
                    id: evt.content_block.id,
                    name: evt.content_block.name,
                    jsonBuf: '',
                  }
                } else if (evt.content_block?.type === 'image') {
                  const src = evt.content_block.source
                  if (src?.type === 'base64' && src.data) {
                    const mediaType = src.media_type || 'image/png'
                    onImage(`data:${mediaType};base64,${src.data}`)
                  }
                }
              } else if (evt.type === 'content_block_delta') {
                if (evt.delta?.type === 'text_delta' && evt.delta?.text) {
                  onText(evt.delta.text)
                } else if (evt.delta?.type === 'input_json_delta' && evt.delta?.partial_json && currentToolUse) {
                  currentToolUse.jsonBuf += evt.delta.partial_json
                }
              } else if (evt.type === 'content_block_stop') {
                if (currentToolUse) {
                  let parsedInput: ToolInput = {}
                  try {
                    parsedInput = JSON.parse(currentToolUse.jsonBuf) as ToolInput
                  } catch { /* empty */ }

                  const block: ContentBlockToolUse = {
                    type: 'tool_use',
                    id: currentToolUse.id,
                    name: currentToolUse.name,
                    input: parsedInput,
                  }
                  contentBlocks.push(block)
                  onToolUse(currentToolUse.id, currentToolUse.name, parsedInput)
                  currentToolUse = null
                }
              } else if (evt.type === 'message_delta') {
                if (evt.delta?.stop_reason) {
                  stopReason = evt.delta.stop_reason
                }
                if (evt.usage?.output_tokens) {
                  totalOutputTokens = evt.usage.output_tokens
                }
              }
            } catch {
              // skip parse errors
            }
          }
        })

        res.on('end', () => {
          if (totalInputTokens > 0 || totalOutputTokens > 0) {
            onUsage(totalInputTokens, totalOutputTokens)
          }
          resolve({ stopReason, contentBlocks })
        })

        res.on('error', reject)
      },
    )
    abortCtrl.destroy = () => { req.destroy() }

    req.on('timeout', () => {
      req.destroy(new Error('API 请求超时 (120s 无数据)'))
    })
    req.on('error', reject)
    req.write(bodyBuffer)
    req.end()
  })
}

// ── OpenAI 格式消息转换 ─────────────────────────────────
export function convertMessagesToOpenAI(
  messages: AnthropicMessage[],
  systemPrompt: string,
): Array<{ role: string; content?: string | unknown[]; tool_calls?: unknown[]; tool_call_id?: string }> {
  const result: Array<{ role: string; content?: string | unknown[]; tool_calls?: unknown[]; tool_call_id?: string }> = []

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content })
      } else {
        const toolResults = (msg.content as ContentBlock[])
          .filter((b): b is ContentBlockToolResult => b.type === 'tool_result')
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            result.push({
              role: 'tool',
              content: tr.content || '',
              tool_call_id: tr.tool_use_id || '',
            })
          }
        } else {
          const hasImages = (msg.content as ContentBlock[]).some(b => b.type === 'image')
          if (hasImages) {
            const parts: unknown[] = []
            for (const b of msg.content as ContentBlock[]) {
              if (b.type === 'image') {
                const imgBlock = b as ContentBlockImage
                parts.push({
                  type: 'image_url',
                  image_url: { url: `data:${imgBlock.source.media_type};base64,${imgBlock.source.data}` },
                })
              } else if (b.type === 'text') {
                parts.push({ type: 'text', text: (b as ContentBlockText).text })
              }
            }
            result.push({ role: 'user', content: parts })
          } else {
            const text = (msg.content as ContentBlock[])
              .filter((b): b is ContentBlockText => b.type === 'text')
              .map((b) => b.text)
              .join('')
            result.push({ role: 'user', content: text })
          }
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content })
      } else {
        const textParts = (msg.content as ContentBlock[])
          .filter((b): b is ContentBlockText => b.type === 'text')
          .map((b) => b.text)
          .join('')
        const toolCalls = (msg.content as ContentBlock[])
          .filter((b): b is ContentBlockToolUse => b.type === 'tool_use')
          .map((b) => ({
            id: b.id,
            type: 'function',
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input),
            },
          }))

        const assistantMsg: { role: string; content?: string; tool_calls?: unknown[] } = { role: 'assistant' }
        assistantMsg.content = textParts || ''
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls
        result.push(assistantMsg)
      }
    }
  }

  return result
}

// ── OpenAI 格式流式调用 ─────────────────────────────────
export function callOpenAIStream(
  messages: AnthropicMessage[],
  systemPrompt: string,
  model: string,
  apiConfig: ApiConfig,
  abortCtrl: { aborted: boolean; destroy?: () => void },
  onText: (text: string) => void,
  onToolUse: (id: string, name: string, input: ToolInput) => void,
  onImage: (url: string, alt?: string) => void,
  onUsage: (inputTokens: number, outputTokens: number) => void,
  maxTokens = 8192,
  toolsAnthropic: AnthropicToolDefinition[] = [],
): Promise<{
  stopReason: string | null
  contentBlocks: ContentBlock[]
}> {
  return new Promise((resolve, reject) => {
    const { hostname, port, basePath, protocol } = parseEndpoint(apiConfig.endpoint)
    const reqModule = protocol === 'https:' ? https : http

    const openaiMessages = convertMessagesToOpenAI(messages, systemPrompt)
    const openaiTools = convertToolsToOpenAI(toolsAnthropic)

    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: openaiMessages,
      tools: openaiTools,
    })
    const bodyBuffer = Buffer.from(body, 'utf-8')

    const req = reqModule.request(
      {
        hostname,
        port,
        path: `${basePath}/v1/chat/completions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': bodyBuffer.length,
          'Authorization': `Bearer ${apiConfig.key}`,
        },
        timeout: 120_000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errBody = ''
          res.on('data', (chunk) => { errBody += chunk.toString() })
          res.on('end', () => reject(new Error(`API 错误 ${res.statusCode}: ${errBody}`)))
          return
        }

        let sseBuffer = ''
        const contentBlocks: ContentBlock[] = []
        const toolCallBuffers = new Map<number, { id: string; name: string; argsBuf: string }>()
        const finalizedToolIds = new Set<string>()
        let stopReason: string | null = null
        // 累积 usage 数据，只在流结束时上报一次（避免每个 chunk 都触发导致虚增）
        let lastPromptTokens = 0
        let lastCompletionTokens = 0

        const finalizeToolBuffer = (buf: { id: string; name: string; argsBuf: string }) => {
          if (!buf.id || finalizedToolIds.has(buf.id)) return
          finalizedToolIds.add(buf.id)
          let parsedInput: ToolInput = {}
          try {
            parsedInput = JSON.parse(buf.argsBuf) as ToolInput
          } catch { /* empty */ }
          const block: ContentBlockToolUse = {
            type: 'tool_use',
            id: buf.id,
            name: buf.name,
            input: parsedInput,
          }
          contentBlocks.push(block)
          onToolUse(buf.id, buf.name, parsedInput)
        }

        let lastEventTypeOai = ''

        res.on('data', (chunk: Buffer) => {
          sseBuffer += chunk.toString()
          const lines = sseBuffer.split('\n')
          sseBuffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              lastEventTypeOai = line.slice(7).trim()
              continue
            }
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (!data || data === '[DONE]') continue

            if (lastEventTypeOai === 'error') {
              try {
                const errEvt = JSON.parse(data)
                reject(new Error(`API 错误事件: ${errEvt.error?.message || errEvt.message || data}`))
              } catch {
                reject(new Error(`API 错误事件: ${data}`))
              }
              return
            }
            lastEventTypeOai = ''

            try {
              const evt = JSON.parse(data)

              if (evt.usage) {
                // 只记录最新值，不立即调用 onUsage（等流结束再统一上报）
                lastPromptTokens = evt.usage.prompt_tokens || lastPromptTokens
                lastCompletionTokens = evt.usage.completion_tokens || lastCompletionTokens
              }

              const choice = evt.choices?.[0]
              if (!choice) continue

              const delta = choice.delta
              if (!delta) continue

              if (typeof delta.content === 'string') {
                onText(delta.content)
              } else if (Array.isArray(delta.content)) {
                for (const part of delta.content) {
                  if (typeof part === 'string') {
                    onText(part)
                    continue
                  }
                  const obj = part as Record<string, unknown>
                  const text = typeof obj.text === 'string' ? obj.text : ''
                  if (text) {
                    onText(text)
                    continue
                  }

                  const imageUrlRaw = obj.image_url
                  if (typeof imageUrlRaw === 'string' && imageUrlRaw) {
                    onImage(imageUrlRaw, typeof obj.alt === 'string' ? obj.alt : undefined)
                    continue
                  }
                  if (imageUrlRaw && typeof imageUrlRaw === 'object') {
                    const imageUrlObj = imageUrlRaw as Record<string, unknown>
                    if (typeof imageUrlObj.url === 'string' && imageUrlObj.url) {
                      onImage(imageUrlObj.url, typeof obj.alt === 'string' ? obj.alt : undefined)
                      continue
                    }
                  }

                  if (typeof obj.b64_json === 'string' && obj.b64_json) {
                    const mediaType = typeof obj.media_type === 'string' ? obj.media_type : 'image/png'
                    onImage(`data:${mediaType};base64,${obj.b64_json}`, typeof obj.alt === 'string' ? obj.alt : undefined)
                    continue
                  }

                  if (typeof obj.url === 'string' && obj.url && (/^data:image\//.test(obj.url) || /^https?:\/\//.test(obj.url))) {
                    onImage(obj.url, typeof obj.alt === 'string' ? obj.alt : undefined)
                  }
                }
              }

              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0
                  if (tc.id) {
                    for (const [existingIdx, existingBuf] of toolCallBuffers) {
                      if (existingIdx < idx) {
                        finalizeToolBuffer(existingBuf)
                      }
                    }
                    toolCallBuffers.set(idx, {
                      id: tc.id,
                      name: tc.function?.name || '',
                      argsBuf: tc.function?.arguments || '',
                    })
                  } else {
                    const buf = toolCallBuffers.get(idx)
                    if (buf && tc.function?.arguments) {
                      buf.argsBuf += tc.function.arguments
                    }
                  }
                }
              }

              if (choice.finish_reason) {
                for (const [, buf] of toolCallBuffers) {
                  finalizeToolBuffer(buf)
                }
                if (choice.finish_reason === 'tool_calls') {
                  stopReason = 'tool_use'
                } else if (choice.finish_reason === 'stop') {
                  stopReason = 'end_turn'
                } else {
                  stopReason = choice.finish_reason
                }
              }
            } catch {
              // skip parse errors
            }
          }
        })

        res.on('end', () => {
          for (const [, buf] of toolCallBuffers) {
            finalizeToolBuffer(buf)
          }
          // 流结束时统一上报一次 usage
          if (lastPromptTokens > 0 || lastCompletionTokens > 0) {
            onUsage(lastPromptTokens, lastCompletionTokens)
          }
          resolve({ stopReason, contentBlocks })
        })

        res.on('error', reject)
      },
    )
    abortCtrl.destroy = () => { req.destroy() }

    req.on('timeout', () => {
      req.destroy(new Error('API 请求超时 (120s 无数据)'))
    })
    req.on('error', reject)
    req.write(bodyBuffer)
    req.end()
  })
}

// ── 非流式 API 调用 ─────────────────────────────────────
export function callAPI(body: string, apiConfig: ApiConfig): Promise<{
  statusCode: number
  data: string
}> {
  return new Promise((resolve, reject) => {
    const { hostname, port, basePath, protocol } = parseEndpoint(apiConfig.endpoint)
    const reqModule = protocol === 'https:' ? https : http
    const bodyBuffer = Buffer.from(body, 'utf-8')

    const isOpenAI = apiConfig.format === 'openai'
    const reqPath = isOpenAI
      ? `${basePath}/v1/chat/completions`
      : `${basePath}/v1/messages`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(bodyBuffer.length),
      'Authorization': `Bearer ${apiConfig.key}`,
    }
    if (!isOpenAI) {
      headers['x-api-key'] = apiConfig.key || ''
      headers['anthropic-version'] = '2023-06-01'
    }

    const req = reqModule.request(
      { hostname, port, path: reqPath, method: 'POST', headers, timeout: 60_000 },
      (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk.toString() })
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, data }))
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error('API 请求超时 (60s 无响应)'))
    })
    req.on('error', reject)
    req.write(bodyBuffer)
    req.end()
  })
}
