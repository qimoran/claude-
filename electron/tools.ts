import path from 'node:path'
import { spawn, ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import type { ToolInput, FileSnapshot } from './types'

// ── 危险命令判断 ────────────────────────────────────────
const SAFE_TOOLS = new Set(['read_file', 'list_dir', 'search_files'])

const DANGEROUS_CMD_PATTERNS = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive).*\//i,
  /\brm\s+-rf\s+\//i,
  /\bformat\b/i,
  /\bdel\s+\/s\s+\/q/i,
  /\brd\s+\/s\s+\/q/i,
  /\brmdir\s+\/s\s+\/q/i,
  /\bmkfs\b/i,
  /\bdd\s+.*of=\/dev\//i,
  /:(){ :|:& };:/,
  /\bchmod\s+-R\s+777\s+\//i,
  /\bchown\s+-R\s+.*\s+\//i,
  /\|\s*rm\b/i,
]

export function isDangerousCommand(cmd: string): boolean {
  return DANGEROUS_CMD_PATTERNS.some(p => p.test(cmd))
}

export function isToolSafe(toolName: string, input: ToolInput): boolean {
  if (SAFE_TOOLS.has(toolName)) return true
  if (toolName === 'bash' && input.command && isDangerousCommand(input.command)) return false
  return false
}

// ── 工具定义（Anthropic 格式）──────────────────────────
export const TOOLS_ANTHROPIC = [
  {
    name: 'bash',
    description: '在工作目录执行 shell 命令。用于运行脚本、安装依赖、编译、测试、git 操作等。',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: '读取指定文件的内容。路径相对于工作目录或绝对路径。',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: '文件路径' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'write_file',
    description: '将内容写入指定文件。会创建不存在的目录。路径相对于工作目录或绝对路径。',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '要写入的完整文件内容' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: '对文件进行精确的字符串替换。用 old_string 定位要替换的内容，用 new_string 替换它。',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: '文件路径' },
        old_string: { type: 'string', description: '要被替换的原始字符串（必须精确匹配）' },
        new_string: { type: 'string', description: '替换后的新字符串' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_dir',
    description: '列出目录内容，递归显示文件树。路径相对于工作目录或绝对路径。',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: '目录路径，默认为工作目录根' },
      },
      required: [],
    },
  },
  {
    name: 'search_files',
    description: '在工作目录中搜索包含指定模式的文件。返回匹配的文件名和行号。',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: '搜索的正则表达式或字符串' },
        path: { type: 'string', description: '搜索的目录路径，默认为工作目录' },
      },
      required: ['pattern'],
    },
  },
]

