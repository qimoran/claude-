# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在本仓库中工作时提供指引。

---

## 项目概述

**Claude Code GUI** 是一个基于 Electron 的桌面应用程序，为 AI 编程助手提供可视化对话界面。它**不是** Claude Code CLI 的简单封装——而是通过 HTTP 直接调用 Anthropic / OpenAI 兼容 API，内置完整的 **Agentic 工具调用循环**（bash、read_file、write_file、edit_file、list_dir、search_files），让模型能在用户指定的工作目录中自主执行多轮编码任务。

**核心特性：**
- **独立 Agent 并行**：每个会话拥有独立的流式状态，可并行运行，切换会话不中断执行
- **会话级工作目录**：每个会话可设置独立的工作目录（优先于全局设置）
- 三 API 端点 + 独立格式：主端点 / 备用端点 / 中转站端点，各自独立配置 API 格式（Anthropic / OpenAI）
- 模型级端点路由：支持在模型管理中按模型指定 auto / main / alt / third
- **最大输出 Tokens 可配置**：设置面板滑块控制（1024-32768），前后端全链路传递
- 流式 SSE 响应 + 工具调用实时展示
- 危险操作确认机制（允许执行 / 全部允许 / 拒绝），支持"全部允许"一键信任后续操作
- **任务完成桌面通知**：后台会话完成时弹 Windows 桌面通知
- Token 用量/耗时追踪与费用估算（支持缓存/推理 token；会话累计 + 最近一次 + 模型耗时）
- 文件变更历史 + 回滚（快照系统）
- 对话导入/导出（Markdown 格式）
- 消息编辑、重新生成、回滚到任意消息/轮次
- 消息搜索（关键词高亮）
- Prompt 模板命令菜单（输入 `/` 触发）
- 图片/Vision 支持（粘贴、拖放、文件选择）
- 文件浏览器面板（目录树 + 文件预览 + Markdown 渲染 + CSV/Excel 表格预览 + 图片预览 + 本地文件编辑保存）
- 会话归档面板
- 高级数据分析面板（CSV/JSON/Excel 导入、ECharts 多图形、可选 Worker 聚合）
- API 连接状态检测（30 秒轮询）
- Git 状态自动附加到提示词
- 自定义系统提示词（per-session）+ Claude Code 风格系统提示词全局开关
- MCP 服务器配置与连接测试
- Hooks 配置（PreToolUse / PostToolUse / Notification）
- 自定义模型列表管理

---

## 开发命令

### 前置要求
- Node.js >= 18 和 npm
- （可选）任何 Anthropic / OpenAI 兼容 API 端点

### 常用命令

```bash
# 安装依赖
npm install

# 开发模式（同时启动 Vite + Electron）
npm run electron:dev

# 类型检查
npm run typecheck
npm run typecheck:electron

# 仅构建前端与 Electron 产物（不打包安装器）
npm run build:app

# 生产构建（含类型检查 + 打包）
npm run build

# patch 版本发布构建
npm run release:patch

# patch 版本并发布（GitHub Release）
npm run release:publish

# 预览生产构建
npm run preview

# 打包桌面应用
npm run electron:build

# ESLint 检查
npm run lint

# 运行测试
npm run test

# 测试（监听模式）
npm run test:watch

# 类型检查
npx tsc --noEmit                          # 检查 src/
npx tsc -p tsconfig.node.json --noEmit    # 检查 electron/

# 生成应用图标
node scripts/generate-icon.cjs
```

### 开发工作流
- `npm run electron:dev` 使用 `concurrently` 同时启动 Vite dev server（端口 5173）和 Electron
- `wait-on` 确保 Vite 就绪后再启动 Electron
- React 组件和 Electron 主进程均支持热重载
- 开发模式下自动打开 DevTools

---

## 架构

