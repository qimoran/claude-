// Canonical source: electron/shared-types.ts — 保持字段同步
interface ChatPayload {
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

interface ChatResult {
  success: boolean
  output: string
}

interface ApiConnectionResult {
  connected: boolean
  latency: number
  error?: string
}

interface McpTestResult {
  connected: boolean
  error?: string
}

interface ExportChatMessage {
  role: 'user' | 'assistant'
  content: string
  blocks?: Array<{
    type: string
    toolName?: string
    input?: Record<string, unknown>
    output?: string
    content?: string
    round?: number
  }>
  timestamp: string
}

interface ExportChatResult {
  success: boolean
  path?: string
  error?: string
}

interface HistorySyncResult {
  success: boolean
  mappedTurns?: number
  currentTurn?: number
  minRollbackTurn?: number
  error?: string
}

interface ElectronAPI {
  minimize: () => void
  maximize: () => void
  close: () => void
  getAppVersion: () => Promise<{ success: boolean; version?: string; error?: string }>
  checkForUpdate: () => Promise<{ success: boolean; version?: string; checking?: boolean; error?: string }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => Promise<{ success: boolean; error?: string }>
  onUpdateStatus: (callback: (data: {
    status: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
    version?: string
    releaseNotes?: unknown
    percent?: number
    error?: string
  }) => void) => void
  removeUpdateListeners: () => void
  execute: (payload: ChatPayload) => Promise<ChatResult>
  stream: (payload: ChatPayload) => Promise<{ code: number | null }>
  stopStream: (sessionId?: string) => Promise<{ success: boolean }>
  clearHistory: (sessionId?: string) => Promise<{ success: boolean }>
  syncSessionHistory: (payload: {
    sessionId: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
  }) => Promise<HistorySyncResult>
  confirmTool: (confirmId: string, approved: boolean) => Promise<{ success: boolean }>
  selectFolder: () => Promise<{ canceled: boolean; path: string }>
  selectFiles: () => Promise<{
    canceled: boolean
    files: Array<{
      name: string
      path: string
      content: string
      isImage: boolean
      mediaType?: string
      base64?: string
    }>
  }>
  getGitStatus: (cwd?: string) => Promise<{ success: boolean; output: string }>
  // 连接检测
  checkApiConnection: (config: {
    endpoint: string
    key: string
    format: string
  }) => Promise<ApiConnectionResult>
  // MCP 测试
  testMcpConnection: (config: {
    command: string
    args: string
  }) => Promise<McpTestResult>
  // 对话导出
  exportChat: (data: {
    messages: ExportChatMessage[]
    title: string
    model: string
  }) => Promise<ExportChatResult>
  // 对话导入
  importChat: () => Promise<{
    success: boolean
    content?: string
    format?: 'json' | 'markdown'
    fileName?: string
    error?: string
  }>
  // 回滚
  rollback: (payload: {
    sessionId: string
    targetTurn: number
  }) => Promise<{
    success: boolean
    restored: number
    errors: string[]
    retainedSnapshots?: number
    minRollbackTurn?: number
    error?: string
  }>
  restoreFile: (payload: {
    sessionId: string
    filePath: string
  }) => Promise<{
    success: boolean
    filePath?: string
    removedSnapshots?: number
    error?: string
  }>
  getSnapshots: (sessionId: string) => Promise<Array<{
    filePath: string
    toolName: string
    toolId: string
    turnNumber: number
    existed: boolean
  }>>
  // 目录树和文件读取
  listDirectory: (root: string, dirPath?: string, showHidden?: boolean) => Promise<{
    error: string | null
    entries: Array<{
      name: string
      path: string
      isDir: boolean
      size?: number
      children?: Array<unknown> // undefined=有子项待加载, []=空目录
    }>
    dirPath?: string
  }>
  readFileContent: (root: string, filePath: string) => Promise<{
    content?: string
    size?: number
    error?: string
  }>
  writeFileContent: (root: string, filePath: string, content: string) => Promise<{
    success?: boolean
    error?: string
  }>
  // 外部链接 / 本地文件打开
  openExternal: (payload: { target: string; root?: string }) => Promise<{ success: boolean; error?: string }>
  // 桌面通知
  showNotification: (title: string, body: string) => Promise<{ success: boolean; error?: string }>
  // 安全存储
  secureStoreSet: (key: string, value: string) => Promise<{ success: boolean; error?: string }>
  secureStoreGet: (key: string) => Promise<{ success: boolean; value: string; error?: string }>
  secureStoreDelete: (key: string) => Promise<{ success: boolean; error?: string }>
  // 流式事件（所有回调第一个参数为 sessionId，支持多会话并行）
  onStreamData: (callback: (sessionId: string, data: string) => void) => void
  onStreamError: (callback: (sessionId: string, error: string) => void) => void
  onStreamEnd: (callback: (sessionId: string, code: number) => void) => void
  removeStreamListeners: () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
