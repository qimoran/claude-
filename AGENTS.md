# AGENTS.md

本文件面向在本仓库工作的自动化编码代理（Agent）。
目标：快速对齐构建/验证命令与代码风格，减少试错。

## 1. 仓库事实（先读）

- 技术栈：Electron 40 + React 18 + TypeScript 5 + Vite 7 + Tailwind CSS 3。
- 包管理器：npm（存在 `package-lock.json`）。
- 已配置 ESLint（flat config + typescript-eslint）和 Vitest（jsdom 环境）。
- 未配置 Prettier。
- TypeScript 开启严格模式（`strict: true`），并启用 `noUnusedLocals/noUnusedParameters`。
- UI 文案默认中文（项目既有约定）。

## 2. 规则文件来源

- 已发现并采纳：`CLAUDE.md`（项目内高优先级工程说明）。
- 未发现：`.cursorrules`。
- 未发现：`.cursor/rules/` 目录。
- 未发现：`.github/copilot-instructions.md`。

若后续新增 Cursor/Copilot 规则，请将其合并到本文件并标注优先级。

## 3. 构建/开发/验证命令

以下命令来自 `package.json`，可直接使用：

```bash
npm install
npm run dev
npm run typecheck
npm run typecheck:electron
npm run build:app
npm run build
npm run release:patch
npm run release:publish
npm run electron:dev
npm run electron:build
npm run preview
npm run lint
npm run test
npm run test:watch
```

### 3.1 命令用途速查

- `npm install`：安装依赖。
- `npm run dev`：仅启动 Vite 前端开发服务（默认 5173）。
- `npm run typecheck`：检查 `src/` TypeScript 类型。
- `npm run typecheck:electron`：检查 `electron/` 与 `vite.config.ts` 类型。
- `npm run build:app`：清理构建目录后执行 `vite build`。
- `npm run build`：`typecheck + typecheck:electron + build:app + electron-builder`（完整生产构建+打包）。
- `npm run release:patch`：版本号 `patch` 递增并执行完整构建。
- `npm run release:publish`：版本号 `patch` 递增并执行构建后发布（`electron-builder --publish always`）。
- `npm run electron:dev`：并行启动 Vite + Electron（本地开发主流程）。
- `npm run electron:build`：与 `build` 一样先做类型检查，再打包。
- `npm run preview`：预览前端构建产物。
- `npm run lint`：ESLint 检查 `src/` 和 `electron/`。
- `npm run test`：运行 Vitest 全部测试。
- `npm run test:watch`：Vitest 监听模式。

### 3.2 类型检查（推荐）

仓库已提供独立脚本，也可直接运行 `tsc`：

```bash
npm run typecheck
npm run typecheck:electron

# 或等价命令
npx tsc --noEmit
npx tsc -p tsconfig.node.json --noEmit
```

- 前者检查 `src/`。
- 后者检查 `electron/` 与 `vite.config.ts`。

### 3.3 Lint

- ESLint 已配置（`eslint.config.js`，flat config + typescript-eslint）。
- `npm run lint` 检查 `src/` 和 `electron/` 目录。
- 风格规则：无分号、单引号、`prefer-const`、`@typescript-eslint/no-explicit-any` 警告。

### 3.4 Test

- 已配置 Vitest（`vitest.config.ts`，jsdom 环境）。
- `npm run test`：运行全部测试。
- `npm run test:watch`：Vitest 监听模式。
- 测试文件约定：`*.test.ts` / `*.test.tsx`，放在被测文件同目录。

### 3.5 单测命令

```bash
npx vitest run path/to/file.test.ts
npx vitest run path/to/file.test.ts -t "case name"
```

## 4. 代码风格与约定

以下基于现有代码统计与 `CLAUDE.md` 约束，不是理想化规范。

### 4.1 导入（imports）

- 使用 ES Modules，路径字符串统一单引号。
- 导入顺序建议：
  1) React/Node 内置；
  2) 第三方库；
  3) 本地模块（相对路径）。
- 保持分组稳定，避免无意义重排。
- 仅在必要时保留默认导入（遵循现有文件模式）。

### 4.2 格式化（formatting）

