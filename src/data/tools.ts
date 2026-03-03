export interface ToolParam {
  name: string
  type: string
  required: boolean
  description: string
}

export interface Tool {
  name: string
  icon: string
  description: string
  params: ToolParam[]
  examples: string[]
}

export const tools: Tool[] = [
  {
    name: 'Bash',
    icon: 'Terminal',
    description: '执行 shell 命令，支持 git、npm、docker 等各种终端操作',
    params: [
      { name: 'command', type: 'string', required: true, description: '要执行的 bash 命令' },
      { name: 'timeout', type: 'number', required: false, description: '命令超时时间（毫秒）' },
    ],
    examples: [
      'git status',
      'npm install',
      'docker ps',
      'ls -la',
    ],
  },
  {
    name: 'Read',
    icon: 'FileText',
    description: '读取文件内容，支持文本文件、图片、PDF 和 Jupyter 笔记本',
    params: [
      { name: 'file_path', type: 'string', required: true, description: '文件的绝对路径' },
      { name: 'offset', type: 'number', required: false, description: '开始读取的行号' },
      { name: 'limit', type: 'number', required: false, description: '读取的行数' },
    ],
    examples: [
      '/src/main.ts',
      '/README.md',
      '/docs/image.png',
    ],
  },
  {
    name: 'Write',
    icon: 'FilePlus',
    description: '创建新文件或完全覆盖现有文件的内容',
    params: [
      { name: 'file_path', type: 'string', required: true, description: '文件的绝对路径' },
      { name: 'content', type: 'string', required: true, description: '要写入的内容' },
    ],
    examples: [
      '创建 /src/utils.ts',
      '写入配置文件',
    ],
  },
  {
    name: 'Edit',
    icon: 'FileEdit',
    description: '精确替换文件中的文本内容，支持批量替换',
    params: [
      { name: 'file_path', type: 'string', required: true, description: '文件的绝对路径' },
      { name: 'old_string', type: 'string', required: true, description: '要替换的原文本' },
      { name: 'new_string', type: 'string', required: true, description: '替换后的新文本' },
      { name: 'replace_all', type: 'boolean', required: false, description: '是否替换所有匹配项' },
    ],
    examples: [
      '修改函数名',
      '更新导入路径',
      '批量替换变量名',
    ],
  },
  {
    name: 'Glob',
    icon: 'FolderSearch',
    description: '使用 glob 模式匹配查找文件',
    params: [
      { name: 'pattern', type: 'string', required: true, description: 'glob 匹配模式' },
      { name: 'path', type: 'string', required: false, description: '搜索的根目录' },
    ],
    examples: [
      '**/*.ts',
      'src/**/*.tsx',
      '*.json',
    ],
  },
  {
    name: 'Grep',
    icon: 'Search',
    description: '在文件内容中搜索匹配的文本或正则表达式',
    params: [
      { name: 'pattern', type: 'string', required: true, description: '搜索的正则表达式' },
      { name: 'path', type: 'string', required: false, description: '搜索的目录或文件' },
      { name: 'glob', type: 'string', required: false, description: '文件过滤模式' },
    ],
    examples: [
      'function.*export',
      'TODO|FIXME',
      'import.*from',
    ],
  },
  {
    name: 'Task',
    icon: 'Users',
    description: '启动专门的子代理来处理复杂的多步骤任务',
    params: [
      { name: 'prompt', type: 'string', required: true, description: '任务描述' },
      { name: 'subagent_type', type: 'string', required: true, description: '代理类型: Bash, Explore, Plan 等' },
    ],
    examples: [
      '探索代码库结构',
      '规划实现方案',
      '并行执行多个任务',
    ],
  },
  {
    name: 'WebFetch',
    icon: 'Globe',
    description: '获取网页内容并使用 AI 处理分析',
    params: [
      { name: 'url', type: 'string', required: true, description: '要获取的 URL' },
      { name: 'prompt', type: 'string', required: true, description: '对内容的处理指令' },
    ],
    examples: [
      '获取 API 文档',
      '抓取网页数据',
    ],
  },
  {
    name: 'WebSearch',
    icon: 'SearchCode',
    description: '在网络上搜索信息，获取最新数据',
    params: [
      { name: 'query', type: 'string', required: true, description: '搜索关键词' },
    ],
    examples: [
      'React 18 新特性',
      'TypeScript 最佳实践',
    ],
  },
  {
    name: 'NotebookEdit',
    icon: 'BookOpen',
    description: '编辑 Jupyter 笔记本的单元格内容',
    params: [
      { name: 'notebook_path', type: 'string', required: true, description: '笔记本文件路径' },
      { name: 'cell_number', type: 'number', required: true, description: '单元格索引（从 0 开始）' },
      { name: 'new_source', type: 'string', required: true, description: '新的单元格内容' },
    ],
    examples: [
      '修改代码单元格',
      '添加 markdown 说明',
    ],
  },
]
