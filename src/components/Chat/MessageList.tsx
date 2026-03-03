import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { diffLines } from 'diff'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Highlight, themes } from 'prism-react-renderer'
import {
  User, Bot, Terminal, FileText, FolderTree, Search, Pencil, FilePlus2,
  ChevronDown, ChevronRight, Copy, Check, Loader2, AlertCircle, RotateCcw, PenLine, Undo2,
} from 'lucide-react'
import type { ContentBlock, Message, ToolCallBlock, ToolResultBlock, ToolConfirmBlock } from '../../hooks/useClaudeCode'
import { useAppSettings } from '../../hooks/useAppSettings'

interface MessageListProps {
  messages: Message[]
  isLoading: boolean
  streamBlocks: ContentBlock[]
  confirmTool: (confirmId: string, approved: boolean, trustSession?: boolean) => void
  editMessage?: (messageId: string, newContent: string) => Promise<void>
  regenerateMessage?: (messageId: string) => Promise<void>
  rollbackToMessage?: (messageId: string) => Promise<void>
  isRollbacking?: boolean
  searchQuery?: string
  sessionId?: string
  isActive?: boolean
}

// ── 搜索高亮组件 ────────────────────────────────────
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-yellow-400/40 text-yellow-200 rounded px-0.5">{part}</mark>
          : part
      )}
    </>
  )
}

// ── 代码块（带复制按钮 + 语法高亮）──────────────────────
function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { settings } = useAppSettings()
  const isLight = settings.chatTheme === 'light'
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (language) {
    return (
      <div className="relative group">
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 p-1.5 rounded bg-[var(--c-hover-overlay)] hover:bg-[var(--c-white-alpha-4)]
                     text-claude-text-muted hover:text-claude-text opacity-0 group-hover:opacity-100
                     transition-all z-10"
          title="复制代码"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <Highlight theme={isLight ? themes.oneLight : themes.vsDark} code={code} language={language}>
          {({ style, tokens, getLineProps, getTokenProps }) => (
            <pre style={{ ...style, backgroundColor: 'transparent' }} className={`rounded-md p-3 overflow-x-auto text-sm border border-claude-border bg-[var(--c-code-block-bg)] ${tokens.length > 15 ? 'max-h-[360px] overflow-y-auto' : ''}`}>
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })}>
                  <span className={`inline-block w-8 text-right mr-3 select-none text-xs ${isLight ? 'text-black/20' : 'text-white/20'}`}>
                    {i + 1}
                  </span>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      </div>
    )
  }

  // 无语言的代码块：简洁 pre + 复制按钮
  const lines = code.split('\n')
  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-[var(--c-hover-overlay)] hover:bg-[var(--c-white-alpha-4)]
                   text-claude-text-muted hover:text-claude-text opacity-0 group-hover:opacity-100
                   transition-all z-10"
        title="复制代码"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre className={`rounded-md p-3 overflow-x-auto text-sm bg-[var(--c-code-block-bg)] font-mono text-claude-text border border-claude-border ${lines.length > 15 ? 'max-h-[360px] overflow-y-auto' : ''}`}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