// ── 工具定义（OpenAI 格式）──────────────────────────────
export function convertToolsToOpenAI() {
  return TOOLS_ANTHROPIC.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

// ── Claude Code 系统提示词 ───────────────────────────────
const CLAUDE_CODE_PROMPT = `You are Claude, an interactive AI coding assistant created by Anthropic. You are pair-programming with a USER on their codebase. You run inside their development environment.

# TOOL USE GUIDELINES

1. **Think step-by-step** before using tools. Consider what information you need and which tool is most appropriate.
2. **Batch tool calls** when possible. If you need multiple independent pieces of information, request them all at once.
3. **Verify before modifying.** Always read a file before editing it to ensure you have the most current content and context.
4. **Use targeted edits.** Prefer edit_file (find-and-replace) over write_file (full overwrite) for existing files.
5. **Handle errors gracefully.** If a tool call fails, analyze the error and retry with corrected parameters.

# CODE CHANGE GUIDELINES

1. **Minimal changes.** Make the smallest possible change that correctly addresses the task. Do not refactor unrelated code.
2. **Preserve style.** Match the existing code style, including indentation, naming conventions, and patterns.
3. **Maintain imports.** Add any necessary imports, and remove unused ones only if they were made unused by your changes.
4. **No placeholders.** Never leave TODO comments, placeholder text, or incomplete implementations. Every change should be production-ready.
5. **Test awareness.** If the codebase has tests, consider whether your changes need new tests or updates to existing tests.
6. **Atomic edits.** Each edit should leave the code in a working state. Don't make partial changes that would break the build.

# COMMUNICATION GUIDELINES

1. Be concise and direct. Avoid unnecessary preamble.
2. When explaining changes, focus on the "why" not just the "what."
3. If uncertain about the user's intent, ask for clarification before making changes.
4. After making changes, briefly summarize what was done.
5. If a task is complex, outline your plan before starting.

# SEARCH AND EXPLORATION

1. Start with broad searches to understand the structure.
2. Read relevant files to understand context before making changes.
3. Use search_files to find specific patterns, function definitions, or usages.
4. Use list_dir to understand project structure.

# ERROR HANDLING

1. If an edit fails because old_string wasn't found, re-read the file and retry with the correct content.
2. If a command fails, analyze the error output and try an alternative approach.
3. If you're stuck, explain what you've tried and ask the user for guidance.

# SAFETY

1. Never execute commands that could cause data loss without user confirmation.
2. Be cautious with commands that modify system state (installing packages, changing configs).
3. Always validate file paths are within the project directory.
4. Don't expose sensitive information like API keys or passwords.`

// ── System prompt ───────────────────────────────────────
export function buildSystemPrompt(cwd: string, customSystemPrompt?: string, useClaudeCodePrompt?: boolean): string {
  const osType = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
  const arch = process.arch
  const shell = process.platform === 'win32' ? 'PowerShell / cmd' : 'bash / zsh'

  const basePrompt = useClaudeCodePrompt
    ? `${CLAUDE_CODE_PROMPT}

# ENVIRONMENT

操作系统: ${osType} (${arch})
Shell: ${shell}
当前工作目录: ${cwd}

你可以使用以下工具来完成任务：
- bash: 执行 shell 命令（安装依赖、编译、运行测试、git 操作等）
- read_file: 读取文件内容
- write_file: 创建或覆盖文件
- edit_file: 精确替换文件中的字符串片段
- list_dir: 列出目录结构
- search_files: 在文件中搜索内容`
    : `你是一个强大的编程助手，类似于 Claude Code。你在用户的项目目录中工作。

操作系统: ${osType} (${arch})
Shell: ${shell}
当前工作目录: ${cwd}

你可以使用以下工具来完成任务：
- bash: 执行 shell 命令（安装依赖、编译、运行测试、git 操作等）
- read_file: 读取文件内容
- write_file: 创建或覆盖文件
- edit_file: 精确替换文件中的字符串片段
- list_dir: 列出目录结构
- search_files: 在文件中搜索内容

重要规则：
1. 在修改文件之前，**必须**先用 read_file 读取它的当前内容，确保你掌握最新版本
2. 优先使用 edit_file 进行精确修改，而不是用 write_file 覆盖整个文件
3. 所有相对路径都基于工作目录: ${cwd}
4. 执行命令前考虑安全性，不要执行危险的命令
5. 分步骤完成复杂任务，每步都向用户说明你在做什么
6. 如果 edit_file 返回错误（找不到 old_string），说明文件内容已变化。此时必须重新 read_file 获取最新内容，然后用正确的 old_string 重试
7. 使用与当前操作系统兼容的命令（当前为 ${osType}，请使用 ${shell} 语法）
8. 每次对话回合中如果需要对同一个文件做多次修改，每次 edit_file 的 old_string 必须基于上一次修改后的结果，不能基于最初读取的内容`

  return basePrompt + (customSystemPrompt ? `\n\n用户自定义指令：\n${customSystemPrompt}` : '')
}

// ── 路径解析与安全校验 ────────────────────────────────────
export function resolvePath(filePath: string, cwd: string): string {
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd, filePath)
  const normalizedCwd = path.resolve(cwd)
  if (!resolved.startsWith(normalizedCwd + path.sep) && resolved !== normalizedCwd) {
    throw new Error(`路径越界: ${filePath} 解析为 ${resolved}，不在工作目录 ${normalizedCwd} 内`)
  }
  return resolved
}

