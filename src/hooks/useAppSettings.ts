import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createElement } from 'react'

const SETTINGS_STORAGE_KEY = 'claude-code-gui-settings-v3'

// ── 类型定义 ──────────────────────────────────────────────

export interface HookConfig {
  id: string
  event: 'PreToolUse' | 'PostToolUse' | 'Notification'
  command: string
  enabled: boolean
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string
  env: Array<{ key: string; value: string }>
  status: 'connected' | 'disconnected' | 'unknown'
}

export type EndpointSlot = 'main' | 'alt' | 'third' | 'auto'

export interface ModelConfig {
  id: string
  name: string      // 显示名
  modelId: string   // 实际 API 模型 ID
  endpoint?: EndpointSlot // 指定走哪个端点（默认 auto = 按前缀自动匹配）
  pricing?: {
    inputPerMillion: number
    outputPerMillion: number
    cacheCreationInputPerMillion?: number
    cacheReadInputPerMillion?: number
    reasoningPerMillion?: number
  }
}

export interface AppSettings {
  // API 配置
  apiEndpoint: string
  // 备用 API 端点（例如你的 8045：Gemini/Claude 4.5 等）
  altApiEndpoint: string
  // 主端点（例如 3456）API Key
  apiKey: string
  // 备用端点（例如 8045）API Key
  altApiKey: string
  apiFormat: 'anthropic' | 'openai'
  altApiFormat: 'anthropic' | 'openai'
  // 第三端点（中转站）
  thirdApiEndpoint: string
  thirdApiKey: string
  thirdApiFormat: 'anthropic' | 'openai'
  // 模型
  defaultModel: string
  customModel: string
  models: ModelConfig[]
  // 工作目录
  workingDirectory: string
  // 权限
  dangerouslySkipPermissions: boolean
  // Hooks
  hooks: HookConfig[]
  // MCP 服务器
  mcpServers: McpServerConfig[]
  // 字体大小
  fontSizeChat: number    // 聊天消息文字 (12-20)
  fontSizeCode: number    // 代码块 (11-18)
  fontSizeUI: number      // 界面文字 (11-16)
  // 系统提示词
  useClaudeCodePrompt: boolean  // 是否注入 Claude Code 风格系统提示词
  // 模型参数
  maxTokens: number  // 最大输出 token 数 (1024-32768)
  // 主题
  chatTheme: 'dark' | 'light'
}

const DEFAULT_MODELS: ModelConfig[] = [
  // claude-code-router 常用写法："provider,model"，例如 dwf,glm-5
  { id: 'default-1', name: 'GLM-5 (dwf)', modelId: 'dwf,glm-5' },
  { id: 'default-2', name: 'GLM-5', modelId: 'glm-5' },

  // 你 8045 端口支持的模型（按截图补充）
  { id: 'default-3', name: 'Gemini 3 Pro High', modelId: 'gemini-3-pro-high' },
  { id: 'default-4', name: 'Gemini 3 Flash', modelId: 'gemini-3-flash' },
  { id: 'default-5', name: 'Gemini 3 Pro Low', modelId: 'gemini-3-pro-low' },
  { id: 'default-6', name: 'Gemini 2.5 Flash', modelId: 'gemini-2.5-flash' },
  { id: 'default-7', name: 'Gemini 2.5 Flash Lite', modelId: 'gemini-2.5-flash-lite' },
  { id: 'default-8', name: 'Gemini 2.5 Flash Think', modelId: 'gemini-2.5-flash-thinking' },
  { id: 'default-9', name: 'Claude 4.5', modelId: 'claude-sonnet-4-5' },
  { id: 'default-10', name: 'Claude 4.5 TK', modelId: 'claude-sonnet-4-5-thinking' },
  { id: 'default-11', name: 'Claude 4.6 TK', modelId: 'claude-opus-4-6-thinking' },

  // 其他常用模型（保留）
  { id: 'default-12', name: 'Claude Sonnet 4', modelId: 'claude-sonnet-4-20250514' },
  { id: 'default-13', name: 'Claude Opus 4', modelId: 'claude-opus-4-20250514' },
  { id: 'default-14', name: 'GPT-4o', modelId: 'gpt-4o' },
  { id: 'default-15', name: 'GPT-4o Mini', modelId: 'gpt-4o-mini' },
  { id: 'default-16', name: 'DeepSeek Chat', modelId: 'deepseek-chat' },

  // 兼容旧 ID（部分网关仍使用该写法）
  { id: 'default-legacy-1', name: 'Claude Sonnet 4.5 (兼容ID)', modelId: 'claude-sonnet-4.5' },
]

