// ── 跨模块共享类型定义 ──────────────────────────────────

export interface ToolInput {
  command?: string
  file_path?: string
  content?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
  pattern?: string
  path?: string
}

export interface ContentBlockText {
  type: 'text'
  text: string
}

export interface ContentBlockToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: ToolInput
}

export interface ContentBlockToolResult {
  type: 'tool_result'
  tool_use_id: string
  content: string
}

export interface ContentBlockImage {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export type ContentBlock = ContentBlockText | ContentBlockToolUse | ContentBlockToolResult | ContentBlockImage

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ImageAttachment {
  mediaType: string
  base64: string
}

export interface ApiConfig {
  endpoint: string
  key: string
  format: 'anthropic' | 'openai'
}

export interface FileSnapshot {
  filePath: string
  existed: boolean
  content: string | null
  toolName: string
  toolId: string
  turnNumber: number
}

export interface SessionTurnInfo {
  currentTurn: number
  turnEndHistoryIndex: Map<number, number>
  // 最早可精确回滚轮次。默认 -1（允许全量回滚）。
  // 当历史被头部重写/截断后会提升到最小可映射轮次。
  minRollbackTurn: number
}

export interface RollbackSnapshotResult {
  restored: number
  errors: string[]
  retainedSnapshots: number
}

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
  children?: DirEntry[]
}
