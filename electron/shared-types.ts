// ── 跨进程共享类型（main / preload / renderer 共用）──────

export interface McpServerPayload {
  id: string
  name: string
  command: string
  args?: string
  env?: Record<string, string>
}

export interface ChatPayload {
  prompt?: string
  model?: string
  cwd?: string
  sessionId?: string
  skipPermissions?: boolean
  apiEndpoint?: string
  apiKey?: string
  apiFormat?: 'anthropic' | 'openai'
  images?: Array<{ mediaType: string; base64: string }>
  customSystemPrompt?: string
  useClaudeCodePrompt?: boolean
  maxTokens?: number
  mcpServers?: McpServerPayload[]
}

export interface HistorySyncMessage {
  role: 'user' | 'assistant'
  content: string
}
