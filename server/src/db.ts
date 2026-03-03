import initSqlJs, { Database } from 'sql.js'
import path from 'path'
import fs from 'fs'
import { config } from './config'

let db: Database

// 初始化数据库（必须在使用前调用）
export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs()

  const dbDir = path.dirname(config.dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  // 如果数据库文件已存在则加载
  if (fs.existsSync(config.dbPath)) {
    const buffer = fs.readFileSync(config.dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // 建表
  db.run('PRAGMA foreign_keys = ON')
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      api_key TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      max_tokens_per_day INTEGER NOT NULL DEFAULT ${config.defaultDailyTokenLimit},
      tokens_used_today INTEGER NOT NULL DEFAULT 0,
      total_tokens_used INTEGER NOT NULL DEFAULT 0,
      total_requests INTEGER NOT NULL DEFAULT 0,
      last_reset_date TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      model TEXT NOT NULL,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'success',
      error_message TEXT,
      ip_address TEXT,
      request_body TEXT,
      response_body TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  // 迁移：给已有表加字段
  try { db.run('ALTER TABLE usage_logs ADD COLUMN request_body TEXT') } catch { /* 已存在 */ }
  try { db.run('ALTER TABLE usage_logs ADD COLUMN response_body TEXT') } catch { /* 已存在 */ }
  try { db.run('ALTER TABLE users ADD COLUMN last_reset_date TEXT') } catch { /* 已存在 */ }

  db.run('CREATE INDEX IF NOT EXISTS idx_usage_user_id ON usage_logs(user_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_logs(created_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key)')
  db.run('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)')

  saveDb()
  console.log('  数据库已初始化:', config.dbPath)
}

// 持久化到磁盘
export function saveDb(): void {
  if (!db) return
  const data = db.export()
  fs.writeFileSync(config.dbPath, Buffer.from(data))
}

// 查询单行
export function queryOne(sql: string, params: unknown[] = []): Record<string, unknown> | undefined {
  const stmt = db.prepare(sql)
  stmt.bind(params as (string | number | null | Uint8Array)[])
  if (stmt.step()) {
    const cols = stmt.getColumnNames()
    const vals = stmt.get()
    stmt.free()
    const row: Record<string, unknown> = {}
    cols.forEach((c, i) => row[c] = vals[i])
    return row
  }
  stmt.free()
  return undefined
}

// 查询多行
export function queryAll(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const stmt = db.prepare(sql)
  stmt.bind(params as (string | number | null | Uint8Array)[])
  const results: Record<string, unknown>[] = []
  while (stmt.step()) {
    const cols = stmt.getColumnNames()
    const vals = stmt.get()
    const row: Record<string, unknown> = {}
    cols.forEach((c, i) => row[c] = vals[i])
    results.push(row)
  }
  stmt.free()
  return results
}

// 执行（INSERT / UPDATE / DELETE）
export function execute(sql: string, params: unknown[] = []): void {
  db.run(sql, params as (string | number | null | Uint8Array)[])
  saveDb()
}

// 批量执行（事务）
export function transaction(fn: () => void): void {
  db.run('BEGIN TRANSACTION')
  try {
    fn()
    db.run('COMMIT')
    saveDb()
  } catch (err) {
    db.run('ROLLBACK')
    throw err
  }
}

export function getDb(): Database {
  return db
}
