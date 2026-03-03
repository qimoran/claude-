import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

export const config = {
  port: parseInt(process.env.PORT || '3456', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'server.db'),
  defaultApiEndpoint: process.env.DEFAULT_API_ENDPOINT || 'https://api.openai.com/v1',
  defaultApiKey: process.env.DEFAULT_API_KEY || '',
  defaultDailyTokenLimit: parseInt(process.env.DEFAULT_DAILY_TOKEN_LIMIT || '1000000', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3456').split(',').map(s => s.trim()),
}