### 技术栈
- **Electron 40**：桌面应用框架（无边框窗口）
- **React 18 + TypeScript 5**：前端 UI，严格类型检查
- **Vite 7**：构建工具 + HMR + Electron 插件
- **Tailwind CSS 3**：自定义 Claude 暗色主题
- **react-markdown + remark-gfm**：Markdown 渲染
- **prism-react-renderer**：代码块语法高亮
- **lucide-react**：图标库
- **diff**：Myers diff 算法（DiffView 组件）
- **idb**：IndexedDB 封装（会话持久化）
- **@tanstack/react-virtual**：虚拟滚动（长消息列表优化）
- **electron-updater**：应用自动更新

### 项目结构

```
src/
├── App.tsx                  # 根组件：7 面板路由、全局快捷键、自定义标题栏
├── main.tsx                 # React 入口
├── components/
│   ├── Sidebar.tsx          # 侧边导航栏（对话/文件/归档/命令/工具/分析/设置）
│   ├── ErrorBoundary.tsx    # React 错误边界
│   ├── Chat/
│   │   ├── ChatPanel.tsx    # 聊天面板（会话管理、连接状态、Git、导出、主题切换、系统提示词配置）
│   │   ├── MessageList.tsx  # 消息渲染（Markdown、代码高亮、工具调用/确认 UI、Diff 视图）
│   │   ├── InputArea.tsx    # 输入区域（Enter 发送、Shift+Enter 换行、/命令菜单、图片拖放）
│   │   └── FileChangesPanel.tsx # 文件变更历史面板（快照列表、按轮次回滚）
│   ├── FileBrowser/
│   │   └── FileBrowserPanel.tsx # 文件浏览器（目录树、文件预览、Markdown 渲染、CSV/Excel 表格预览、图片预览、代码高亮、编辑保存）
│   ├── SessionArchive/
│   │   └── SessionArchivePanel.tsx # 会话归档面板（历史会话浏览、恢复）
│   ├── Analytics/
│   │   └── DataAnalysisPanel.tsx # 高级数据分析面板（ECharts 可视化、清洗/聚合、导出）
│   ├── Commands/
│   │   ├── CommandPanel.tsx # 斜杠命令浏览面板
│   │   └── CommandCard.tsx  # 单个命令卡片
│   ├── Tools/
│   │   ├── ToolsPanel.tsx   # 工具参考面板
│   │   └── ToolCard.tsx     # 单个工具卡片
│   └── Settings/
│       ├── SettingsPanel.tsx # 设置主面板（7 个子标签页）
│       ├── HooksConfig.tsx  # Hooks 配置管理
│       └── McpConfig.tsx    # MCP 服务器配置管理
├── hooks/
│   ├── useClaudeCode.ts     # 核心 Hook：多会话并行、per-session 流式状态、工具确认、用量统计
│   └── useAppSettings.ts    # 应用设置 Context + localStorage 持久化（v3，含迁移逻辑）
├── data/
│   ├── commands.ts          # Claude Code 斜杠命令定义（中文）
│   ├── promptTemplates.ts   # Prompt 模板定义（/review、/refactor、/test 等）
│   └── tools.ts             # 工具参考定义（参数、示例）
├── types/
│   └── electron.d.ts        # ElectronAPI 类型声明（全局 Window 扩展）
├── utils/
│   ├── pricing.ts           # 模型定价表 + 费用计算（Anthropic/OpenAI/DeepSeek）
│   ├── sessionStorage.ts    # 会话存储：创建/加载/保存（localStorage 同步层）
│   └── idbStorage.ts        # IndexedDB 异步存储 + localStorage 迁移
├── workers/
│   └── analysisWorker.ts    # 数据分析 Worker（聚合计算下沉）
└── styles/
    └── global.css           # 全局样式 + Tailwind 导入

electron/
├── main.ts                  # Electron 主进程入口：窗口管理、IPC handler、流式编排
├── types.ts                 # 跨模块共享类型（ContentBlock、ApiConfig、FileSnapshot 等）
├── tools.ts                 # 工具定义、危险命令判断、工具执行逻辑
├── api-client.ts            # API 调用层：Anthropic/OpenAI 流式与非流式请求
├── mcp-runtime.ts           # MCP 运行时：连接管理、工具发现与调用
├── snapshots.ts             # 文件快照系统：保存/回滚/清理
├── updater.ts               # 自动更新（electron-updater）
├── shared-types.ts          # 前后端共享的 IPC 载荷类型
└── preload.ts               # 安全 IPC 桥接（contextBridge）

build/
├── icon.png                 # 应用图标（256x256 PNG）
└── icon.ico                 # 应用图标（Windows ICO）
```

