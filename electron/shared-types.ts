// ── 跨进程共享类型（main / preload / renderer 共用）──────

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
}

export interface HistorySyncMessage {
  role: 'user' | 'assistant'
  content: string
}