// ── Bash 命令执行前：检测破坏性操作并保存文件快照 ────────
export function snapshotBashTargets(
  cmd: string,
  cwd: string,
  snapshotCtx: { sessionId: string; turnNumber: number; toolId: string },
  saveSnapshotFn: (sessionId: string, snapshot: FileSnapshot) => void,
) {
  // 将命令按 && || ; 拆分为子命令
  const subCmds = cmd.split(/\s*(?:&&|\|\||;)\s*/)
  const snapshotted = new Set<string>()

  const tokenizeShellArgs = (raw: string): string[] => {
    const result: string[] = []
    let current = ''
    let quote: 'single' | 'double' | null = null

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (quote === 'single') {
        if (ch === '\'') quote = null
        else current += ch
        continue
      }
      if (quote === 'double') {
        if (ch === '"') quote = null
        else current += ch
        continue
      }

      if (ch === '\'') {
        quote = 'single'
        continue
      }
      if (ch === '"') {
        quote = 'double'
        continue
      }

      if (/\s/.test(ch)) {
        if (current) {
          result.push(current)
          current = ''
        }
        continue
      }

      current += ch
    }

    if (current) result.push(current)
    return result
  }

  const stripOuterQuotes = (v: string) => v.replace(/^['"]|['"]$/g, '')

  const expandWildcardTargets = (resolved: string): string[] => {
    const dir = path.dirname(resolved)
    const pattern = path.basename(resolved)
    if (!fs.existsSync(dir)) return []
    const regex = new RegExp(
      '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
      'i',
    )
    const matches: string[] = []
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      if (!regex.test(entry)) continue
      try {
        if (fs.statSync(fullPath).isFile()) matches.push(fullPath)
      } catch {
        // ignore
      }
    }
    return matches
  }

  const snapshotOnePath = (resolved: string) => {
    if (snapshotted.has(resolved)) return
    if (!fs.existsSync(resolved)) return

    snapshotted.add(resolved)
    const stat = fs.statSync(resolved)
    if (stat.isFile()) {
      try {
        const content = fs.readFileSync(resolved, 'utf-8')
        saveSnapshotFn(snapshotCtx.sessionId, {
          filePath: resolved,
          existed: true,
          content,
          toolName: 'bash',
          toolId: snapshotCtx.toolId,
          turnNumber: snapshotCtx.turnNumber,
        })
      } catch {
        // 二进制文件等，跳过
      }
      return
    }

    if (stat.isDirectory()) {
      const snapshotDir = (dir: string, depth: number) => {
        if (depth > 3 || snapshotted.size > 200) return
        try {
          const entries = fs.readdirSync(dir)
          for (const entry of entries) {
            const fullPath = path.join(dir, entry)
            if (snapshotted.has(fullPath)) continue
            try {
              const s = fs.statSync(fullPath)
              if (s.isFile()) {
                snapshotted.add(fullPath)
                const content = fs.readFileSync(fullPath, 'utf-8')
                saveSnapshotFn(snapshotCtx.sessionId, {
                  filePath: fullPath,
                  existed: true,
                  content,
                  toolName: 'bash',
                  toolId: snapshotCtx.toolId,
                  turnNumber: snapshotCtx.turnNumber,
                })
              } else if (s.isDirectory()) {
                snapshotDir(fullPath, depth + 1)
              }
            } catch {
              // skip
            }
          }
        } catch {
          // skip
        }
      }
      snapshotDir(resolved, 0)
    }
  }

  for (const sub of subCmds) {
    const trimmed = sub.trim()
    if (!trimmed) continue

    const parsed = tokenizeShellArgs(trimmed)
    if (parsed.length === 0) continue
    const cmdName = parsed[0].toLowerCase()
    const targets: string[] = []

    if (cmdName === 'del') {
      targets.push(...parsed.slice(1).filter(a => !a.startsWith('/')).map(stripOuterQuotes))
    }

    if (cmdName === 'rm') {
      targets.push(...parsed.slice(1).filter(a => !a.startsWith('-')).map(stripOuterQuotes))
    }

    if (cmdName === 'move' || cmdName === 'mv') {
      const args = parsed.slice(1).filter(a => !a.startsWith('-') && !(cmdName === 'move' && a.startsWith('/')))
      if (args.length >= 2) {
        const src = stripOuterQuotes(args[0])
        const dest = stripOuterQuotes(args[1])
        targets.push(src)
        targets.push(dest)
      } else if (args.length === 1) {
        targets.push(stripOuterQuotes(args[0]))
      } else {
        console.warn(`[snapshotBashTargets] 无法解析 move/mv 目标: ${trimmed}`)
      }
    }

    if (cmdName === 'ren' || cmdName === 'rename') {
      const args = parsed.slice(1).map(stripOuterQuotes)
      if (args.length >= 1) {
        targets.push(args[0])
      } else {
        console.warn(`[snapshotBashTargets] 无法解析 ren/rename 目标: ${trimmed}`)
      }
    }

    // 覆盖型重定向：> file, 1> file, 2> file, >& file（排除 >>）
    const redirectMatches = Array.from(trimmed.matchAll(/(?:^|\s)(?:\d?>|>&)\s*(?!>)("[^"]+"|'[^']+'|[^\s|&>]+)/g))
    for (const m of redirectMatches) {
      const target = stripOuterQuotes((m[1] || '').trim())
      if (target) targets.push(target)
    }

    for (const target of targets) {
      if (!target) continue
      try {
        const resolved = path.isAbsolute(target) ? target : path.resolve(cwd, target)
        if (target.includes('*') || target.includes('?')) {
          for (const wildcardMatched of expandWildcardTargets(resolved)) {
            snapshotOnePath(wildcardMatched)
          }
        } else {
          snapshotOnePath(resolved)
        }
      } catch {
        console.warn(`[snapshotBashTargets] 跳过无法解析的路径: ${target}`)
      }
    }
  }
}

// ── 工具执行 ────────────────────────────────────────────
export async function executeTool(
  toolName: string,
  input: ToolInput,
  cwd: string,
  abortCtrl?: { aborted: boolean },
  snapshotCtx?: { sessionId: string; turnNumber: number; toolId: string },
  saveSnapshotFn?: (sessionId: string, snapshot: FileSnapshot) => void,
): Promise<string> {
  switch (toolName) {
    case 'bash': {
      return new Promise<string>((resolve) => {
        const cmd = input.command || ''
        // 执行前：检测破坏性命令并保存目标文件快照
        if (snapshotCtx && saveSnapshotFn) {
          try { snapshotBashTargets(cmd, cwd, snapshotCtx, saveSnapshotFn) } catch { /* 快照失败不影响执行 */ }
        }
        const child: ChildProcess = spawn(cmd, [], {
          shell: true,
          cwd,
          env: { ...process.env },
          timeout: 60000,
        })

        let stdout = ''
        let stderr = ''
        let killed = false

        const abortCheck = setInterval(() => {
          if (abortCtrl?.aborted && !killed) {
            killed = true
            child.kill('SIGTERM')
            setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 3000)
            clearInterval(abortCheck)
          }
        }, 200)

        child.stdout?.on('data', (d) => { stdout += d.toString() })
        child.stderr?.on('data', (d) => { stderr += d.toString() })

        child.on('close', (code) => {
          clearInterval(abortCheck)
          let result = ''
          if (killed) result += '[user aborted]\n'
          if (stdout) result += stdout
          if (stderr) result += (result ? '\n' : '') + `[stderr] ${stderr}`
          result += `\n[exit code: ${code}]`
          if (result.length > 20000) {
            result = result.slice(0, 20000) + '\n... (output truncated)'
          }
          resolve(result)
        })

        child.on('error', (err) => {
          clearInterval(abortCheck)
          resolve(`[error] ${err.message}`)
        })
      })
    }

    case 'read_file': {
      try {
        const fullPath = resolvePath(input.file_path || '', cwd)
        if (!fs.existsSync(fullPath)) {
          return `[error] 文件不存在: ${fullPath}`
        }
        const content = fs.readFileSync(fullPath, 'utf-8')
        if (content.length > 100000) {
          return content.slice(0, 100000) + '\n... (file truncated, too large)'
        }
        return content
      } catch (err) {
        return `[error] ${(err as Error).message}`
      }
    }

    case 'write_file': {
      try {
        const fullPath = resolvePath(input.file_path || '', cwd)
        let oldContent: string | null = null
        const existed = fs.existsSync(fullPath)
        if (existed) {
          try { oldContent = fs.readFileSync(fullPath, 'utf-8') } catch { /* ignore */ }
        }
        if (snapshotCtx && saveSnapshotFn) {
          saveSnapshotFn(snapshotCtx.sessionId, {
            filePath: fullPath,
            existed,
            content: oldContent,
            toolName,
            toolId: snapshotCtx.toolId,
            turnNumber: snapshotCtx.turnNumber,
          })
        }
        const dir = path.dirname(fullPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(fullPath, input.content || '', 'utf-8')
        const result = `文件已写入: ${fullPath}`
        if (oldContent !== null && oldContent !== (input.content || '')) {
          return `${result}\n[DIFF_OLD]\n${oldContent}\n[/DIFF_OLD]`
        }
        return result
      } catch (err) {
        return `[error] ${(err as Error).message}`
      }
    }

    case 'edit_file': {
      try {
        const fullPath = resolvePath(input.file_path || '', cwd)
        if (!fs.existsSync(fullPath)) {
          return `[error] 文件不存在: ${fullPath}`
        }
        const content = fs.readFileSync(fullPath, 'utf-8')
        let oldStr = input.old_string || ''
        const newStr = input.new_string || ''

        let workingContent = content
        let usedNormalized = false

        if (!workingContent.includes(oldStr)) {
          const contentLF = content.replace(/\r\n/g, '\n')
          const oldStrLF = oldStr.replace(/\r\n/g, '\n')
          if (contentLF.includes(oldStrLF)) {
            workingContent = contentLF
            oldStr = oldStrLF
            usedNormalized = true
          } else {
            const contentTrimmed = content.split('\n').map(l => l.trimEnd()).join('\n')
            const oldStrTrimmed = oldStr.split('\n').map(l => l.trimEnd()).join('\n')
            if (contentTrimmed.includes(oldStrTrimmed)) {
              workingContent = contentTrimmed
              oldStr = oldStrTrimmed
              usedNormalized = true
            }
          }
        }

        if (!workingContent.includes(oldStr)) {
          const preview = content.length > 4000
            ? content.slice(0, 4000) + '\n... (文件过长，仅显示前 4000 字符)'
            : content
          return `[error] 在文件中找不到要替换的字符串（old_string 与当前文件内容不匹配）。\n请先用 read_file 读取该文件的最新内容，然后根据实际内容重新构造 old_string。\n\n当前文件内容如下（供参考）:\n\`\`\`\n${preview}\n\`\`\``
        }

        if (snapshotCtx && saveSnapshotFn) {
          saveSnapshotFn(snapshotCtx.sessionId, {
            filePath: fullPath,
            existed: true,
            content,
            toolName,
            toolId: snapshotCtx.toolId,
            turnNumber: snapshotCtx.turnNumber,
          })
        }

        const matchCount = workingContent.split(oldStr).length - 1
        let updated: string

        if (input.replace_all) {
          updated = workingContent.split(oldStr).join(newStr)
        } else {
          updated = workingContent.replace(oldStr, newStr)
        }

        if (usedNormalized && content.includes('\r\n') && !updated.includes('\r\n')) {
          updated = updated.replace(/\n/g, '\r\n')
        }

        fs.writeFileSync(fullPath, updated, 'utf-8')

        if (input.replace_all) {
          return `文件已修改: ${fullPath} (替换了 ${matchCount} 处)${usedNormalized ? ' [自动处理了换行符差异]' : ''}`
        }
        if (matchCount > 1) {
          return `文件已修改: ${fullPath} (注意: 找到 ${matchCount} 处匹配，仅替换了第 1 处。如需全部替换，请设置 replace_all: true)${usedNormalized ? ' [自动处理了换行符差异]' : ''}`
        }
        return `文件已修改: ${fullPath}${usedNormalized ? ' [自动处理了换行符差异]' : ''}`
      } catch (err) {
        return `[error] ${(err as Error).message}`
      }
    }

    case 'list_dir': {
      try {
        const targetPath = resolvePath(input.path || '.', cwd)
        if (!fs.existsSync(targetPath)) {
          return `[error] 目录不存在: ${targetPath}`
        }

        const result: string[] = []
        const walk = (dir: string, prefix: string, depth: number) => {
          if (depth > 3 || result.length > 500) return
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          const filtered = entries.filter((e) =>
            !['node_modules', '.git', 'dist', '__pycache__', '.next', '.nuxt', 'vendor', '.venv', 'venv'].includes(e.name)
          )
          for (const entry of filtered) {
            if (result.length > 500) {
              result.push('... (tree truncated)')
              return
            }
            const isDir = entry.isDirectory()
            result.push(`${prefix}${isDir ? '\u{1F4C1} ' : '  '}${entry.name}`)
            if (isDir) {
              walk(path.join(dir, entry.name), prefix + '  ', depth + 1)
            }
          }
        }
        walk(targetPath, '', 0)
        return result.join('\n') || '(empty directory)'
      } catch (err) {
        return `[error] ${(err as Error).message}`
      }
    }

    case 'search_files': {
      return new Promise<string>((resolve) => {
        const searchPath = resolvePath(input.path || '.', cwd)
        const pattern = input.pattern || ''

        const isWin = process.platform === 'win32'
        let child: ChildProcess
        if (isWin) {
          child = spawn('findstr', ['/s', '/n', '/r', `/c:${pattern}`, `${searchPath}\\*`], {
            cwd,
            timeout: 15000,
            windowsVerbatimArguments: true,
          })
        } else {
          child = spawn('grep', ['-rn', '--include=*', pattern, searchPath], {
            cwd,
            timeout: 15000,
          })
        }

        let output = ''
        child.stdout?.on('data', (d) => { output += d.toString() })
        child.stderr?.on('data', (d) => { output += d.toString() })

        child.on('close', () => {
          if (!output.trim()) {
            resolve('没有找到匹配的结果')
          } else if (output.length > 20000) {
            resolve(output.slice(0, 20000) + '\n... (results truncated)')
          } else {
            resolve(output)
          }
        })

        child.on('error', (err) => {
          resolve(`[error] ${err.message}`)
        })
      })
    }

    default:
      return `[error] 未知工具: ${toolName}`
  }
}