### 核心架构模式

#### 1. Agentic 工具调用循环（`electron/main.ts` + `electron/tools.ts`）

这是应用的核心引擎。当用户发送消息时：

1. 前端通过 IPC `claude-stream` 将 prompt 发送给主进程
2. 主进程构建 system prompt（包含工作目录和工具说明）
3. 调用 API（流式 SSE），实时将文本/工具调用事件转发给渲染进程
4. 如果 API 返回 `stop_reason: tool_use`：
   - 对每个工具调用检查是否安全（`SAFE_TOOLS`: read_file, list_dir, search_files）
   - 非安全工具发送 `tool_confirm` 事件等待用户审批（除非 `skipPermissions`）
   - 执行工具并将结果作为 `tool_result` 追加到对话历史
   - 进入下一轮循环（最多 `MAX_TOOL_ROUNDS = 30` 轮）
5. 如果 API 返回 `end_turn`，结束循环

**内置工具实现：**
- **bash**：`child_process.spawn`，60 秒超时，输出截断 20000 字符
- **read_file**：`fs.readFileSync`，截断 100000 字符
- **write_file**：`fs.writeFileSync`，自动创建目录
- **edit_file**：读取 → 字符串匹配替换 → 写回
- **list_dir**：递归遍历（最深 3 层，过滤 node_modules/.git 等，最多 500 条）
- **search_files**：Windows 用 `findstr`，Unix 用 `grep -rn`

#### 2. API 格式兼容

- **Anthropic 格式**：`/v1/messages`，SSE 事件流（message_start → content_block_start → content_block_delta → content_block_stop → message_delta）
- **OpenAI 格式**：`/v1/chat/completions`，SSE 事件流（delta.content + delta.tool_calls），自动转换消息格式和工具定义
- **SSE 解析增强**：识别 `event:` 行，处理 `event: error` 错误事件（自动 reject 并抛出可读错误信息）
- **非流式超时**：`callAPI` 设置 60 秒超时，防止摘要生成或 `claude-execute` 无限挂起

转换函数：
- `convertMessagesToOpenAI()`：将 Anthropic 格式消息转为 OpenAI 格式
- `convertToolsToOpenAI()`：将工具定义转为 OpenAI function calling 格式

#### 3. 多面板界面 + 面板保活

`App.tsx` 使用 **CSS display 控制可见性**而非条件渲染，所有面板始终挂载：
```tsx
<div className={`absolute inset-0 ${activePanel === 'chat' ? '' : 'hidden'}`}>
```
这确保切换面板时不会丢失正在进行的流式数据。

#### 4. 独立 Agent 并行（`useClaudeCode.ts`）

每个会话拥有独立的流式状态，可同时运行多个任务：
- **Per-session 状态管理**：`loadingSessions`（Set）、`streamBlocksMap`（Record）、`errorMap`（Record）
- 后端 `activeAbortControllers` 按 `sessionId` 键存，支持多会话同时流式
- 所有流式事件（`claude-stream-data/error/end`）携带 `sessionId`，前端按会话分发
- 切换会话时，后台任务继续运行不中断
- 活跃会话显示派生状态：`isLoading`、`streamBlocks`、`error`
- 会话选择器中正在运行的会话显示 ▶ 标记

#### 5. 多会话管理

- 会话数据**主存储**使用 IndexedDB（`src/utils/idbStorage.ts`），保留 localStorage 作为同步 fallback
- 首次加载时自动执行 localStorage → IndexedDB 一次性迁移
- 每个会话独立维护：消息历史、模型选择、Git 状态、自定义系统提示词、工作目录
- 后端通过 `conversationHistories` Map 维护每个 sessionId 的 API 对话历史
- 支持新建 / 切换 / 关闭会话，**智能标题提取**（移除 git context/代码块，按句子边界截断 40 字符）
- **会话级工作目录**：`ChatSession.workingDirectory` 优先于全局 `settings.workingDirectory`