// ── Unified Diff 视图（使用 Myers diff 算法）─────────────
function DiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const changes = diffLines(oldStr, newStr)
  const diff: Array<{ type: 'same' | 'del' | 'add'; text: string }> = []
  for (const change of changes) {
    const lines = change.value.replace(/\n$/, '').split('\n')
    const type = change.removed ? 'del' : change.added ? 'add' : 'same'
    for (const line of lines) {
      diff.push({ type, text: line })
    }
  }

  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(newStr)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group rounded bg-claude-bg overflow-hidden">
      <button
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 p-1 rounded bg-[var(--c-hover-overlay)] hover:bg-[var(--c-white-alpha-4)]
                   text-claude-text-muted hover:text-claude-text opacity-0 group-hover:opacity-100
                   transition-all z-10"
        title="复制新内容"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <pre className="text-xs font-mono p-2 overflow-x-auto max-h-60 overflow-y-auto">
        {diff.map((line, i) => (
          <div
            key={i}
            className={`${line.type === 'del'
              ? 'bg-red-500/15 text-red-300'
              : line.type === 'add'
                ? 'bg-green-500/15 text-green-300'
                : 'text-claude-text-muted'
              }`}
          >
            <span className="inline-block w-5 text-right mr-2 select-none opacity-40">
              {line.type === 'del' ? '-' : line.type === 'add' ? '+' : ' '}
            </span>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  )
}

// ── 工具调用的图标和标签 ─────────────────────────────────
function getToolInfo(toolName: string) {
  switch (toolName) {
    case 'bash':
      return { icon: Terminal, label: '执行命令', color: 'text-[var(--c-tool-green)]' }
    case 'read_file':
      return { icon: FileText, label: '读取文件', color: 'text-[var(--c-primary)]' }
    case 'write_file':
      return { icon: FilePlus2, label: '写入文件', color: 'text-[var(--c-tool-yellow-text)]' }
    case 'edit_file':
      return { icon: Pencil, label: '编辑文件', color: 'text-[var(--c-tool-yellow-text)]' }
    case 'list_dir':
      return { icon: FolderTree, label: '列出目录', color: 'text-[var(--c-accent)]' }
    case 'search_files':
      return { icon: Search, label: '搜索文件', color: 'text-[var(--c-primary-light)]' }
    default:
      return { icon: Terminal, label: toolName, color: 'text-gray-400' }
  }
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'bash':
      return String(input.command || '')
    case 'read_file':
      return String(input.file_path || '')
    case 'write_file':
      return String(input.file_path || '')
    case 'edit_file':
      return String(input.file_path || '')
    case 'list_dir':
      return String(input.path || '.')
    case 'search_files':
      return String(input.pattern || '')
    default:
      return JSON.stringify(input, null, 2)
  }
}

