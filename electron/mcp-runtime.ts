import path from 'node:path'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { McpServerPayload } from './shared-types'
import type { AnthropicToolDefinition } from './tools'

interface JsonRpcResponse {
  jsonrpc?: string
  id?: number | string | null
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
  input_schema?: {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

interface ToolNameMapping {
  serverId: string
  serverName: string
  toolName: string
}

interface ToolCallResultContentItem {
  type?: string
  text?: string
  [key: string]: unknown
}

interface ToolCallResult {
  content?: ToolCallResultContentItem[]
  [key: string]: unknown
}

type McpTransportMode = 'content-length' | 'jsonl'

interface ServerRuntime {
  server: McpServerPayload
  child: ChildProcessWithoutNullStreams
  ready: boolean
  closed: boolean
  requestId: number
  pending: Map<number, PendingRequest>
  stdoutBuffer: string
  toolCache: McpToolInfo[]
  transportMode: McpTransportMode
}

interface ServerInitResult {
  server: McpServerPayload
  runtime?: ServerRuntime
  error?: string
}

const MCP_INITIALIZE_TIMEOUT_MS = 12_000
const MCP_LIST_TOOLS_TIMEOUT_MS = 10_000
const MCP_TOOL_CALL_TIMEOUT_MS = 30_000
const MCP_STDIO_MAX_BUFFER_CHARS = 5_000_000

const DANGEROUS_MCP_COMMANDS = new Set(['cmd', 'powershell', 'pwsh', 'sh', 'bash', 'zsh'])

function sanitizeCommandOrThrow(commandRaw: string): string {
  const command = (commandRaw || '').trim()
  if (!command) throw new Error('MCP 命令不能为空')
  if (/['"`;&|><\n\r]/.test(command)) throw new Error('MCP 命令包含非法字符')

  const commandBase = path.basename(command).toLowerCase()
  if (DANGEROUS_MCP_COMMANDS.has(commandBase)) {
    throw new Error(`不允许将高风险命令作为 MCP 启动命令: ${commandBase}`)
  }

  return command
}

function sanitizeArgs(rawArgs?: string): string[] {
  const source = (rawArgs || '').trim()
  if (!source) return []
  if (/[\n\r]/.test(source)) throw new Error('MCP 参数包含非法换行符')

  const args = source.split(/\s+/).filter(Boolean)
  if (args.some(a => /[`;&|><]/.test(a))) throw new Error('MCP 参数包含非法控制符')
  return args
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function normalizeInputSchema(raw: unknown): {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
} {
  const obj = ensureObject(raw)
  const propsRaw = obj.properties
  const properties = propsRaw && typeof propsRaw === 'object' && !Array.isArray(propsRaw)
    ? (propsRaw as Record<string, unknown>)
    : {}

  const requiredRaw = obj.required
  const required = Array.isArray(requiredRaw)
    ? requiredRaw.filter((v): v is string => typeof v === 'string')
    : undefined

  return {
    type: 'object',
    properties,
    required: required && required.length > 0 ? required : undefined,
  }
}

function buildToolAlias(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`
}

function parseToolAlias(alias: string): { serverId: string; toolName: string } | null {
  const prefix = 'mcp__'
  if (!alias.startsWith(prefix)) return null
  const rest = alias.slice(prefix.length)
  const splitIdx = rest.indexOf('__')
  if (splitIdx <= 0 || splitIdx >= rest.length - 2) return null
  const serverId = rest.slice(0, splitIdx)
  const toolName = rest.slice(splitIdx + 2)
  if (!serverId || !toolName) return null
  return { serverId, toolName }
}

export class McpRuntime {
  private sessionId: string

  private runtimes = new Map<string, ServerRuntime>()

  private toolMappings = new Map<string, ToolNameMapping>()

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  async init(servers: McpServerPayload[]): Promise<{ tools: AnthropicToolDefinition[]; warnings: string[] }> {
    await this.shutdown()

    const normalizedServers = servers
      .map((s) => ({
        id: (s.id || '').trim(),
        name: (s.name || '').trim(),
        command: (s.command || '').trim(),
        args: (s.args || '').trim() || undefined,
      }))
      .filter((s) => s.id && s.command)

    if (normalizedServers.length === 0) {
      return { tools: [], warnings: [] }
    }

    const results = await Promise.all(normalizedServers.map(server => this.startServer(server)))
    const warnings: string[] = []
    const allTools: AnthropicToolDefinition[] = []

    for (const result of results) {
      if (!result.runtime) {
        warnings.push(`[MCP:${result.server.name || result.server.id}] ${result.error || '启动失败'}`)
        continue
      }

      let tools: McpToolInfo[]
      try {
        tools = await this.listTools(result.runtime)
      } catch (err) {
        warnings.push(`[MCP:${result.server.name || result.server.id}] tools/list 失败: ${toErrorMessage(err)}`)
        this.disposeRuntime(result.runtime)
        continue
      }

      for (const tool of tools) {
        const toolName = (tool.name || '').trim()
        if (!toolName) continue

        const alias = buildToolAlias(result.server.id, toolName)
        if (this.toolMappings.has(alias)) {
          warnings.push(`[MCP:${result.server.name || result.server.id}] 工具名冲突，已跳过: ${toolName}`)
          continue
        }

        this.toolMappings.set(alias, {
          serverId: result.server.id,
          serverName: result.server.name || result.server.id,
          toolName,
        })

        allTools.push({
          name: alias,
          description: `[MCP:${result.server.name || result.server.id}] ${tool.description || toolName}`,
          input_schema: normalizeInputSchema(tool.inputSchema || tool.input_schema),
        })
      }
    }

    return { tools: allTools, warnings }
  }

  getAvailableToolNames(): string[] {
    return Array.from(this.toolMappings.keys())
  }

  async callTool(alias: string, input: Record<string, unknown>): Promise<string> {
    const mapping = this.toolMappings.get(alias)
    if (!mapping) {
      // 兼容：允许运行时直接按命名规则调用
      const parsed = parseToolAlias(alias)
      if (!parsed) return `[error] 未知 MCP 工具: ${alias}`
      const runtime = this.runtimes.get(parsed.serverId)
      if (!runtime) return `[error] MCP 服务未就绪: ${parsed.serverId}`
      return this.callToolOnRuntime(runtime, parsed.toolName, input, parsed.serverId)
    }

    const runtime = this.runtimes.get(mapping.serverId)
    if (!runtime) {
      return `[error] MCP 服务不可用: ${mapping.serverName}`
    }

    return this.callToolOnRuntime(runtime, mapping.toolName, input, mapping.serverName)
  }

  async shutdown(): Promise<void> {
    for (const runtime of Array.from(this.runtimes.values())) {
      this.disposeRuntime(runtime)
    }
    this.runtimes.clear()
    this.toolMappings.clear()
  }

  private async startServer(server: McpServerPayload): Promise<ServerInitResult> {
    try {
      const command = sanitizeCommandOrThrow(server.command)
      const args = sanitizeArgs(server.args)

      const child = spawn(command, args, {
        shell: false,
        stdio: 'pipe',
      })

      const runtime: ServerRuntime = {
        server,
        child,
        ready: false,
        closed: false,
        requestId: 0,
        pending: new Map(),
        stdoutBuffer: '',
        toolCache: [],
        transportMode: 'jsonl',
      }

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      child.stdout.on('data', (chunk: string) => {
        this.consumeStdout(runtime, chunk)
      })

      child.stderr.on('data', (chunk: string) => {
        const msg = chunk.toString().trim()
        if (msg) console.warn(`[MCP ${this.sessionId}:${server.id} stderr] ${msg}`)
      })

      child.on('error', (err) => {
        this.failAllPending(runtime, new Error(`MCP 进程错误: ${err.message}`))
      })

      child.on('close', (code, signal) => {
        runtime.closed = true
        this.failAllPending(runtime, new Error(`MCP 进程已退出 (code=${code ?? 'null'}, signal=${signal ?? 'null'})`))
      })

      await this.initializeServer(runtime)

      this.runtimes.set(server.id, runtime)
      return { server, runtime }
    } catch (err) {
      return { server, error: toErrorMessage(err) }
    }
  }

  private async initializeServer(runtime: ServerRuntime): Promise<void> {
    const initResult = await this.sendRequest(
      runtime,
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'claude-code-gui',
          version: '1.0.0',
        },
      },
      MCP_INITIALIZE_TIMEOUT_MS,
    )

    const initObj = ensureObject(initResult)
    if (initObj && initObj.protocolVersion && typeof initObj.protocolVersion !== 'string') {
      throw new Error('MCP initialize 返回了无效 protocolVersion')
    }

    this.sendNotification(runtime, 'notifications/initialized', {})
    runtime.ready = true
  }

  private async listTools(runtime: ServerRuntime): Promise<McpToolInfo[]> {
    const result = await this.sendRequest(runtime, 'tools/list', {}, MCP_LIST_TOOLS_TIMEOUT_MS)
    const obj = ensureObject(result)
    const toolsRaw = obj.tools
    const tools = Array.isArray(toolsRaw)
      ? toolsRaw.filter((t): t is McpToolInfo => Boolean(t && typeof t === 'object' && typeof (t as McpToolInfo).name === 'string'))
      : []
    runtime.toolCache = tools
    return tools
  }

  private async callToolOnRuntime(
    runtime: ServerRuntime,
    toolName: string,
    input: Record<string, unknown>,
    serverName: string,
  ): Promise<string> {
    try {
      const resultRaw = await this.sendRequest(
        runtime,
        'tools/call',
        {
          name: toolName,
          arguments: input || {},
        },
        MCP_TOOL_CALL_TIMEOUT_MS,
      )

      const result = ensureObject(resultRaw) as ToolCallResult
      return this.formatToolCallResult(serverName, toolName, result)
    } catch (err) {
      return `[error] MCP 调用失败 (${serverName}/${toolName}): ${toErrorMessage(err)}`
    }
  }

  private formatToolCallResult(serverName: string, toolName: string, result: ToolCallResult): string {
    const parts: string[] = []

    if (Array.isArray(result.content) && result.content.length > 0) {
      for (const item of result.content) {
        if (item && typeof item === 'object') {
          if (item.type === 'text' && typeof item.text === 'string') {
            parts.push(item.text)
          } else {
            parts.push(JSON.stringify(item, null, 2))
          }
        }
      }
    }

    if (parts.length > 0) {
      return parts.join('\n\n')
    }

    return JSON.stringify({ mcpServer: serverName, toolName, result }, null, 2)
  }

  private sendNotification(runtime: ServerRuntime, method: string, params: Record<string, unknown>) {
    if (runtime.closed) return
    this.writeMessage(runtime, {
      jsonrpc: '2.0',
      method,
      params,
    })
  }

  private sendRequest(
    runtime: ServerRuntime,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (runtime.closed) {
      return Promise.reject(new Error('MCP 进程已关闭'))
    }

    const id = ++runtime.requestId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        runtime.pending.delete(id)
        reject(new Error(`MCP 请求超时: ${method} (${timeoutMs}ms)`))
      }, timeoutMs)

      runtime.pending.set(id, { resolve, reject, timeout })

      try {
        this.writeMessage(runtime, {
          jsonrpc: '2.0',
          id,
          method,
          params,
        })
      } catch (err) {
        clearTimeout(timeout)
        runtime.pending.delete(id)
        reject(err as Error)
      }
    })
  }

  private writeMessage(runtime: ServerRuntime, payload: Record<string, unknown>) {
    const json = JSON.stringify(payload)

    if (runtime.transportMode === 'jsonl') {
      runtime.child.stdin.write(`${json}\n`)
      return
    }

    const body = Buffer.from(json, 'utf8')
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8')
    runtime.child.stdin.write(Buffer.concat([header, body]))
  }

  private consumeStdout(runtime: ServerRuntime, chunk: string) {
    if (runtime.closed) return

    runtime.stdoutBuffer += chunk
    if (runtime.stdoutBuffer.length > MCP_STDIO_MAX_BUFFER_CHARS) {
      runtime.stdoutBuffer = runtime.stdoutBuffer.slice(-Math.floor(MCP_STDIO_MAX_BUFFER_CHARS / 2))
    }

    // 1) 优先解析 Content-Length 帧
    while (true) {
      const headerEnd = runtime.stdoutBuffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break

      const header = runtime.stdoutBuffer.slice(0, headerEnd)
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!contentLengthMatch) break

      const contentLength = parseInt(contentLengthMatch[1], 10)
      const totalLength = headerEnd + 4 + contentLength
      if (runtime.stdoutBuffer.length < totalLength) break

      const jsonText = runtime.stdoutBuffer.slice(headerEnd + 4, totalLength)
      runtime.stdoutBuffer = runtime.stdoutBuffer.slice(totalLength)
      runtime.transportMode = 'content-length'

      try {
        const message = JSON.parse(jsonText) as JsonRpcResponse
        this.handleMessage(runtime, message)
      } catch {
        // ignore malformed packet
      }
    }

    // 2) 再解析 JSONL（每行一个 JSON）
    while (true) {
      const newlineIdx = runtime.stdoutBuffer.indexOf('\n')
      if (newlineIdx === -1) break

      const line = runtime.stdoutBuffer.slice(0, newlineIdx).trim()
      runtime.stdoutBuffer = runtime.stdoutBuffer.slice(newlineIdx + 1)
      if (!line) continue

      if (/^Content-Length\s*:/i.test(line)) {
        // 可能是被拆开的 header 起始行，等待更多数据
        runtime.stdoutBuffer = `${line}\n${runtime.stdoutBuffer}`
        break
      }

      try {
        const message = JSON.parse(line) as JsonRpcResponse
        runtime.transportMode = 'jsonl'
        this.handleMessage(runtime, message)
      } catch {
        // 非 JSON 行（日志等）忽略
      }
    }
  }