#### 6. 工具确认与信任机制

- 非安全工具需用户确认，3 个操作按钮：
  - **允许执行**（绿色）：仅批准当前操作
  - **全部允许**（蓝色）：批准当前操作 + 自动批准本次对话后续所有操作
  - **拒绝**（红色）：拒绝当前操作
- 信任状态存储在 `trustedSessionsRef`（内存 Set），关闭应用后自动重置
- 已信任会话的后续 `tool_confirm` 事件在前端 `onStreamData` 中自动批准

#### 7. 桌面通知

- 后台会话完成（`onStreamEnd`）或失败（`onStreamError`）时，如果不是当前活跃会话，弹 Windows 桌面通知
- 使用 Electron `Notification` API，通过 `show-notification` IPC 通道
- 通知内容包含会话标题和完成/失败状态

#### 8. 文件快照与回滚系统（`electron/snapshots.ts`）

- 每次 `write_file` / `edit_file` 执行前，将文件原始内容保存到 `snapshotStore`（按 sessionId + turnNumber）
- 支持两种回滚方式：
  - **回滚到消息**（`rollbackToMessage`）：截断到指定消息并恢复文件
  - **回滚到轮次**（`rollbackToTurn`）：截断到指定轮次并恢复文件
- `FileChangesPanel` 展示按文件分组的变更历史，支持逐文件恢复

#### 9. 结构化消息块（`ContentBlock` 类型系统）

assistant 消息不是纯文本，而是 `ContentBlock[]` 数组：
- `TextBlock`：文本内容（Markdown 渲染）
- `ToolCallBlock`：工具调用（工具名 + 输入参数）
- `ToolResultBlock`：工具执行结果（输出 + 是否错误）
- `RoundBlock`：多轮思考分隔符
- `ToolConfirmBlock`：待确认工具（pending / approved / rejected 状态）

流式数据先通过 `requestAnimationFrame` 批量刷新累积在 `streamBlocksMap[sessionId]` 中，流结束后合并为一条 assistant `Message`。

#### 10. 虚拟滚动（`MessageList.tsx`）

- 使用 `@tanstack/react-virtual` 实现动态高度虚拟滚动
- 阈值：消息数量 >= 30 时自动启用，低于阈值使用普通渲染
- 每条消息提取为独立 `MessageItem` 组件，通过 `measureElement` 精确测量高度
- 流式内容区域不参与虚拟化，始终在列表底部渲染

#### 11. DiffView（`MessageList.tsx`）

- 使用 `diff` 库的 Myers 算法（`diffLines`）替代朴素 Set 比较
- 正确处理重复行、行顺序变化等复杂场景
- 支持复制新内容到剪贴板

#### 12. 设置系统（`useAppSettings.ts`）

通过 React Context 提供全局设置，7 个配置子面板：
- **基础设置**：默认模型、自定义模型名、工作目录、字体大小、模型参数（最大输出 Tokens）、聊天主题
- **API 配置**：主端点 + 备用端点 + 中转站端点（各自独立 API Key 和格式）、连接测试
- **模型管理**：增删模型列表、按模型指定端点（auto/main/alt/third），并支持为单模型配置自定义定价
- **Hooks**：PreToolUse / PostToolUse / Notification 事件的自定义命令
- **MCP 服务器**：名称、命令、参数、连接测试
- **更新**：版本检查、下载与安装
- **权限**：`dangerouslySkipPermissions` 开关

设置持久化到 `localStorage`（key: `claude-code-gui-settings-v3`），支持 v1/v2 迁移。迁移逻辑自动将旧 `127.0.0.1:3456` 端点替换为直连 API。

#### 13. 三端点路由（`useClaudeCode.ts`）

- `resolveModelEndpointSlot()`：按模型配置（auto/main/alt/third）决定端点槽位
- `isAltEndpointModel()`：作为 auto 策略的一部分，按模型前缀回退到备用端点（`gemini-*`、`claude-sonnet-4-5*`、`claude-opus-4-6*`）
- `selectRouting()`：根据槽位选择端点、Key、格式（main/alt/third）
- 主端点、备用端点、中转站端点均支持独立 `apiFormat`（`anthropic` / `openai`）
- 路由信息显示在模型选择器 tooltip 中，便于确认当前请求走向

