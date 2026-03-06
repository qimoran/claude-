# Claude Code GUI - 后台管理 & API 中转

## 功能概览

该服务提供两类能力：

1. **管理后台**（`/admin/`）
   - 用户管理（角色、状态、限额、备注、重置用量、重置 API Key）
   - 请求日志查询（分页 + 详情）
   - 系统设置（多上游 API 配置、默认限额、日志模式）
2. **OpenAI 兼容 API 中转**（`/api/proxy/v1/*`）
   - `chat/completions`（支持流式）
   - `models`

---

## 快速开始

### 1) 安装依赖

```bash
cd server
npm install
```

### 2) 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 服务端口（默认 3456）
PORT=3456

# JWT 密钥（必填，至少 32 字符）
JWT_SECRET=replace-with-at-least-32-characters-secret

# 管理员初始密码（必填，至少 12 字符，禁止 admin123）
ADMIN_PASSWORD=replace-with-strong-admin-password

# 数据库文件路径
DB_PATH=./data/server.db

# 默认 AI API 配置（用于中转）
DEFAULT_API_ENDPOINT=https://api.openai.com/v1
DEFAULT_API_KEY=sk-xxx

# 新用户默认每日 token 限额
DEFAULT_DAILY_TOKEN_LIMIT=1000000

# 允许的跨域来源（逗号分隔）
CORS_ORIGINS=http://localhost:5173,http://localhost:3456
```

### 3) 初始化数据库

```bash
npm run init-db
```

初始化逻辑：
- 自动建表并创建索引
- 若不存在管理员账号，则创建 `admin` 账号
- 若管理员已存在，则跳过创建
- 初始化默认 settings（包含 `log_full_payload=false`）

> 初始化日志会隐藏敏感信息（密码/API Key 以 `[已隐藏]` 显示）。

### 4) 启动服务

```bash
# 开发模式（热重载）
npm run dev

# 类型检查
npm run typecheck

# 生产构建并启动
npm run build
npm run start
```

### 5) 启动后访问

- 管理后台：`http://localhost:3456/admin/`
- API 中转：`http://localhost:3456/api/proxy/v1/chat/completions`
- 健康检查：`http://localhost:3456/api/health`
- 根路径会重定向到：`/admin/`

---

## 管理后台使用

访问 `http://localhost:3456/admin/`，使用管理员账号登录：
- 用户名固定为 `admin`（初始化时创建）
- 密码为你在 `.env` 中配置的 `ADMIN_PASSWORD`

### 页面功能

| 页面 | 说明 |
|------|------|
| 仪表盘 | 总用户数、活跃用户、总请求、总 Token、今日请求/Token、Top 用户排行 |
| 用户管理 | 创建/编辑/删除用户；设置角色（user/admin）、状态（active/disabled）、每日限额、备注；可重置当日用量与重置 API Key |
| 请求日志 | 按页查看请求日志，支持查看请求/响应详情（摘要或完整模式） |
| 系统设置 | 配置多组上游 API（启用/禁用、名称、端点、Key）、默认每日限额、是否记录完整 payload |

### 用户管理说明

- **状态控制**：`disabled` 用户无法登录，也无法使用 API Key 调用中转接口。
- **重置用量**：`/api/admin/users/:id/reset-usage` 可将用户当日 token 用量置零。
- **重置 Key**：`/api/admin/users/:id/regenerate-key` 会立即使旧 Key 失效。
- **删除限制**：管理员不能删除自己。

---

## 客户端配置（OpenAI 兼容）

### 基础信息

- Base URL：`http://你的服务器IP:3456/api/proxy/v1`
- Chat Completions：`POST /chat/completions`
- Models：`GET /models`

认证方式（两种都支持）：

```http
Authorization: Bearer sk-你的API-Key
```

或

```http
X-API-Key: sk-你的API-Key
```

### 请求示例

**非流式：**

```bash
curl http://localhost:3456/api/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-你的API-Key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

**流式：**

```bash
curl http://localhost:3456/api/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-你的API-Key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

**获取模型列表：**

```bash
curl http://localhost:3456/api/proxy/v1/models \
  -H "Authorization: Bearer sk-你的API-Key"
```

---

## API 接口文档

### 系统接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 重定向到 `/admin/` |
| GET | `/api/health` | 健康检查 |

