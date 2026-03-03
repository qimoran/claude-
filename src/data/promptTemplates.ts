export interface PromptTemplate {
  id: string
  command: string      // 以 / 开头的命令名
  label: string        // 显示名称
  description: string  // 简短描述
  prompt: string       // 实际插入的 prompt 内容（可包含 {{selection}} 占位符）
  category: 'code' | 'debug' | 'explain' | 'general'
}

export const builtinTemplates: PromptTemplate[] = [
  // ── 代码 ──
  {
    id: 'review',
    command: '/review',
    label: '代码审查',
    description: '审查当前项目代码，找出问题和改进建议',
    prompt: '请仔细审查当前项目的代码，找出潜在的 bug、安全问题、性能问题和代码风格问题，并给出具体的改进建议。',
    category: 'code',
  },
  {
    id: 'refactor',
    command: '/refactor',
    label: '重构代码',
    description: '重构指定代码，提升可读性和可维护性',
    prompt: '请重构以下代码，提升可读性、可维护性和性能，保持功能不变：\n\n',
    category: 'code',
  },
  {
    id: 'test',
    command: '/test',
    label: '编写测试',
    description: '为当前代码编写单元测试',
    prompt: '请为当前项目中的核心函数编写全面的单元测试，覆盖正常情况和边界情况。使用项目已有的测试框架。',
    category: 'code',
  },
  {
    id: 'types',
    command: '/types',
    label: '添加类型',
    description: '为代码添加 TypeScript 类型注解',
    prompt: '请检查项目中缺少类型注解的地方，添加完整的 TypeScript 类型定义，确保类型安全。',
    category: 'code',
  },
  // ── 调试 ──
  {
    id: 'debug',
    command: '/debug',
    label: '调试问题',
    description: '分析并修复当前遇到的问题',
    prompt: '我遇到了一个问题，请帮我分析原因并修复：\n\n',
    category: 'debug',
  },
  {
    id: 'fix',
    command: '/fix',
    label: '修复错误',
    description: '修复指定的错误或警告',
    prompt: '请修复以下错误/警告，确保代码正常运行：\n\n',
    category: 'debug',
  },
  {
    id: 'perf',
    command: '/perf',
    label: '性能优化',
    description: '分析并优化代码性能',
    prompt: '请分析当前项目的性能瓶颈，提出具体的优化方案并实施。关注：渲染性能、内存使用、网络请求、算法效率。',
    category: 'debug',
  },
  // ── 解释 ──
  {
    id: 'explain',
    command: '/explain',
    label: '解释代码',
    description: '详细解释代码的工作原理',
    prompt: '请详细解释以下代码的工作原理，包括每个关键步骤的作用：\n\n',
    category: 'explain',
  },
  {
    id: 'doc',
    command: '/doc',
    label: '生成文档',
    description: '为代码生成注释和文档',
    prompt: '请为当前项目的核心模块生成清晰的代码注释和 README 文档，包括：功能说明、使用方法、API 接口、配置说明。',
    category: 'explain',
  },
  // ── 通用 ──
  {
    id: 'init',
    command: '/init',
    label: '项目初始化',
    description: '了解项目结构并给出概览',
    prompt: '请先读取项目的目录结构和关键配置文件（package.json、tsconfig.json 等），然后给我一个项目概览，包括：技术栈、项目结构、核心模块、入口文件。',
    category: 'general',
  },
  {
    id: 'git',
    command: '/git',
    label: 'Git 操作',
    description: '查看 Git 状态并建议提交',
    prompt: '请查看当前 Git 状态，列出所有修改的文件，并建议合适的 commit message。如果有未暂存的更改，请说明哪些应该一起提交。',
    category: 'general',
  },
  {
    id: 'deps',
    command: '/deps',
    label: '依赖检查',
    description: '检查项目依赖是否有问题',
    prompt: '请检查项目的依赖：1) 是否有过时的包需要更新；2) 是否有安全漏洞；3) 是否有未使用的依赖可以移除；4) 是否缺少必要的依赖。',
    category: 'general',
  },
]

export const categoryLabels: Record<string, string> = {
  code: '代码',
  debug: '调试',
  explain: '解释',
  general: '通用',
}