#### 14. CSP 安全策略（`electron/main.ts`）

- 通过 `session.webRequest.onHeadersReceived` 注入 Content-Security-Policy 响应头
- `script-src 'self' 'unsafe-inline'`：仅允许自身和内联脚本
- `img-src 'self' data: blob: https:`：允许 base64 图片和 HTTPS 图片
- `connect-src 'self' ws: wss: http: https:`：允许 API 连接

#### 15. 自动更新（`electron/updater.ts`）

- 使用 `electron-updater`，仅在生产环境启用
- 不自动下载，先通知用户有新版本
- IPC 接口：`check-for-update`、`download-update`、`install-update`
- 启动后 10 秒自动检查一次，之后每 30 分钟自动检查一次
- 通过 `update-status` 事件向前端推送检查/下载/完成/失败状态

#### 16. MCP Runtime（`electron/mcp-runtime.ts`）

- 独立管理 MCP 进程生命周期：初始化、健康状态、超时与会话结束清理
- 同时兼容 `content-length` 与 `jsonl` 两类 stdio 传输模式
- 通过别名规则将 MCP 工具映射为 `mcp__{serverId}__{toolName}`，统一纳入工具调用循环
- 对命令、参数、环境变量做安全校验（阻断高风险 shell 命令和非法控制符）

---

## IPC 通信协议

### 渲染进程 → 主进程

| 通道 | 类型 | 说明 |
|------|------|------|
| `window-minimize` | send | 最小化窗口 |
| `window-maximize` | send | 最大化/还原窗口 |
| `window-close` | send | 关闭窗口 |
| `claude-stream` | invoke | 发起流式对话（payload 含 sessionId、maxTokens） |
| `claude-execute` | invoke | 非流式单次执行（兼容，支持 useClaudeCodePrompt） |
| `claude-stream-stop` | invoke | 中止指定会话的请求（按 sessionId） |
| `clear-history` | invoke | 清除指定会话历史 |
| `sync-session-history` | invoke | 同步前端会话历史到主进程（回滚映射修正） |
| `tool-confirm-response` | invoke | 用户确认/拒绝工具执行 |
| `select-folder` | invoke | 打开文件夹选择对话框 |
| `select-files` | invoke | 打开文件选择对话框（附加图片/文件） |
| `git-status` | invoke | 获取 Git 状态 |
| `check-api-connection` | invoke | 测试 API 连接 |
| `test-mcp-connection` | invoke | 测试 MCP 服务器连接 |
| `export-chat` | invoke | 导出对话为 Markdown 文件 |
| `import-chat` | invoke | 导入 Markdown 对话文件 |
| `rollback` | invoke | 回滚到指定轮次（恢复文件快照 + 截断历史） |
| `restore-file` | invoke | 恢复单个文件到某个快照版本 |
| `get-snapshots` | invoke | 获取指定会话的文件快照列表 |
| `list-directory` | invoke | 列出目录内容（文件浏览器） |
| `read-file-content` | invoke | 读取文件内容（文件浏览器预览：文本或二进制 base64，如图片/Excel） |
| `write-file-content` | invoke | 写入文件内容（文件浏览器编辑保存） |
| `open-external` | invoke | 打开外部链接或在系统中打开本地文件（受路径校验） |
| `show-notification` | invoke | 发送桌面通知 |
| `get-app-version` | invoke | 获取当前应用版本号 |
| `check-for-update` | invoke | 检查更新 |
| `download-update` | invoke | 下载更新 |
| `install-update` | invoke | 安装更新并重启 |
| `secure-store-set/get/delete` | invoke | 安全存储（加密 API Key） |
| `remove-stream-listeners` | bridge | 移除流式事件监听器（前端卸载清理） |
| `on-update-status` / `remove-update-listeners` | bridge | 订阅/清理自动更新状态事件 |

### 主进程 → 渲染进程（流式事件）