- 不使用分号（保持现有无分号风格）。
- 缩进为 2 空格。
- 允许尾随逗号（多行结构中常见）。
- TS/TSX 中保持单引号、模板字符串与早返回风格。
- 注释以“解释非显而易见逻辑”为准，避免注释噪音。

### 4.3 类型系统（types）

- 优先显式类型：接口、联合类型、字面量类型已大量使用。
- 避免 `any`；优先 `unknown` + 收窄。
- 公共结构（消息块、IPC 载荷）应定义清晰类型并复用。
- 新增字段时，前后端（`preload` / `renderer` / `main`）类型要同步。
- 依赖 strict 模式，避免“先写再修”式类型逃逸。

### 4.4 命名约定（naming）

- 组件/类型：`PascalCase`。
- 变量/函数：`camelCase`。
- 常量：`UPPER_SNAKE_CASE`（用于全局常量/阈值）。
- Hook 命名：`useXxx`。
- 事件名与 IPC 通道使用语义化短语（如 `claude-stream-data`、`app:stop`）。

### 4.5 React 与状态管理

- 以函数组件 + Hooks 为主，不引入额外状态库。
- 高频回调优先 `useCallback`；派生值用 `useMemo`。
- 流式/异步监听场景用 `useRef` 防止闭包捕获旧状态。
- 面板切换采用“保持挂载 + 显隐控制”，避免中断流式会话。

### 4.6 Electron/IPC 约束

- 安全基线：`contextIsolation: true`、`nodeIntegration: false`。
- 所有渲染进程能力经 `preload.ts` 暴露，禁止直接越权访问 Node API。
- IPC 结构变更必须三处同步：
  - `electron/main.ts`（或对应子模块）handler；
  - `electron/preload.ts` bridge；
  - `src/types/electron.d.ts`（或对应前端类型）。

### 4.7 错误处理（error handling）

- 异步流程使用 `try/catch`，错误提示应可读、可定位。
- 工具执行失败返回结构化错误文本（现有风格：`[error] ...`）。
- 对可恢复失败提供降级路径（例如本地缓存失败时保底存储）。
- 流式任务需正确清理状态（loading、监听器、pending confirmations）。

### 4.8 文件与路径操作

- 所有路径操作优先 `path.resolve/path.join`。
- 必须做工作目录边界校验，防止路径遍历。
- 变更文件前遵循“读取当前内容再修改”的工作流。
- 优先做精确替换，减少整文件覆盖。

### 4.9 UI 与文案

- 界面文案默认中文。
- 样式基于 Tailwind + `claude-*` 主题色变量。
- 新增交互需兼顾状态反馈（加载、错误、禁用态、连接态）。
- 文件浏览器预览约定：CSV/Excel/图片可渲染预览；图片与 Excel 视为二进制预览，默认不提供编辑保存入口。

## 5. 代理执行建议（实操）

- 改动前先读相关模块。Electron 主进程已拆分为多个文件：
  - `electron/main.ts`：窗口管理 + IPC handler + 流式编排
  - `electron/types.ts`：跨模块共享类型
  - `electron/tools.ts`：工具定义 + 执行逻辑
  - `electron/api-client.ts`：API 调用层
  - `electron/snapshots.ts`：文件快照系统
  - `electron/updater.ts`：自动更新
  - `electron/mcp-runtime.ts`：MCP 运行时（连接、工具发现、调用、超时与清理）
  - 前端核心 hooks：`useClaudeCode.ts`、`useAppSettings.ts`
- 优先小步修改；涉及协议字段时一次性全链路打通。
- 提交前至少执行：
  - `npx tsc --noEmit`
  - `npx tsc -p tsconfig.node.json --noEmit`
  - `npm run test`（确保测试通过）
  - 必要时 `npm run build`（重改动建议执行）

## 6. 快速检查清单

- 是否遵循现有无分号/单引号/2空格风格？
- 是否避免了 `any` 并补齐了必要类型？
- 是否处理了错误分支与资源清理？
- 是否保持中文 UI 文案一致性？
- 是否更新了相关文档与类型桥接？
- 是否使用真实可运行命令完成验证？
- Electron 主进程改动是否同步到正确的子模块（types/tools/api-client/snapshots/updater/mcp-runtime）？

---

维护说明：当 `package.json` scripts、测试框架、lint 体系或外部规则文件变化时，请第一时间更新本 AGENTS.md。