const DEFAULT_SETTINGS: AppSettings = {
  apiEndpoint: 'https://www.aidawan.fun',
  altApiEndpoint: 'http://127.0.0.1:8045',
  thirdApiEndpoint: 'https://fucaixie.xyz',
  apiKey: '',
  altApiKey: '',
  thirdApiKey: '',
  apiFormat: 'openai',
  altApiFormat: 'openai',
  thirdApiFormat: 'openai',
  defaultModel: 'glm-5',
  customModel: '',
  models: DEFAULT_MODELS,
  workingDirectory: '',
  dangerouslySkipPermissions: false,
  hooks: [],
  mcpServers: [],
  fontSizeChat: 14,
  fontSizeCode: 13,
  fontSizeUI: 13,
  useClaudeCodePrompt: false,
  maxTokens: 8192,
  chatTheme: 'dark',
}

function normalizeMcpEnvEntries(raw: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(raw)) return []
  const result: Array<{ key: string; value: string }> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const key = typeof entry.key === 'string' ? entry.key : ''
    const value = typeof entry.value === 'string' ? entry.value : ''
    result.push({ key, value })
  }
  return result
}

function normalizeMcpServers(raw: unknown): McpServerConfig[] {
  if (!Array.isArray(raw)) return []
  const result: McpServerConfig[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const server = item as Record<string, unknown>
    const statusRaw = server.status
    result.push({
      id: typeof server.id === 'string' ? server.id : Date.now().toString(),
      name: typeof server.name === 'string' ? server.name : '',
      command: typeof server.command === 'string' ? server.command : '',
      args: typeof server.args === 'string' ? server.args : '',
      env: normalizeMcpEnvEntries(server.env),
      status: statusRaw === 'connected' || statusRaw === 'disconnected' ? statusRaw : 'unknown',
    })
  }
  return result
}

