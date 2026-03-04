# MCP 使用配置指南（面向其他用户）

本文档说明如何在 Claude Code GUI 中配置并使用 MCP（Model Context Protocol）服务器，包含 **0 key 方案** 和 **需要 API key 的方案**。

## 1. 前置准备

- 已安装 Node.js（建议 18+）
- 能正常打开 Claude Code GUI
- 如使用需要 key 的 MCP（例如搜索 API），准备对应服务的 API key

> Windows 下推荐使用 `node.exe + npx-cli.js` 的方式启动 MCP，稳定性通常更好。

---

## 2. 在 GUI 中配置 MCP 的入口

1. 打开：`设置 -> MCP 服务器`
2. 点击：`添加服务器`
3. 填写：
   - 名称
   - 命令（command）
   - 参数（args）
   - 环境变量（env，可选）
4. 点击：`测试连接`
5. 点击：`保存配置`

---

## 3. 字段怎么填

### 3.1 command（命令）
填写可执行程序路径。例如：

```txt
D:/nodejs/node.exe
```

### 3.2 args（参数）
填写完整参数字符串（包含 `npx-cli.js` 和包名）。例如：

```txt
D:/nodejs/node_modules/npm/bin/npx-cli.js -y playwright-mcp
```

### 3.3 env（环境变量）
在 GUI 的 `环境变量(env)` 区域中按 key/value 添加。

示例：

- KEY: `BRAVE_API_KEY`
- VALUE: `你的实际 key`

---

## 4. 推荐配置示例

### 4.1 0 key 方案（无需任何 API key）

#### Playwright 网页抓取 MCP

- 名称：`playwright`
- command：

```txt
D:/nodejs/node.exe
```

- args：

```txt
D:/nodejs/node_modules/npm/bin/npx-cli.js -y playwright-mcp
```

- env：留空

用途：网页搜索、打开页面、抓取正文、截图。

---

### 4.2 搜索 + 抓取（搜索需要 key）

#### Brave Search MCP（需要 key）

- 名称：`brave-search`
- command：

```txt
D:/nodejs/node.exe
```

- args：

```txt
D:/nodejs/node_modules/npm/bin/npx-cli.js -y @modelcontextprotocol/server-brave-search
```

- env：
  - `BRAVE_API_KEY=你的 key`

#### Playwright MCP（可与上面同时使用）

- 名称：`playwright`
- command：

```txt
D:/nodejs/node.exe
```

- args：

```txt
D:/nodejs/node_modules/npm/bin/npx-cli.js -y playwright-mcp
```

- env：留空

---

## 5. 对话里如何触发 MCP

配置完成后，在聊天中直接描述任务即可，例如：

```text
先搜索今天的 AI 新闻，再打开前 3 条原文抓取并总结。
```

或（0 key，仅 Playwright）：

```text
用浏览器搜索“今天 AI 新闻”，打开前 5 条并给出摘要与链接。
```

---

## 6. 常见问题

### Q1: 测试连接失败（ENOENT）
通常是 command 或 args 路径不对。请检查 `node.exe` 与 `npx-cli.js` 的实际安装路径。

### Q2: 需要加很多参数怎么办？
全部写在 args 一行即可（空格分隔）。

### Q3: env 里写什么？
以所用 MCP 的官方文档为准。常见是 API key、endpoint、region 等。

### Q4: 为什么普通聊天没有 MCP 提示？
当前实现是按需调用 MCP：只有模型实际触发 MCP 工具时才执行，不会在普通聊天中额外刷提示。

---

## 7. 安全建议

- 不要在共享截图中暴露 env 的 value（尤其 API key）
- 优先使用最小权限 key
- 不再使用的 MCP 条目及时删除

---

## 8. 给团队成员的最短上手步骤

1. 在设置里复制同样的 command/args/env
2. 每个条目点“测试连接”直到通过
3. 点“保存配置”
4. 聊天中直接下达“搜索/抓取/总结”任务

这样其他用户即可复用同一套 MCP 能力。