# Claude Code GUI - 后台管理 & API 中转

## 快速开始

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，按需修改：

```env
# 服务端口（默认 3456）
PORT=3456

# JWT 密钥（生产环境必须修改为随机长字符串）
JWT_SECRET=your-random-secret-string

# 管理员初始密码
ADMIN_PASSWORD=admin123

# 默认 AI API 配置
DEFAULT_API_ENDPOINT=https://api.openai.com/v1
DEFAULT_API_KEY=sk-xxx

# 用户默认每日 token 限额
DEFAULT_DAILY_TOKEN_LIMIT=1000000
```

### 3. 初始化数据库

```bash
npm run init-db
```

会输出管理员的用户名、密码和 API Key，请妥善保存。

### 4. 启动服务

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm run build
npm run start
```

启动后访问：
- 管理后台：`http://localhost:3456/admin/`
- API 中转端点：`http://localhost:3456/api/proxy/v1/chat/completions`

---

## 管理后台使用

访问 `http://localhost:3456/admin/`，使用管理员账号登录（默认 admin / admin123）。

### 功能

| 页面 | 说明 |
|------|------|
| 仪表盘 | 查看总用户数、请求数、Token 消耗、用量排行 |
| 用户管理 | 添加/编辑/删除用户、分配 API Key、设置每日限额 |
| 请求日志 | 查看所有 API 请求记录（用户、模型、Token、耗时） |
| 系统设置 | 配置 AI API 端点和密钥 |

### 添加用户

1. 进入「用户管理」页面
2. 点击「+ 添加用户」
3. 填写用户名、密码、每日 Token 限额
4. 保存后会自动生成 API Key
5. 将 API Key 发给用户

---

## 客户端配置

### 方式一：在 Claude Code GUI 桌面客户端中配置

1. 打开 Claude Code GUI 桌面应用
2. 点击右上角 **设置**（齿轮图标）
3. 找到 **API 设置** 区域
4. 修改以下配置：

| 配置项 | 值 |
|--------|-----|
| API 端点 | `http://你的服务器IP:3456/api/proxy/v1` |
| API Key | 管理员分配的 `sk-xxx` 格式的 Key |
| 模型 | 根据后端实际配置的模型名称填写 |

5. 点击保存，即可通过中转服务进行对话

### 方式二：作为通用 OpenAI 兼容 API 使用

本中转服务兼容 OpenAI API 格式，任何支持自定义端点的客户端都可以使用：

**端点地址：**
```
http://你的服务器IP:3456/api/proxy/v1/chat/completions
```

**请求示例：**
```bash
curl http://localhost:3456/api/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-你的API-Key" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

**流式请求：**
```bash
curl http://localhost:3456/api/proxy/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-你的API-Key" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'
```

**获取可用模型：**
```bash
curl http://localhost:3456/api/proxy/v1/models \
  -H "Authorization: Bearer sk-你的API-Key"
```

### 方式三：在其他客户端中配置

#### ChatBox
1. 设置 → API → 自定义提供商
2. API 端点：`http://你的服务器IP:3456/api/proxy/v1`
3. API Key：管理员分配的 Key

#### Cherry Studio
1. 设置 → 模型服务
2. 添加自定义服务
3. Base URL：`http://你的服务器IP:3456/api/proxy/v1`
4. API Key：管理员分配的 Key

#### OpenAI Python SDK
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://你的服务器IP:3456/api/proxy/v1",
    api_key="sk-你的API-Key"
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "你好"}]
)
print(response.choices[0].message.content)
```

#### Node.js / TypeScript
```typescript
const response = await fetch('http://localhost:3456/api/proxy/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-你的API-Key',
  },
  body: JSON.stringify({
    model: 'gpt-4',
    messages: [{ role: 'user', content: '你好' }],
  }),
})
const data = await response.json()
```

---

## API 接口文档

### 认证方式

所有 API 请求需要在 Header 中携带 API Key：

```
Authorization: Bearer sk-你的API-Key
```

或使用自定义 Header：

```
X-API-Key: sk-你的API-Key
```

### 接口列表

#### 用户认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录（返回 JWT） |
| GET | `/api/auth/me` | 获取当前用户信息（需 JWT） |
| POST | `/api/auth/regenerate-key` | 重新生成 API Key（需 JWT） |

#### API 中转

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/proxy/v1/chat/completions` | 聊天补全（支持流式） |
| GET | `/api/proxy/v1/models` | 获取可用模型列表 |

#### 管理后台（需管理员 JWT）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users` | 创建用户 |
| PUT | `/api/admin/users/:id` | 更新用户 |
| DELETE | `/api/admin/users/:id` | 删除用户 |
| POST | `/api/admin/users/:id/reset-usage` | 重置用户每日用量 |
| POST | `/api/admin/users/:id/regenerate-key` | 重新生成用户 API Key |
| GET | `/api/admin/stats/overview` | 总览统计 |
| GET | `/api/admin/stats/daily` | 按天统计（近 30 天） |
| GET | `/api/admin/stats/top-users` | 用量排行 |
| GET | `/api/admin/stats/logs` | 请求日志 |
| GET | `/api/admin/settings` | 获取系统设置 |
| PUT | `/api/admin/settings` | 更新系统设置 |

---

## 安全建议

1. **修改默认密码**：首次部署后立即修改管理员密码
2. **修改 JWT_SECRET**：使用随机长字符串，不要用默认值
3. **HTTPS**：生产环境建议使用 Nginx 反向代理并启用 HTTPS
4. **防火墙**：限制 3456 端口只对内网或指定 IP 开放
5. **API Key 管理**：定期轮换用户 API Key，禁用不活跃账号

## 技术栈

- **Express 4** + TypeScript
- **sql.js**（SQLite WASM，零原生编译依赖）
- **JWT** 认证
- **bcryptjs** 密码加密
- 前端管理界面：原生 HTML + Tailwind CSS CDN