所有流式事件的第一个参数均为 `sessionId`，支持多会话并行分发：

| 通道 / type | 字段 | 说明 |
|------|------|------|
| `claude-stream-data` (type=`text`) | sessionId, content | 文本增量 |
| `claude-stream-data` (type=`tool_call`) | sessionId, toolId, toolName, input | 模型发起工具调用 |
| `claude-stream-data` (type=`tool_result`) | sessionId, toolId, toolName, output, isError | 工具执行结果 |
| `claude-stream-data` (type=`tool_confirm`) | sessionId, confirmId, toolName, input | 需要用户确认 |
| `claude-stream-data` (type=`round`) | sessionId, round | 新一轮思考开始 |
| `claude-stream-data` (type=`usage`) | sessionId, inputTokens, outputTokens, cacheCreationInputTokens?, cacheReadInputTokens?, reasoningTokens? | Token 用量 |
| `claude-stream-error` | sessionId, error | 错误信息 |
| `claude-stream-end` | sessionId, code | 流式结束（0=成功，1=错误） |

---

## 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建会话 |
| `Ctrl+L` | 清除当前对话 |
| `Ctrl+,` | 打开设置面板 |
| `Ctrl+E` | 导出对话 |
| `Ctrl+F` | 搜索消息 |
| `Ctrl+1~7` | 切换面板（对话/文件/归档/命令/工具/分析/设置；设置为 Ctrl+7） |
| `Ctrl+/` | 快捷键帮助浮层 |
| `Escape` | 停止当前任务 |
| `Enter` | 发送消息 |
| `Shift+Enter` | 输入换行 |

---

## 自定义主题色

Tailwind 配置（`tailwind.config.js`）中定义的 Claude 品牌色：

| Token | 色值 | 用途 |
|-------|------|------|
| `claude-bg` | `#1a1a2e` | 页面背景 |
| `claude-surface` | `#16213e` | 卡片/面板背景 |
| `claude-surface-light` | `#1f2b4a` | 悬停态背景 |
| `claude-border` | `#2d3a5a` | 边框 |
| `claude-primary` | `#7c3aed` | 主色调（紫色） |
| `claude-primary-light` | `#8b5cf6` | 主色调浅色 |
| `claude-accent` | `#06b6d4` | 强调色（青色） |
| `claude-text` | `#e2e8f0` | 主文本 |
| `claude-text-muted` | `#94a3b8` | 次要文本 |

---

## 费用估算系统（`src/utils/pricing.ts`）

内置定价表覆盖以下模型系列（按前缀匹配）：

- **Anthropic**：Claude Opus 4、Claude Sonnet 4/4.5、Claude Haiku 3.5、Claude 3 系列
- **OpenAI**：GPT-4o/Mini、GPT-4 Turbo、o1/o3/o4 系列
- **DeepSeek**：deepseek-chat、deepseek-reasoner

`SessionUsage` 在 `useClaudeCode` 中按会话累积，每次 API 返回 usage 事件时更新；支持缓存/推理 token 的独立统计，并支持按模型自定义定价覆盖内置定价。

---

## 构建配置

### Vite（`vite.config.ts`）
- React 插件 + Electron 主/预加载脚本插件
- 开发服务器端口 5173（strictPort）
- 输出目录 `dist/`

### Electron Builder（`package.json` → `build`）
- **App ID**：`com.claude-code.gui`
- **Windows**：NSIS 安装包 + 自定义图标（`build/icon.ico`）
- **macOS**：DMG
- **Linux**：AppImage
- **输出目录**：`release/`
- **包含文件**：`dist/**/*` + `dist-electron/**/*`

### ESLint（`eslint.config.js`）
- flat config + `typescript-eslint`
- 与项目风格一致：无分号、单引号、2 空格缩进
- `npm run lint` 检查 `src/` 和 `electron/`

### Vitest（`vitest.config.ts`）
- jsdom 环境，支持 globals
- `npm run test` 运行所有测试
- `npm run test:watch` 监听模式
- 测试文件约定：`*.test.ts` / `*.test.tsx`

