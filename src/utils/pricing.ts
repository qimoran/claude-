// ── 模型定价表（单位: 美元 / 百万 tokens）──────────────

export interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
  cacheCreationInputPerMillion?: number
  cacheReadInputPerMillion?: number
  reasoningPerMillion?: number
}

export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  reasoningTokens?: number
}

export interface CostCalculationResult {
  cost: number
  hasKnownPricing: boolean
  source: 'override' | 'table' | 'unknown'
  normalizedModelId: string
  matchedKey?: string
}

/**
 * 官方定价表（按模型 ID 前缀匹配）
 * 来源: https://docs.anthropic.com/en/docs/about-claude/models
 *       https://openai.com/api/pricing
 */
const PRICING_TABLE: Record<string, ModelPricing> = {
  // ── Anthropic ──
  'claude-opus-4': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-opus-4-6': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-sonnet-4': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-sonnet-4.5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-sonnet-4-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-3.5': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-5-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-opus': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-3-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25 },

  // ── OpenAI ──
  'gpt-5.3-codex': { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadInputPerMillion: 0.125 },
  'gpt-5-codex': { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadInputPerMillion: 0.125 },
  'gpt-5': { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadInputPerMillion: 0.125 },
  'gpt-5-mini': { inputPerMillion: 0.25, outputPerMillion: 2, cacheReadInputPerMillion: 0.025 },
  'gpt-5-nano': { inputPerMillion: 0.05, outputPerMillion: 0.4, cacheReadInputPerMillion: 0.005 },
  'codex': { inputPerMillion: 1.25, outputPerMillion: 10, cacheReadInputPerMillion: 0.125 },
  'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  'gpt-4.1-nano': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4-turbo': { inputPerMillion: 10, outputPerMillion: 30 },
  'gpt-4': { inputPerMillion: 30, outputPerMillion: 60 },
  'gpt-3.5-turbo': { inputPerMillion: 0.5, outputPerMillion: 1.5 },
  'o1': { inputPerMillion: 15, outputPerMillion: 60 },
  'o1-mini': { inputPerMillion: 3, outputPerMillion: 12 },
  'o1-pro': { inputPerMillion: 150, outputPerMillion: 600 },
  'o3': { inputPerMillion: 10, outputPerMillion: 40 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },

  // ── DeepSeek ──
  'deepseek-chat': { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },

  // ── Google Gemini ──
  'gemini-3-pro': { inputPerMillion: 2, outputPerMillion: 12 },
  'gemini-3-flash': { inputPerMillion: 0.5, outputPerMillion: 3 },
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10 },
  'gemini-2.5-flash': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gemini-2.5-flash-lite': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.5-flash-thinking': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },

  // ── 智谱 GLM ──
  'glm-5': { inputPerMillion: 1, outputPerMillion: 3.2 },
}

const normalizeNonNegative = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}

const sanitizePricing = (pricing: Partial<ModelPricing>): ModelPricing | null => {
  const inputPerMillion = normalizeNonNegative(pricing.inputPerMillion)
  const outputPerMillion = normalizeNonNegative(pricing.outputPerMillion)
  if (inputPerMillion === undefined || outputPerMillion === undefined) {
    return null
  }
  return {
    inputPerMillion,
    outputPerMillion,
    cacheCreationInputPerMillion: normalizeNonNegative(pricing.cacheCreationInputPerMillion),
    cacheReadInputPerMillion: normalizeNonNegative(pricing.cacheReadInputPerMillion),
    reasoningPerMillion: normalizeNonNegative(pricing.reasoningPerMillion),
  }
}

/**
 * 统一模型 ID，兼容 provider 包装形式：
 * - provider,model
 * - provider/model
 * - provider:model
 */
export function normalizeModelIdForPricing(modelId: string): string {
  let normalized = (modelId || '').trim().toLowerCase()
  if (!normalized) return ''

  if (normalized.includes(',')) {
    normalized = normalized.split(',').pop()!.trim()
  }

  if (normalized.includes('/')) {
    const slashTail = normalized.split('/').pop()!.trim()
    if (slashTail) normalized = slashTail
  }

  if (/^[a-z0-9._-]+:[a-z0-9._-].*$/i.test(normalized)) {
    const colonTail = normalized.split(':').slice(1).join(':').trim()
    if (colonTail) normalized = colonTail
  }

  return normalized
}