### 用户认证（JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册（受限流） |
| POST | `/api/auth/login` | 用户登录，返回 JWT（受限流） |
| GET | `/api/auth/me` | 获取当前用户信息（需 JWT） |
| POST | `/api/auth/regenerate-key` | 当前用户重置 API Key（需 JWT） |

### API 中转（需 API Key）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/proxy/v1/chat/completions` | OpenAI 兼容聊天补全，支持流式 |
| GET | `/api/proxy/v1/models` | 获取上游可用模型 |

### 管理后台（需管理员 JWT）

#### 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users` | 创建用户 |
| PUT | `/api/admin/users/:id` | 更新用户（用户名/密码/角色/状态/限额/备注等） |
| DELETE | `/api/admin/users/:id` | 删除用户（不能删自己） |
| POST | `/api/admin/users/:id/reset-usage` | 重置用户当日用量 |
| POST | `/api/admin/users/:id/regenerate-key` | 重置用户 API Key |

#### 统计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/stats/overview` | 总览统计 |
| GET | `/api/admin/stats/daily` | 最近 30 天按天统计 |
| GET | `/api/admin/stats/top-users` | Top 用户排行（按总 token） |
| GET | `/api/admin/stats/logs` | 请求日志（分页） |

`/api/admin/stats/logs` 支持参数：
- `limit`：默认 50，最大 200
- `offset`：默认 0
- `userId`：可选，按用户过滤

#### 系统设置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/settings` | 获取设置 |
| PUT | `/api/admin/settings` | 批量更新设置 |

常用设置键：
- `api_configs`：多组上游配置（JSON 数组）
- `default_daily_token_limit`：新用户默认日限额
- `log_full_payload`：是否记录完整请求/响应（`true/false`）

---

## 中转行为说明

### 1) 多上游轮询

当 `api_configs` 中有多组启用配置时，服务会按顺序轮询使用，降低单点压力。

兼容旧配置：
- 若不存在 `api_configs`，会回退读取单组 `api_endpoint` + `api_key`。

### 2) 自动补全 `/v1`

上游端点若未以 `/v1` 结尾，会自动补全后再转发到：
- `/chat/completions`
- `/models`

### 3) 用量统计与日志

每次中转请求会写入 `usage_logs`：
- 模型、输入/输出 token、总 token、耗时、状态、错误信息、IP
- 请求体/响应体按日志模式保存（见下条）

### 4) 日志模式

- `log_full_payload=false`（默认）：只记录摘要（推荐）
- `log_full_payload=true`：记录完整输入/输出（仅排障临时使用，可能包含敏感信息）

### 5) 自动清理

`usage_logs` 会自动清理 90 天前数据：
- 服务启动时清理一次
- 之后每 24 小时清理一次

---

## 限流策略

| 场景 | 维度 | 规则 |
|------|------|------|
| 登录 `/api/auth/login` | IP | 15 分钟最多 10 次 |
| 注册 `/api/auth/register` | IP | 1 小时最多 5 次 |
| API 中转 `/api/proxy/*` | API Key（无 Key 时回退 IP） | 每分钟最多 30 次 |

超限返回 `429`，并附带 `Retry-After` 响应头。

---

## 安全建议

1. **必须使用强密钥**：`JWT_SECRET` 至少 32 字符，`ADMIN_PASSWORD` 至少 12 字符。
2. **生产环境启用 HTTPS**：建议 Nginx/Caddy 反向代理，并配置证书。
3. **收紧 CORS**：将 `CORS_ORIGINS` 配置为你的真实前端域名。
4. **限制管理后台暴露面**：仅允许可信网段访问 3456 端口。
5. **谨慎开启完整日志**：`log_full_payload=true` 仅用于短时排障，结束后立即关闭。
6. **轮换 API Key**：定期为用户重置 API Key，停用长期不活跃账号。

服务默认还会设置安全响应头（CSP、X-Frame-Options、HSTS 条件启用等），并对 API 响应禁用缓存。

---

## 技术栈

- **Express 4** + TypeScript
- **sql.js**（SQLite WASM，零原生编译依赖）
- **JWT** 鉴权 + **bcryptjs** 密码哈希
- 管理前端：原生 HTML + Tailwind CSS CDN
