import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { config } from './config'
import { initDatabase, queryOne, execute } from './db'

async function init() {
  console.log('初始化数据库...')
  await initDatabase()

  // 检查是否已有管理员
  const admin = queryOne("SELECT id FROM users WHERE role = 'admin'")
  if (admin) {
    console.log('管理员账号已存在，跳过创建')
    return
  }

  const id = uuidv4()
  const passwordHash = await bcrypt.hash(config.adminPassword, 10)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let apiKey = 'sk-admin-'
  for (let i = 0; i < 40; i++) apiKey += chars.charAt(Math.floor(Math.random() * chars.length))

  execute(`
    INSERT INTO users (id, username, email, password_hash, role, api_key, max_tokens_per_day)
    VALUES (?, 'admin', 'admin@localhost', ?, 'admin', ?, ?)
  `, [id, passwordHash, apiKey, 999999999])

  // 写入默认设置
  execute(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, ['api_endpoint', config.defaultApiEndpoint])
  if (config.defaultApiKey) {
    execute(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, ['api_key', config.defaultApiKey])
  }

  execute(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, ['log_full_payload', 'false'])

  console.log('管理员账号已创建')
  console.log('  用户名: admin')
  console.log('  密码: [已隐藏]')
  console.log('  API Key: [已隐藏]')
  console.log('')
  console.log('请妥善保存初始化时使用的管理员凭据。')
}

init().catch(console.error)