function resolveModelPricing(
  modelId: string,
  pricingOverride?: Partial<ModelPricing>,
): { pricing: ModelPricing | null; source: 'override' | 'table' | 'unknown'; normalizedModelId: string; matchedKey?: string } {
  const normalizedModelId = normalizeModelIdForPricing(modelId)

  const overridePricing = pricingOverride ? sanitizePricing(pricingOverride) : null
  if (overridePricing) {
    return {
      pricing: overridePricing,
      source: 'override',
      normalizedModelId,
    }
  }

  if (PRICING_TABLE[normalizedModelId]) {
    return {
      pricing: PRICING_TABLE[normalizedModelId],
      source: 'table',
      normalizedModelId,
      matchedKey: normalizedModelId,
    }
  }

  const prefixes = Object.keys(PRICING_TABLE)
    .filter((prefix) => normalizedModelId.startsWith(prefix))
    .sort((a, b) => b.length - a.length)

  if (prefixes.length > 0) {
    return {
      pricing: PRICING_TABLE[prefixes[0]],
      source: 'table',
      normalizedModelId,
      matchedKey: prefixes[0],
    }
  }

  return {
    pricing: null,
    source: 'unknown',
    normalizedModelId,
  }
}

/**
 * 根据模型 ID 查找定价。支持前缀匹配。
 */
export function getModelPricing(
  modelId: string,
  pricingOverride?: Partial<ModelPricing>,
): ModelPricing | null {
  return resolveModelPricing(modelId, pricingOverride).pricing
}

/**
 * 计算单次请求费用（美元）
 */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  pricingOverride?: Partial<ModelPricing>,
): number {
  return calculateUsageCost(
    modelId,
    { inputTokens, outputTokens },
    pricingOverride,
  ).cost
}

/**
 * 计算带细分 token 的费用。
 * - 当存在 cache/read/reasoning 专属价格时，会先从基础 input/output 中扣除，避免重复计费。
 */
export function calculateUsageCost(
  modelId: string,
  usage: UsageTokens,
  pricingOverride?: Partial<ModelPricing>,
): CostCalculationResult {
  const resolved = resolveModelPricing(modelId, pricingOverride)
  const pricing = resolved.pricing
  if (!pricing) {
    return {
      cost: 0,
      hasKnownPricing: false,
      source: 'unknown',
      normalizedModelId: resolved.normalizedModelId,
    }
  }

  const inputTokens = Math.max(0, usage.inputTokens || 0)
  const outputTokens = Math.max(0, usage.outputTokens || 0)
  const cacheCreationInputTokens = Math.max(0, usage.cacheCreationInputTokens || 0)
  const cacheReadInputTokens = Math.max(0, usage.cacheReadInputTokens || 0)
  const reasoningTokens = Math.max(0, usage.reasoningTokens || 0)

  let inputBaseTokens = inputTokens
  let outputBaseTokens = outputTokens

  let cacheCreationCost = 0
  let cacheReadCost = 0
  let reasoningCost = 0

  if (cacheCreationInputTokens > 0 && pricing.cacheCreationInputPerMillion !== undefined) {
    inputBaseTokens -= cacheCreationInputTokens
    cacheCreationCost = (cacheCreationInputTokens / 1_000_000) * pricing.cacheCreationInputPerMillion
  }

  if (cacheReadInputTokens > 0 && pricing.cacheReadInputPerMillion !== undefined) {
    inputBaseTokens -= cacheReadInputTokens
    cacheReadCost = (cacheReadInputTokens / 1_000_000) * pricing.cacheReadInputPerMillion
  }

  if (reasoningTokens > 0 && pricing.reasoningPerMillion !== undefined) {
    outputBaseTokens -= reasoningTokens
    reasoningCost = (reasoningTokens / 1_000_000) * pricing.reasoningPerMillion
  }

  const inputCost = (Math.max(0, inputBaseTokens) / 1_000_000) * pricing.inputPerMillion
  const outputCost = (Math.max(0, outputBaseTokens) / 1_000_000) * pricing.outputPerMillion

  return {
    cost: inputCost + outputCost + cacheCreationCost + cacheReadCost + reasoningCost,
    hasKnownPricing: true,
    source: resolved.source,
    normalizedModelId: resolved.normalizedModelId,
    matchedKey: resolved.matchedKey,
  }
}

/**
 * 格式化费用为美元字符串
 */
export function formatCost(cost: number, options?: { unknownRequests?: number }): string {
  const unknownRequests = options?.unknownRequests || 0
  const hasUnknown = unknownRequests > 0

  const formatKnown = () => {
    if (cost === 0) return '$0.00'
    if (cost < 0.01) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(2)}`
  }

  if (!hasUnknown) return formatKnown()
  if (cost > 0) return `${formatKnown()} + 未知`
  return '未配置'
}

/**
 * 格式化 token 数量
 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`
  return `${(count / 1_000_000).toFixed(2)}M`
}
