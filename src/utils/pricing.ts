// ── 模型定价表（单位: 美元 / 百万 tokens）──────────────

export interface ModelPricing {
  inputPerMillion: number   // 每百万 input tokens 价格（美元）
  outputPerMillion: number  // 每百万 output tokens 价格（美元）
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
  'claude-sonnet-4.5': { inputPerMillion: 3, outputPerMillion: 15 },  // same tier
  'claude-sonnet-4-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-haiku-3.5': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-5-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-opus': { inputPerMillion: 15, outputPerMillion: 75 },
  'claude-3-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-haiku': { inputPerMillion: 0.25, outputPerMillion: 1.25 },

  // ── OpenAI ──
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

  // ── GPT-4.1 系列 ──
  'gpt-4.1': { inputPerMillion: 2, outputPerMillion: 8 },
  'gpt-4.1-mini': { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  'gpt-4.1-nano': { inputPerMillion: 0.1, outputPerMillion: 0.4 },

  // ── 智谱 GLM ──
  'glm-5': { inputPerMillion: 1, outputPerMillion: 3.2 },
}

/**
 * 根据模型 ID 查找定价。支持前缀匹配（如 "claude-sonnet-4-20250514" 匹配 "claude-sonnet-4"）
 */
export function getModelPricing(modelId: string): ModelPricing | null {
  // 兼容 claude-code-router 的 "provider,model" 写法（例如 "dwf,glm-5"）
  const normalizedModelId = modelId.includes(',') ? modelId.split(',').pop()!.trim() : modelId

  // 精确匹配
  if (PRICING_TABLE[normalizedModelId]) {
    return PRICING_TABLE[normalizedModelId]
  }

  // 前缀匹配（按长度降序，优先匹配最长前缀）
  const prefixes = Object.keys(PRICING_TABLE)
    .filter((prefix) => normalizedModelId.startsWith(prefix))
    .sort((a, b) => b.length - a.length)

  if (prefixes.length > 0) {
    return PRICING_TABLE[prefixes[0]]
  }

  return null
}

/**
 * 计算单次请求费用（美元）
 */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(modelId)
  if (!pricing) return 0

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion
  return inputCost + outputCost
}

/**
 * 格式化费用为美元字符串
 */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

/**
 * 格式化 token 数量
 */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`
  return `${(count / 1_000_000).toFixed(2)}M`
}
