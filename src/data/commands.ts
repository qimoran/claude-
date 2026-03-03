export interface Command {
  name: string
  shortcut?: string
  description: string
  usage?: string
  examples?: string[]
}

export const commands: Command[] = [
  {
    name: '/help',
    description: '显示帮助信息和可用命令列表',
    usage: '/help [command]',
    examples: ['/help', '/help config'],
  },
  {
    name: '/clear',
    description: '清除当前对话历史，开始新的会话',
    usage: '/clear',
    examples: ['/clear'],
  },
  {
    name: '/compact',
    description: '压缩对话上下文，保留关键信息以节省 token',
    usage: '/compact [instructions]',
    examples: ['/compact', '/compact 保留代码相关内容'],
  },
  {
    name: '/config',
    description: '查看或修改 Claude Code 配置',
    usage: '/config [key] [value]',
    examples: ['/config', '/config model opus', '/config theme dark'],
  },
  {
    name: '/cost',
    description: '显示当前会话的 token 使用量和费用统计',
    usage: '/cost',
    examples: ['/cost'],
  },
  {
    name: '/doctor',
    description: '诊断环境问题，检查 Claude Code 运行状态',
    usage: '/doctor',
    examples: ['/doctor'],
  },
  {
    name: '/init',
    description: '在当前项目初始化 CLAUDE.md 配置文件',
    usage: '/init',
    examples: ['/init'],
  },
  {
    name: '/login',
    description: '登录到 Anthropic 账户',
    usage: '/login',
    examples: ['/login'],
  },
  {
    name: '/logout',
    description: '退出当前登录的账户',
    usage: '/logout',
    examples: ['/logout'],
  },
  {
    name: '/memory',
    description: '管理项目记忆文件 CLAUDE.md',
    usage: '/memory [action]',
    examples: ['/memory', '/memory edit', '/memory refresh'],
  },
  {
    name: '/model',
    description: '切换使用的 Claude 模型',
    usage: '/model [model-name]',
    examples: ['/model', '/model opus', '/model sonnet', '/model haiku'],
  },
  {
    name: '/permissions',
    description: '管理工具权限和允许的操作',
    usage: '/permissions',
    examples: ['/permissions'],
  },
  {
    name: '/pr-comments',
    description: '查看当前 PR 的评论',
    usage: '/pr-comments',
    examples: ['/pr-comments'],
  },
  {
    name: '/review',
    description: '对代码进行审查',
    usage: '/review [file-or-pr]',
    examples: ['/review', '/review src/main.ts', '/review #123'],
  },
  {
    name: '/status',
    description: '显示 Claude Code 状态信息',
    usage: '/status',
    examples: ['/status'],
  },
  {
    name: '/terminal-setup',
    description: '配置终端集成设置',
    usage: '/terminal-setup',
    examples: ['/terminal-setup'],
  },
  {
    name: '/vim',
    description: '切换 Vim 编辑模式',
    usage: '/vim',
    examples: ['/vim'],
  },
]
