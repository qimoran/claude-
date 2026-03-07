# 发布说明

本文档汇总近期已完成的功能调整、问题修复与发布链路修复。

## 近期更新

### 聊天与统计
- 修复会话总耗时与模型耗时的统计链路
- 区分：
  - 请求总耗时：从用户发送请求到流式结束
  - 模型耗时：从首个真实模型输出到流式结束
- 新增并稳定展示以下指标：
  - 会话累计耗时
  - 最近一次请求耗时
  - 会话累计模型耗时
  - 最近一次模型耗时
- 修复后续对话时最近耗时不更新的问题
- 修复模型耗时起点偏移导致统计不准的问题
- 补齐一个边界场景：当模型首个输出是 `tool_use` 而不是文本时，后端会先发送 `model_start` 事件，前端据此立即锁定模型耗时起点，避免模型耗时被低估

### 计费与定价
- 支持按细分 token 类型计算费用：
  - input tokens
  - output tokens
  - cache creation input tokens
  - cache read input tokens
  - reasoning tokens
- 支持模型定价前缀匹配
- 支持模型级自定义定价覆盖内置定价
- 修复未知定价场景的费用显示：
  - 已知费用 + 未知请求混合时显示为 `已知费用 + 未知`
  - 全未知时显示为 `未配置`
- 补充最近一次请求费用统计与展示，便于对照累计费用核对最近一轮请求计费是否正确
- 会话统计中保留：
  - 累计总费用
  - 最近一次费用
  - 未知定价请求计数
  - 最近一次未知定价标记

### 界面与加载优化
- 将高级数据分析面板改为懒加载
- 降低主包体积压力，避免首次加载把分析模块一并打入主入口执行路径
- 保持面板显示行为不变，并增加加载中占位文案

### 构建与发布
- 修复发布污染问题，避免历史发布目录与工作树残留内容进入 Electron 打包结果
- 在 Electron Builder 打包白名单中显式排除以下目录：
  - `release/**`
  - `release-alt/**`
  - `release-alt2/**`
  - `release-alt3/**`
  - `.claude/**`
- 扩展预清理脚本，在构建前主动清理：
  - `dist/`
  - `dist-electron/`
  - 当前发布输出目录
  - `release-alt/`
  - `release-alt2/`
  - `release-alt3/`
- 保留 Windows 下对占用文件的重试与容错处理，避免构建流程被锁文件完全阻断

## 影响文件
- `src/hooks/useClaudeCode.ts`
- `src/components/Chat/ChatPanel.tsx`
- `src/utils/pricing.ts`
- `src/App.tsx`
- `electron/api-client.ts`
- `electron/main.ts`
- `package.json`
- `scripts/prebuild-clean.cjs`

## 验证

已执行或建议执行：

```bash
npm run lint
npm run typecheck
npm run typecheck:electron
npm run build:app
npm run electron:build
```

## 说明
- 本轮改动无需用户迁移配置