  private handleMessage(runtime: ServerRuntime, message: JsonRpcResponse) {
    if (message.id === undefined || message.id === null) {
      return
    }

    const numericId = typeof message.id === 'number' ? message.id : Number(message.id)
    if (!Number.isFinite(numericId)) return

    const pending = runtime.pending.get(numericId)
    if (!pending) return

    clearTimeout(pending.timeout)
    runtime.pending.delete(numericId)

    if (message.error) {
      pending.reject(new Error(message.error.message || 'MCP 请求失败'))
      return
    }

    pending.resolve(message.result)
  }

  private failAllPending(runtime: ServerRuntime, err: Error) {
    for (const [id, pending] of runtime.pending) {
      clearTimeout(pending.timeout)
      pending.reject(err)
      runtime.pending.delete(id)
    }
  }

  private disposeRuntime(runtime: ServerRuntime) {
    this.failAllPending(runtime, new Error('MCP 服务已关闭'))

    if (!runtime.child.killed) {
      try {
        runtime.child.kill('SIGTERM')
      } catch {
        // ignore
      }

      const timer = setTimeout(() => {
        if (!runtime.child.killed) {
          try {
            runtime.child.kill('SIGKILL')
          } catch {
            // ignore
          }
        }
      }, 1500)
      timer.unref?.()
    }

    runtime.closed = true
    this.runtimes.delete(runtime.server.id)

    for (const [alias, mapping] of this.toolMappings) {
      if (mapping.serverId === runtime.server.id) {
        this.toolMappings.delete(alias)
      }
    }
  }
}