function readSettingsFromStorage(): AppSettings {
  try {
    // 尝试读取 v3
    let raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    let migrated = false
    // 兼容 v2/v1 迁移
    if (!raw) {
      raw = localStorage.getItem('claude-code-gui-settings-v2')
      if (raw) migrated = true
    }
    if (!raw) {
      raw = localStorage.getItem('claude-code-gui-settings-v1')
      if (raw) migrated = true
    }
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AppSettings>

    // 修复/迁移：保留用户模型选择，仅在已知无效旧值时回落
    const parsedDefaultModel = parsed.defaultModel || DEFAULT_SETTINGS.defaultModel
    const parsedCustomModel = parsed.customModel || ''
    const fixedDefaultModel = (migrated || parsedDefaultModel === 'dwf,glm-5')
      ? DEFAULT_SETTINGS.defaultModel
      : parsedDefaultModel
    const fixedCustomModel = parsedCustomModel

    // 迁移：旧的 router 端点改为直连 aidawan.fun
    const fixedEndpoint = (parsed.apiEndpoint === 'http://127.0.0.1:3456')
      ? DEFAULT_SETTINGS.apiEndpoint
      : (parsed.apiEndpoint || DEFAULT_SETTINGS.apiEndpoint)
    const fixedFormat = (parsed.apiEndpoint === 'http://127.0.0.1:3456' || !parsed.apiFormat)
      ? DEFAULT_SETTINGS.apiFormat
      : parsed.apiFormat

    // 迁移完成后清理旧本地缓存键，避免长期残留
    if (migrated) {
      localStorage.removeItem('claude-code-gui-settings-v1')
      localStorage.removeItem('claude-code-gui-settings-v2')
    }

    return {
      apiEndpoint: fixedEndpoint,
      altApiEndpoint: parsed.altApiEndpoint || DEFAULT_SETTINGS.altApiEndpoint,
      apiKey: parsed.apiKey ?? DEFAULT_SETTINGS.apiKey,
      altApiKey: parsed.altApiKey ?? DEFAULT_SETTINGS.altApiKey,
      apiFormat: fixedFormat,
      altApiFormat: parsed.altApiFormat || DEFAULT_SETTINGS.altApiFormat,
      thirdApiEndpoint: parsed.thirdApiEndpoint || DEFAULT_SETTINGS.thirdApiEndpoint,
      thirdApiKey: parsed.thirdApiKey ?? DEFAULT_SETTINGS.thirdApiKey,
      thirdApiFormat: parsed.thirdApiFormat || DEFAULT_SETTINGS.thirdApiFormat,
      // 从旧版本迁移时，重置 defaultModel 为当前默认值（避免不可用模型）
      defaultModel: fixedDefaultModel,
      customModel: fixedCustomModel,
      models: Array.isArray(parsed.models) && parsed.models.length > 0
        ? parsed.models.map((model) => {
          const m = model as ModelConfig
          const pricing = m.pricing && typeof m.pricing === 'object'
            ? {
              inputPerMillion: typeof m.pricing.inputPerMillion === 'number' ? m.pricing.inputPerMillion : 0,
              outputPerMillion: typeof m.pricing.outputPerMillion === 'number' ? m.pricing.outputPerMillion : 0,
              cacheCreationInputPerMillion: typeof m.pricing.cacheCreationInputPerMillion === 'number'
                ? m.pricing.cacheCreationInputPerMillion
                : undefined,
              cacheReadInputPerMillion: typeof m.pricing.cacheReadInputPerMillion === 'number'
                ? m.pricing.cacheReadInputPerMillion
                : undefined,
              reasoningPerMillion: typeof m.pricing.reasoningPerMillion === 'number'
                ? m.pricing.reasoningPerMillion
                : undefined,
            }
            : undefined

          return {
            ...m,
            pricing: pricing && pricing.inputPerMillion >= 0 && pricing.outputPerMillion >= 0
              ? pricing
              : undefined,
          }
        })
        : DEFAULT_MODELS,
      workingDirectory: parsed.workingDirectory || '',
      dangerouslySkipPermissions: Boolean(parsed.dangerouslySkipPermissions),
      hooks: Array.isArray(parsed.hooks) ? parsed.hooks : [],
      mcpServers: normalizeMcpServers(parsed.mcpServers),
      fontSizeChat: (parsed as Record<string, unknown>).fontSizeChat as number || DEFAULT_SETTINGS.fontSizeChat,
      fontSizeCode: (parsed as Record<string, unknown>).fontSizeCode as number || DEFAULT_SETTINGS.fontSizeCode,
      fontSizeUI: (parsed as Record<string, unknown>).fontSizeUI as number || DEFAULT_SETTINGS.fontSizeUI,
      useClaudeCodePrompt: typeof (parsed as Record<string, unknown>).useClaudeCodePrompt === 'boolean'
        ? (parsed as Record<string, unknown>).useClaudeCodePrompt as boolean
        : DEFAULT_SETTINGS.useClaudeCodePrompt,
      maxTokens: typeof (parsed as Record<string, unknown>).maxTokens === 'number'
        && (parsed as Record<string, unknown>).maxTokens as number >= 1024
        ? (parsed as Record<string, unknown>).maxTokens as number
        : DEFAULT_SETTINGS.maxTokens,
      chatTheme: ((parsed as Record<string, unknown>).chatTheme === 'light' ? 'light' : 'dark') as 'dark' | 'light',
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

interface AppSettingsContextValue {
  settings: AppSettings
  activeModel: string
  updateSettings: (updates: Partial<AppSettings>) => void
  saveSettings: (next?: Partial<AppSettings>) => AppSettings
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => readSettingsFromStorage())
  const secureKeyLoadedRef = useRef(false)

  // 初始化时从安全存储加载 API Key（主/备用）
  useEffect(() => {
    if (secureKeyLoadedRef.current) return
    secureKeyLoadedRef.current = true
    const load = async () => {
      try {
        // 新键：分别存储
        const [main, alt, third] = await Promise.all([
          window.electronAPI?.secureStoreGet('apiKeyMain'),
          window.electronAPI?.secureStoreGet('apiKeyAlt'),
          window.electronAPI?.secureStoreGet('apiKeyThird'),
        ])

        // 兼容旧键：apiKey（只作为主 key 回填）
        const legacy = (!main?.success || !main.value)
          ? await window.electronAPI?.secureStoreGet('apiKey')
          : null

        setSettings((prev) => ({
          ...prev,
          apiKey: (main?.success && main.value) ? main.value : (legacy?.success && legacy.value ? legacy.value : prev.apiKey),
          altApiKey: (alt?.success && alt.value) ? alt.value : prev.altApiKey,
          thirdApiKey: (third?.success && third.value) ? third.value : prev.thirdApiKey,
        }))

        // 清理旧安全存储键，避免删除功能后的历史缓存残留
        if (window.electronAPI?.secureStoreDelete) {
          window.electronAPI.secureStoreDelete('apiKey').catch(() => {})
        }
      } catch {
        /* 安全存储不可用，使用 localStorage 中的值 */
      }
    }
    load()
  }, [])

  const activeModel = useMemo(
    () => settings.customModel.trim() || settings.defaultModel,
    [settings.customModel, settings.defaultModel],
  )

  // 自动保存：settings 变化后 500ms 自动写入 localStorage
  // API Key（主/备用）单独存入安全存储，不放入 localStorage
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevApiKeyRef = useRef(settings.apiKey)
  const prevAltApiKeyRef = useRef(settings.altApiKey)
  const prevThirdApiKeyRef = useRef(settings.thirdApiKey)

  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      // 保存时从 settings 中排除所有 API Key
      const { apiKey, altApiKey, thirdApiKey, ...rest } = settings
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...rest, apiKey: '', altApiKey: '', thirdApiKey: '' }))

      // 主 Key 变化时写入安全存储
      if (apiKey !== prevApiKeyRef.current) {
        prevApiKeyRef.current = apiKey
        if (apiKey) {
          window.electronAPI?.secureStoreSet('apiKeyMain', apiKey).catch(() => {})
        } else {
          window.electronAPI?.secureStoreDelete('apiKeyMain').catch(() => {})
        }
      }

      // 备用 Key 变化时写入安全存储
      if (altApiKey !== prevAltApiKeyRef.current) {
        prevAltApiKeyRef.current = altApiKey
        if (altApiKey) {
          window.electronAPI?.secureStoreSet('apiKeyAlt', altApiKey).catch(() => {})
        } else {
          window.electronAPI?.secureStoreDelete('apiKeyAlt').catch(() => {})
        }
      }

      // 中转站 Key 变化时写入安全存储
      if (thirdApiKey !== prevThirdApiKeyRef.current) {
        prevThirdApiKeyRef.current = thirdApiKey
        if (thirdApiKey) {
          window.electronAPI?.secureStoreSet('apiKeyThird', thirdApiKey).catch(() => {})
        } else {
          window.electronAPI?.secureStoreDelete('apiKeyThird').catch(() => {})
        }
      }
    }, 500)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  }, [settings])

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }))
  }, [])

  const saveSettings = useCallback((next?: Partial<AppSettings>) => {
    let merged: AppSettings = { ...DEFAULT_SETTINGS }
    setSettings((prev) => {
      merged = { ...prev, ...next }
      // 任何情况下都不把 key 落盘到 localStorage
      const { apiKey: _k, altApiKey: _ak, thirdApiKey: _tk, ...rest } = merged
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...rest, apiKey: '', altApiKey: '', thirdApiKey: '' }))
      return merged
    })
    return merged
  }, [])

  const value = useMemo<AppSettingsContextValue>(
    () => ({ settings, activeModel, updateSettings, saveSettings }),
    [settings, activeModel, updateSettings, saveSettings],
  )

  return createElement(AppSettingsContext.Provider, { value }, children)
}

export function useAppSettings(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext)
  if (!ctx) {
    throw new Error('useAppSettings must be used within AppSettingsProvider')
  }
  return ctx
}
