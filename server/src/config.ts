import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

function ensureRequiredSecret(name: string, value: string | undefined, minLength: number): string {
  const normalized = (value || '').trim()
  if (!normalized) {
    throw new Error(`缺少必需环境变量: ${name}`)
  }
  if (normalized.length < minLength) {
    throw new Error(`${name} 长度过短，至少需要 ${minLength} 个字符`)
  }
  return normalized
}

function ensureSecureAdminPassword(value: string | undefined): string {
  const normalized = (value || '').trim()
  if (!normalized) {
    throw new Error('缺少必需环境变量: ADMIN_PASSWORD')
  }
  if (normalized.length < 12) {
    throw new Error('ADMIN_PASSWORD 过短，至少需要 12 个字符')
  }
  if (/^admin123$/i.test(normalized)) {
    throw new Error('ADMIN_PASSWORD 不能使用弱默认值 admin123')
  }
  return normalized
}

const jwtSecret = ensureRequiredSecret('JWT_SECRET', process.env.JWT_SECRET, 32)
const adminPassword = ensureSecureAdminPassword(process.env.ADMIN_PASSWORD)

export const config = {
  port: parseInt(process.env.PORT || '3456', 10),
  jwtSecret,
  adminPassword,
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'server.db'),
  defaultApiEndpoint: process.env.DEFAULT_API_ENDPOINT || 'https://api.openai.com/v1',
  defaultApiKey: process.env.DEFAULT_API_KEY || '',
  defaultDailyTokenLimit: parseInt(process.env.DEFAULT_DAILY_TOKEN_LIMIT || '1000000', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3456').split(',').map(s => s.trim()),
}