### TypeScript
- 严格模式（strict: true）
- 目标 ES2020 + 现代模块解析
- 独立模块编译

---

## 开发注意事项

### 窗口管理
- 无边框窗口（`frame: false`）+ 自定义标题栏
- 最小尺寸 900×600，默认 1200×800
- 背景色 `#1a1a2e`
- macOS 上关闭所有窗口不退出应用

### 状态管理
- 纯 React Hooks（useState / useCallback / useMemo / useRef / useContext）
- 无外部状态库
- `useAppSettings` 通过 Context 提供全局设置
- `useClaudeCode` 管理所有聊天相关状态（per-session 流式状态、信任列表、通知）
- 会话数据持久化到 IndexedDB（主存储）+ localStorage（同步 fallback）
- 会话存储逻辑提取到 `src/utils/sessionStorage.ts` 和 `src/utils/idbStorage.ts`
- 流式回调中使用 `useRef` 保持最新值引用（`activeSessionIdRef`、`sessionsRef`、`activeModelRef`、`activeSessionRef`），避免闭包捕获陈旧状态

### 安全模型
- `contextIsolation: true` + `nodeIntegration: false` + `webSecurity: true`
- CSP 安全策略限制脚本/样式/连接来源
- 所有 Node API 通过 `preload.ts` 的 `contextBridge` 暴露
- 工具安全白名单：`read_file`、`list_dir`、`search_files`
- 非安全工具需用户确认，确认 Promise 存储在 `pendingConfirmations` Map 中
- "全部允许"功能：前端 `trustedSessionsRef` 记录信任会话，自动批准后续工具调用
- 中止请求时自动拒绝所有待确认工具
- `skipPermissions` 模式下仍拦截高危命令（`rm -rf /`、`format` 等，见 `DANGEROUS_CMD_PATTERNS`）
- API Key 通过 Electron `safeStorage` 加密存储

### 错误处理
- API 不可用时显示连接状态指示器
- 工作目录未设置时显示黄色提示
- 工具执行错误在 UI 中标红显示
- 非 Electron 环境提供模拟响应（方便浏览器调试）
- 流式请求失败自动重试（5xx / 429 / 网络错误，最多 2 次）
- 非流式请求 60 秒超时保护（摘要生成、`claude-execute`）
- SSE `event: error` 错误事件识别与上报
- 工具结果截断时附带原始长度信息（`original N chars`），帮助模型理解上下文缺失量
- React ErrorBoundary 捕获渲染异常

### GPU 兼容性
- 主进程禁用硬件加速（`disableHardwareAcceleration`）
- 禁用 GPU 和软件光栅化（解决 Windows GPU 缓存权限问题）
- 可通过 `userData/gpu-config.json` 配置 `{ "disableGpu": false }` 启用 GPU

### 代码规范
- 所有 UI 文本使用中文
- Tailwind 工具类 + 自定义 Claude 主题色
- 组件按功能分目录（Chat / FileBrowser / SessionArchive / Analytics / Commands / Tools / Settings）
- 类型定义集中在 `src/types/electron.d.ts` 和各模块内部

---

## 默认 API 配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 主端点 | `https://www.aidawan.fun` | OpenAI 兼容格式 |
| 备用端点 | `http://127.0.0.1:8045` | OpenAI 兼容格式（Gemini/Claude 4.5/4.6 等模型） |
| 中转站端点 | `https://fucaixie.xyz` | 可按模型显式指定走 third 端点 |
| 主端点格式 | `openai` | OpenAI Chat Completions API |
| 备用端点格式 | `openai` | OpenAI Chat Completions API |
| 中转站端点格式 | `openai` | OpenAI Chat Completions API |
| 默认模型 | `glm-5` | 智谱 GLM-5 |

模型路由规则（`resolveModelEndpointSlot` + `isAltEndpointModel`）：
- 若模型在“模型管理”里显式指定端点（main/alt/third），优先使用显式配置
- 若端点为 auto：
  - `gemini-*` → 备用端点
  - `claude-sonnet-4-5*` → 备用端点
  - `claude-opus-4-6*` → 备用端点
  - 其他 → 主端点