// ── 工具调用块 ──────────────────────────────────────────
function ToolCallBlockUI({ block, result, isExecuting }: {
  block: ToolCallBlock
  result?: ToolResultBlock
  isExecuting: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const { icon: Icon, label, color } = getToolInfo(block.toolName)
  const summary = formatToolInput(block.toolName, block.input)

  return (
    <div className="my-2 rounded-lg border border-claude-border/50 overflow-hidden bg-claude-bg/80">
      {/* 标题栏 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--c-white-alpha-4)] transition-colors text-left"
      >
        {isExecuting ? (
          <Loader2 size={14} className="text-[var(--c-tool-yellow-text)] animate-spin flex-shrink-0" />
        ) : result?.isError ? (
          <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
        ) : result ? (
          <Check size={14} className="text-[var(--c-tool-green)] flex-shrink-0" />
        ) : (
          <Loader2 size={14} className="text-claude-text-muted animate-spin flex-shrink-0" />
        )}
        <Icon size={14} className={`${color} flex-shrink-0`} />
        <span className={`text-xs font-medium ${color}`}>{label}</span>
        <span className="text-xs text-claude-text-muted truncate flex-1 font-mono">{summary}</span>
        {expanded ? <ChevronDown size={14} className="text-claude-text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-claude-text-muted flex-shrink-0" />}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="border-t border-claude-border">
          {/* 输入参数 */}
          <div className="px-3 py-2">
            <p className="text-xs text-claude-text-muted mb-1 font-medium">输入</p>
            {block.toolName === 'bash' ? (
              <pre className="text-xs text-[var(--c-tool-green-text)] bg-claude-bg/60 rounded p-2 overflow-x-auto font-mono">
                $ {String(block.input.command || '')}
              </pre>
            ) : block.toolName === 'edit_file' ? (
              <div className="space-y-1">
                <p className="text-xs text-claude-text-muted font-mono">{String(block.input.file_path || '')}</p>
                <DiffView oldStr={String(block.input.old_string || '')} newStr={String(block.input.new_string || '')} />
              </div>
            ) : (
              <pre className="text-xs text-claude-text bg-claude-bg/60 rounded p-2 overflow-x-auto font-mono">
                {JSON.stringify(block.input, null, 2)}
              </pre>
            )}
          </div>

          {/* 输出结果 */}
          {result && (
            <div className="px-3 py-2 border-t border-claude-border/50">
              <p className="text-xs text-claude-text-muted mb-1 font-medium">
                {result.isError ? '错误' : '输出'}
              </p>
              {/* write_file diff 展示 */}
              {!result.isError && block.toolName === 'write_file' && result.output.includes('[DIFF_OLD]') ? (() => {
                const match = result.output.match(/\[DIFF_OLD\]\n([\s\S]*?)\n\[\/DIFF_OLD\]/)
                if (match) {
                  const oldContent = match[1]
                  const statusLine = result.output.split('\n')[0]
                  return (
                    <div className="space-y-1">
                      <p className="text-xs text-claude-text font-mono">{statusLine}</p>
                      <DiffView oldStr={oldContent} newStr={String(block.input.content || '')} />
                    </div>
                  )
                }
                return <pre className="text-xs text-claude-text bg-claude-bg/60 rounded p-2 overflow-x-auto font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">{result.output}</pre>
              })() : (
                <pre className={`text-xs rounded p-2 overflow-x-auto font-mono whitespace-pre-wrap max-h-60 overflow-y-auto ${result.isError ? 'text-red-300 bg-red-500/10' : 'text-claude-text bg-claude-bg/60'
                  }`}>
                  {result.output}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 轮次分隔符 ──────────────────────────────────────────
function RoundDivider({ round }: { round: number }) {
  return (
    <div className="flex items-center gap-2 my-3">
      <div className="flex-1 border-t border-claude-border/50" />
      <span className="text-xs text-claude-text-muted px-2">第 {round} 轮思考</span>
      <div className="flex-1 border-t border-claude-border/50" />
    </div>
  )
}

// ── 工具确认块 ──────────────────────────────────────────
function ToolConfirmBlockUI({ block, onConfirm }: {
  block: ToolConfirmBlock
  onConfirm: (confirmId: string, approved: boolean, trustSession?: boolean) => void
}) {
  const { icon: Icon, label, color } = getToolInfo(block.toolName)
  const summary = formatToolInput(block.toolName, block.input)

  return (
    <div className="my-2 rounded-lg border-2 border-[var(--c-tool-yellow-border)] overflow-hidden bg-[var(--c-tool-yellow-bg)]">
      <div className="px-3 py-2 flex items-center gap-2">
        <AlertCircle size={14} className="text-[var(--c-tool-yellow-text)] flex-shrink-0" />
        <Icon size={14} className={`${color} flex-shrink-0`} />
        <span className={`text-xs font-medium ${color}`}>{label}</span>
        <span className="text-xs text-[var(--c-tool-yellow-text)] font-medium">需要确认</span>
      </div>

      {/* 工具输入预览 */}
      <div className="px-3 pb-2">
        {block.toolName === 'bash' ? (
          <pre className="text-xs text-[var(--c-tool-green-text)] bg-claude-bg/60 rounded p-2 overflow-x-auto font-mono">
            $ {String(block.input.command || '')}
          </pre>
        ) : block.toolName === 'edit_file' ? (
          <div className="space-y-1">
            <p className="text-xs text-claude-text-muted font-mono">{String(block.input.file_path || '')}</p>
            <DiffView oldStr={String(block.input.old_string || '')} newStr={String(block.input.new_string || '')} />
          </div>
        ) : block.toolName === 'write_file' ? (
          <div className="space-y-1">
            <p className="text-xs text-claude-text-muted font-mono">{String(block.input.file_path || '')}</p>
            <pre className="text-xs text-claude-text bg-claude-bg/60 rounded p-2 overflow-x-auto font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
              {String(block.input.content || '').slice(0, 500)}{String(block.input.content || '').length > 500 ? '\n...(truncated)' : ''}
            </pre>
          </div>
        ) : (
          <pre className="text-xs text-claude-text bg-claude-bg/60 rounded p-2 overflow-x-auto font-mono">
            {summary}
          </pre>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="px-3 py-2 border-t border-[var(--c-confirm-divider)] flex items-center gap-2">
        {block.status === 'pending' ? (
          <>
            <button
              onClick={() => onConfirm(block.confirmId, true)}
              className="px-3 py-1 text-xs font-medium bg-green-600 hover:bg-green-500 text-white rounded transition-colors"
            >
              允许执行
            </button>
            <button
              onClick={() => onConfirm(block.confirmId, true, true)}
              className="px-3 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
              title="批准当前操作并自动批准本次对话后续所有操作"
            >
              全部允许
            </button>
            <button
              onClick={() => onConfirm(block.confirmId, false)}
              className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
            >
              拒绝
            </button>
          </>
        ) : block.status === 'approved' ? (
          <span className="flex items-center gap-1 text-xs text-[var(--c-tool-green)]">
            <Check size={12} /> 已允许
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle size={12} /> 已拒绝
          </span>
        )}
      </div>
    </div>
  )
}

// ── Markdown 渲染器 ─────────────────────────────────────
function normalizeHtmlImageTags(content: string): string {
  return content.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (_m, src: string) => {
    const safeSrc = (src || '').trim()
    if (!safeSrc) return ''
    return `![生成图片](${safeSrc})`
  })
}

function extractMarkdownImageUrls(content: string): string[] {
  const urls: string[] = []
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const url = (match[1] || '').trim()
    if (url) urls.push(url)
  }
  return urls
}

function extractRawImageUrls(content: string): string[] {
  const urls: string[] = []

  if (!content) return urls

  // 避免对超长文本做重型正则导致卡顿
  const MAX_SCAN_CHARS = 200_000
  const scanContent = content.length > MAX_SCAN_CHARS ? content.slice(0, MAX_SCAN_CHARS) : content

  const httpImageRegex = /https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^\s"'<>]*)?/gi
  let match: RegExpExecArray | null
  while ((match = httpImageRegex.exec(scanContent)) !== null) {
    const url = (match[0] || '').trim()
    if (url) urls.push(url)
  }

  if (scanContent.includes('data:image/')) {
    const dataImageRegex = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g
    while ((match = dataImageRegex.exec(scanContent)) !== null) {
      const url = (match[0] || '').trim()
      if (url) urls.push(url)
    }
  }

  return urls
}

function extractAndStripDataImageUrls(content: string): { text: string; urls: string[] } {
  if (!content || !content.includes('data:image/')) return { text: content, urls: [] }

  const urls: string[] = []
  const regex = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/g
  let text = content.replace(regex, (full) => {
    const normalized = full.replace(/[\r\n]/g, '').trim()
    if (normalized) urls.push(normalized)
    return ''
  })

  // 清理残余的 markdown 图片语法，如 ![image]() 或 ![alt]([生成图片])
  text = text.replace(/!\[[^\]]*\]\(\s*\)/g, '')
  // 清理残余的 <img> 标签（src 被清空后留下的空标签）
  text = text.replace(/<img\b[^>]*\bsrc=["']\s*["'][^>]*>/gi, '')

  return { text, urls }
}

function MarkdownContent({
  content,
  onPreviewImage,
  hiddenImageUrls,
}: {
  content: string
  onPreviewImage?: (url: string) => void
  hiddenImageUrls?: Set<string>
}) {
  const { normalizedContent, supplementalImageUrls, isLarge, hasStreamingBase64 } = useMemo(() => {
    // 快速 O(1) 检测：文本含 data:image/ 说明有 base64 图片数据
    // 此时完全跳过正则和 ReactMarkdown，仅提取 base64 之前的纯文本做轻量展示
    const hasBase64 = content.includes('data:image/')

    if (hasBase64) {
      // 找到 data:image/ 的位置，只取前面的纯文本部分（无需正则）
      const idx = content.indexOf('data:image/')
      // 往前找 markdown 图片语法起点 ![
      let textEnd = idx
      const before = content.slice(0, idx)
      const mdStart = before.lastIndexOf('![')
      if (mdStart >= 0 && mdStart > idx - 200) {
        textEnd = mdStart
      }
      const cleanText = content.slice(0, textEnd).trim()
      return {
        normalizedContent: cleanText,
        supplementalImageUrls: [] as string[],
        isLarge: true,
        hasStreamingBase64: true,
      }
    }

    const stripped = extractAndStripDataImageUrls(content)
    const normalized = normalizeHtmlImageTags(stripped.text)
    const markdownImageUrls = new Set(extractMarkdownImageUrls(normalized))
    const supplemental = [
      ...stripped.urls,
      ...extractRawImageUrls(stripped.text),
    ].filter((u) => !markdownImageUrls.has(u))

    // 避免超长内容触发 Markdown 解析卡顿
    const MAX_RENDER_CHARS = 80_000
    const tooLarge = normalized.length > MAX_RENDER_CHARS
    const shortened = tooLarge
      ? `${normalized.slice(0, MAX_RENDER_CHARS)}\n\n...[内容过长，已截断显示]`
      : normalized

    return {
      normalizedContent: shortened,
      supplementalImageUrls: Array.from(new Set(supplemental)),
      isLarge: tooLarge,
      hasStreamingBase64: false,
    }
  }, [content])

  const effectiveHiddenUrls = hiddenImageUrls || new Set<string>()
  const renderedUrls = new Set<string>()

  return (
    <div className="prose prose-invert prose-sm max-w-none">
      {!isLarge ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre({ children }) {
              // react-markdown v9 会用 <pre> 包裹代码块
              // CodeBlock 已经自带 <pre>，去掉外层避免嵌套
              return <div className="not-prose my-3">{children}</div>
            },
            code({ className, children, node, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              const code = String(children).replace(/\n$/, '')

              // 判断行内 vs 块级：有语言标识 → 块级；源码跨多行 → 块级
              const isInline = !match
                && node?.position
                && node.position.start.line === node.position.end.line

              if (isInline) {
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                )
              }

              // 块级代码（有或无语言）
              return <CodeBlock code={code} language={match?.[1]} />
            },
            a({ href, children, ...props }) {
              const url = href || ''
              const handleClick = (e: React.MouseEvent) => {
                e.preventDefault()
                if (/^https?:\/\//i.test(url)) {
                  window.electronAPI?.openExternal({ target: url })
                }
              }
              return (
                <a
                  href={url}
                  onClick={handleClick}
                  className="text-claude-primary hover:text-claude-primary-light underline cursor-pointer"
                  title={url}
                  {...props}
                >
                  {children}
                </a>
              )
            },
            img({ src, alt }) {
              const url = src || ''
              if (!url) return null
              if (effectiveHiddenUrls.has(url)) return null
              if (renderedUrls.has(url)) return null
              renderedUrls.add(url)
              return (
                <img
                  src={url}
                  alt={alt || '图片'}
                  className="max-h-96 max-w-full rounded border border-claude-border cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onPreviewImage?.(url)}
                  title="点击查看大图"
                />
              )
            },
          }}
        >
          {normalizedContent}
        </ReactMarkdown>
      ) : hasStreamingBase64 ? (
        <div className="text-sm text-claude-text-muted italic py-2">
          {normalizedContent && (
            <pre className="whitespace-pre-wrap break-words text-sm text-claude-text bg-claude-bg/40 rounded p-3 not-prose mb-2">
              {normalizedContent.slice(0, 2000)}
            </pre>
          )}
          <span className="inline-flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-claude-text-muted border-t-transparent animate-spin" />
            图片数据接收中...
          </span>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words text-sm text-claude-text bg-claude-bg/40 rounded p-3 not-prose">
          {normalizedContent}
        </pre>
      )}
      {supplementalImageUrls.length > 0 && (
        <div className="mt-2 space-y-2">
          {supplementalImageUrls.filter((u: string) => !effectiveHiddenUrls.has(u)).map((url: string, idx: number) => (
            <img
              key={`${url.slice(0, 64)}-${idx}`}
              src={url}
              alt={`生成图片 ${idx + 1}`}
              className="max-h-96 max-w-full rounded border border-claude-border cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => onPreviewImage?.(url)}
              title="点击查看大图"
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 渲染内容块列表 ──────────────────────────────────────
function renderBlocks(
  blocks: ContentBlock[],
  isLive: boolean,
  confirmTool?: (confirmId: string, approved: boolean, trustSession?: boolean) => void,
  onPreviewImage?: (url: string) => void,
) {
  const elements: JSX.Element[] = []
  // 预收集所有 image 块的 URL，传给 MarkdownContent 避免重复渲染
  const allImageBlockUrls = new Set<string>()
  for (const b of blocks) {
    if (b.type === 'image') allImageBlockUrls.add(b.url)
  }
  const renderedImageUrls = new Set<string>()

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]

    if (block.type === 'text') {
      elements.push(
        <MarkdownContent
          key={`text-${i}`}
          content={block.content}
          onPreviewImage={onPreviewImage}
          hiddenImageUrls={allImageBlockUrls}
        />
      )
    } else if (block.type === 'image') {
      if (renderedImageUrls.has(block.url)) continue
      renderedImageUrls.add(block.url)
      elements.push(
        <div key={`img-${i}`} className="my-2">
          <img
            src={block.url}
            alt={block.alt || '生成图片'}
            className="max-h-96 max-w-full rounded border border-claude-border cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => onPreviewImage?.(block.url)}
            title="点击查看大图"
          />
        </div>
      )
    } else if (block.type === 'tool_call') {
      // 找到对应的 tool_result
      const result = blocks.find(
        (b): b is ToolResultBlock =>
          b.type === 'tool_result' && b.toolId === block.toolId
      )
      const isExecuting = isLive && !result
      elements.push(
        <ToolCallBlockUI
          key={`tool-${block.toolId}`}
          block={block}
          result={result}
          isExecuting={isExecuting}
        />
      )
    } else if (block.type === 'tool_result') {
      // 已经在 tool_call 中处理，跳过
      continue
    } else if (block.type === 'round') {
      elements.push(
        <RoundDivider key={`round-${block.round}`} round={block.round} />
      )
    } else if (block.type === 'tool_confirm') {
      elements.push(
        <ToolConfirmBlockUI
          key={`confirm-${block.confirmId}`}
          block={block}
          onConfirm={confirmTool || (() => { })}
        />
      )
    }
  }

  return elements
}

// ── 单条消息组件（提取以支持虚拟化测量）─────────────────
function MessageItem({ message, isLoading, confirmTool, editMessage, regenerateMessage, rollbackToMessage, isRollbacking, searchQuery, setPreviewImage }: {
  message: Message
  isLoading: boolean
  confirmTool?: (confirmId: string, approved: boolean, trustSession?: boolean) => void
  editMessage?: (messageId: string, newContent: string) => void
  regenerateMessage?: (messageId: string) => void
  rollbackToMessage?: (messageId: string) => void
  isRollbacking?: boolean
  searchQuery?: string
  setPreviewImage: (url: string | null) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const isUser = message.role === 'user'
  const hasTools = message.blocks.some(b => b.type === 'tool_call' || b.type === 'tool_confirm')
  const isStreaming = isLoading && !isUser && message.blocks.length === 0 && message.content === ''

  return (
    <div className={`group relative ${hasTools ? 'pb-2' : ''} hover:bg-[var(--c-hover-row)] transition-colors`}>
      <div className="w-full px-5 py-4 flex gap-3">
        <div className="flex-shrink-0 pt-0.5">
          {isUser ? (
            <div className="w-7 h-7 rounded-md bg-claude-surface-light flex items-center justify-center text-claude-text-muted mt-0.5">
              <User size={15} />
            </div>
          ) : (
            <div className="w-7 h-7 rounded-md bg-claude-primary/15 flex items-center justify-center text-claude-primary mt-0.5">
              <Bot size={15} />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 pr-6 mt-[2px]">
          <div className="flex items-center justify-between mb-1.5 min-h-[22px]">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-claude-text">{isUser ? '你' : 'AI 助手'}</span>
              {!isUser && isStreaming && (
                <div className="flex items-center gap-1 text-[11px] text-claude-text-muted">
                  <div className="flex gap-0.5 items-center">
                    <span className="w-1.5 h-1.5 bg-claude-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-claude-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-claude-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="text-claude-text text-[14px] leading-relaxed break-words">
            {editingId === message.id ? (
              <div className="space-y-2 mt-2 w-full">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full bg-claude-bg border border-claude-border rounded p-2 text-sm text-claude-text resize-none focus:border-claude-primary focus:outline-none transition-colors"
                  rows={4}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { editMessage?.(message.id, editText); setEditingId(null) }}
                    className="px-3 py-1.5 text-xs bg-claude-primary hover:bg-claude-primary-light text-white rounded transition-colors"
                  >
                    保存并提交
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 text-xs bg-claude-surface-light hover:bg-claude-border text-claude-text rounded transition-colors border border-claude-border"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : !isUser ? (
              <div className="mt-1">
                {message.blocks.length > 0
                  ? renderBlocks(message.blocks, false, confirmTool, setPreviewImage)
                  : <MarkdownContent content={message.content} onPreviewImage={setPreviewImage} />}
              </div>
            ) : (
              <div className="mt-1">
                {message.images && message.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {message.images.map((img, imgIdx) => (
                      <img
                        key={imgIdx}
                        src={`data:${img.mediaType};base64,${img.base64}`}
                        alt={`附件图片 ${imgIdx + 1}`}
                        className="max-h-48 max-w-full rounded border border-claude-border/30 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => setPreviewImage(`data:${img.mediaType};base64,${img.base64}`)}
                        title="点击查看大图"
                      />
                    ))}
                  </div>
                )}
                <div className="whitespace-pre-wrap">
                  {searchQuery ? <HighlightText text={message.content} query={searchQuery} /> : message.content}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 悬浮操作栏 */}
        <div className="absolute top-4 right-10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 bg-claude-surface/80 backdrop-blur-md rounded-md border border-claude-border/30 shadow-lg px-1.5 py-1 z-10">
          {isUser && editMessage && (
            <button
              onClick={() => { setEditingId(message.id); setEditText(message.content) }}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light transition-colors"
            >
              <PenLine size={12} /> 编辑
            </button>
          )}
          {!isUser && regenerateMessage && (
            <button
              onClick={() => regenerateMessage(message.id)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light transition-colors"
            >
              <RotateCcw size={12} /> 重新生成
            </button>
          )}
          {rollbackToMessage && (
            <button
              onClick={() => rollbackToMessage(message.id)}
              disabled={isRollbacking}
              title={isRollbacking ? '回滚处理中' : (isUser ? '回滚到该用户消息之前' : '回滚到该轮助手回复结束')}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-claude-text-muted hover:text-orange-400 rounded hover:bg-orange-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Undo2 size={12} /> {isRollbacking ? '回滚中...' : (isUser ? '回滚到此消息前' : '回滚到本轮结束')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 虚拟滚动阈值：少于此数量时不启用虚拟化 ──
const VIRTUAL_THRESHOLD = 30

// ── 主组件 ──────────────────────────────────────────────
export default function MessageList({ messages, isLoading, streamBlocks, confirmTool, editMessage, regenerateMessage, rollbackToMessage, isRollbacking, searchQuery, sessionId, isActive = true }: MessageListProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const { settings } = useAppSettings()
  const fontVars = {
    '--fs-chat': `${settings.fontSizeChat}px`,
    '--fs-code': `${settings.fontSizeCode}px`,
    '--fs-ui': `${settings.fontSizeUI}px`,
  } as React.CSSProperties

  const useVirtual = messages.length >= VIRTUAL_THRESHOLD

  // 虚拟化列表（仅在消息数量超过阈值时启用）
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 120,
    overscan: 5,
    enabled: useVirtual,
  })

  // ── 智能自动滚动：仅在用户已处于底部附近时才自动滚动 ──
  const isNearBottomRef = useRef(true)
  const prevMsgCountRef = useRef(messages.length)
  const prevSessionIdRef = useRef(sessionId)

  // 判断是否在底部附近（100px 阈值）
  const checkNearBottom = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }, [])

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [])

  // 会话切换时：重置滚动状态，滚到底部
  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId
      isNearBottomRef.current = true
      requestAnimationFrame(() => {
        if (useVirtual) {
          virtualizer.measure()
        }
        scrollToBottom()
      })
    }
  }, [sessionId, scrollToBottom, useVirtual, virtualizer])

  // 监听用户滚动，更新 isNearBottom 状态
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => {
      isNearBottomRef.current = checkNearBottom()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [checkNearBottom])

  // 新消息到达时：仅在用户处于底部附近时自动滚动
  useEffect(() => {
    const msgCountChanged = messages.length !== prevMsgCountRef.current
    prevMsgCountRef.current = messages.length

    // 新消息（用户发送）：强制滚到底部
    if (msgCountChanged && messages.length > 0 && messages[messages.length - 1].role === 'user') {
      isNearBottomRef.current = true
      requestAnimationFrame(() => {
        if (useVirtual) {
          virtualizer.measure()
        }
        scrollToBottom()
      })
      return
    }

    // 流式更新 / 新 assistant 消息：仅在已处于底部时滚动
    if (isNearBottomRef.current) {
      requestAnimationFrame(() => {
        if (useVirtual) {
          virtualizer.measure()
        }
        scrollToBottom()
      })
    }
  }, [messages.length, streamBlocks, scrollToBottom, useVirtual, virtualizer])

  // 面板切换恢复：聊天面板重新显示时刷新虚拟列表测量并修正滚动
  const wasActiveRef = useRef(isActive)
  useEffect(() => {
    const becameActive = !wasActiveRef.current && isActive
    wasActiveRef.current = isActive

    if (!becameActive) return

    requestAnimationFrame(() => {
      if (useVirtual) {
        virtualizer.measure()
      }
      const el = scrollContainerRef.current
      if (!el) return
      if (isNearBottomRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })
  }, [isActive, useVirtual, virtualizer])

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-6 text-claude-text">
        <div className="w-16 h-16 rounded-xl bg-claude-surface border border-claude-border flex items-center justify-center mb-6">
          <Bot size={32} className="text-claude-primary" />
        </div>
        <h2 className="text-xl font-semibold mb-2 text-claude-text">
          开始与 AI 助手对话
        </h2>
        <p className="text-claude-text-muted text-sm mb-8">输入你的问题或任务，AI 会帮助你完成编码工作</p>

        <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
          <div className="p-4 rounded-lg bg-claude-surface border border-claude-border hover:border-claude-primary/40 transition-colors cursor-default">
            <div className="w-8 h-8 rounded bg-claude-surface-light flex items-center justify-center mb-3">
              <Terminal size={16} className="text-claude-text-muted" />
            </div>
            <p className="text-sm font-medium text-claude-text mb-1">执行命令</p>
            <p className="text-xs text-claude-text-dim">运行 shell 命令和脚本</p>
          </div>
          <div className="p-4 rounded-lg bg-claude-surface border border-claude-border hover:border-claude-primary/40 transition-colors cursor-default">
            <div className="w-8 h-8 rounded bg-claude-surface-light flex items-center justify-center mb-3">
              <Pencil size={16} className="text-claude-text-muted" />
            </div>
            <p className="text-sm font-medium text-claude-text mb-1">编辑文件</p>
            <p className="text-xs text-claude-text-dim">读取、创建和修改代码</p>
          </div>
          <div className="p-4 rounded-lg bg-claude-surface border border-claude-border hover:border-claude-primary/40 transition-colors cursor-default">
            <div className="w-8 h-8 rounded bg-claude-surface-light flex items-center justify-center mb-3">
              <Search size={16} className="text-claude-text-muted" />
            </div>
            <p className="text-sm font-medium text-claude-text mb-1">搜索代码</p>
            <p className="text-xs text-claude-text-dim">在项目中全局查找</p>
          </div>
          <div className="p-4 rounded-lg bg-claude-surface border border-claude-border hover:border-claude-primary/40 transition-colors cursor-default">
            <div className="w-8 h-8 rounded bg-claude-surface-light flex items-center justify-center mb-3">
              <FolderTree size={16} className="text-claude-text-muted" />
            </div>
            <p className="text-sm font-medium text-claude-text mb-1">浏览结构</p>
            <p className="text-xs text-claude-text-dim">探索工作区目录树</p>
          </div>
        </div>
      </div>
    )
  }

  // 流式内容区（共用）
  const streamContent = isLoading && (
    <div className="group relative transition-colors">
      <div className="w-full px-5 py-4 flex gap-3">
        <div className="flex-shrink-0 pt-0.5">
          <div className="w-7 h-7 rounded-md bg-claude-primary/15 flex items-center justify-center text-claude-primary mt-0.5">
            <Bot size={15} />
          </div>
        </div>
        <div className="flex-1 min-w-0 pr-6 mt-[2px]">
          <div className="flex items-center gap-2 mb-1.5 min-h-[22px]">
            <span className="text-[13px] font-medium text-claude-text">AI 助手</span>
          </div>
          <div className="mt-1">
            {streamBlocks.length > 0 ? (
              <>
                {renderBlocks(streamBlocks, true, confirmTool, setPreviewImage)}
                <div className="mt-2 flex items-center gap-2">
                  <Loader2 size={12} className="text-claude-primary animate-spin" />
                  <span className="text-xs text-claude-text-muted">思考中...</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 py-1">
                <Loader2 size={14} className="text-claude-primary animate-spin" />
                <span className="text-[13px] text-claude-text-muted">连接大模型中...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto px-0 py-0 msg-container bg-claude-bg" style={fontVars}>
      {useVirtual ? (
        // 虚拟滚动模式
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const message = messages[virtualItem.index]
            return (
              <div
                key={message.id}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }}
                className=""
              >
                <MessageItem
                  message={message}
                  isLoading={isLoading}
                  confirmTool={confirmTool}
                  editMessage={editMessage}
                  regenerateMessage={regenerateMessage}
                  rollbackToMessage={rollbackToMessage}
                  isRollbacking={isRollbacking}
                  searchQuery={searchQuery}
                  setPreviewImage={setPreviewImage}
                />
              </div>
            )
          })}
        </div>
      ) : (
        // 普通渲染模式（消息少时）
        <div className="flex flex-col pb-8">
          {messages.map((message) => (
            <div key={message.id} className="w-full">
              <MessageItem
                message={message}
                isLoading={isLoading}
                confirmTool={confirmTool}
                editMessage={editMessage}
                regenerateMessage={regenerateMessage}
                rollbackToMessage={rollbackToMessage}
                searchQuery={searchQuery}
                setPreviewImage={setPreviewImage}
              />
            </div>
          ))}
        </div>
      )}

      {streamContent}

      {/* 图片预览模态弹窗 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-pointer backdrop-blur-sm"
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="预览"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20
                     flex items-center justify-center text-white text-xl transition-colors backdrop-blur-md"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
