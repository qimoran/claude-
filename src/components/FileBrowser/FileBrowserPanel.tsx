import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Folder, FolderOpen, FileText, FileCode, ChevronRight, ChevronDown,
  RefreshCw, Copy, X, Search, AlertCircle, Eye, EyeOff, Loader2, Code2, BookOpen, Globe,
  Save, Pencil,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Highlight, themes as prismThemes } from 'prism-react-renderer'
import CodeMirror from '@uiw/react-codemirror'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { xml } from '@codemirror/lang-xml'
import { sql } from '@codemirror/lang-sql'
import { java } from '@codemirror/lang-java'
import { rust } from '@codemirror/lang-rust'
import { cpp } from '@codemirror/lang-cpp'
import { yaml } from '@codemirror/lang-yaml'
import { EditorView } from '@codemirror/view'
import { useAppSettings } from '../../hooks/useAppSettings'

// ── 类型 ──────────────────────────────────────────────
interface DirEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
  children?: DirEntry[] // undefined=有子项待加载, []=确认空
}

// ── 工具函数 ──────────────────────────────────────────
function getExt(name: string): string {
  return name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : ''
}

function getExtColor(name: string): string {
  switch (getExt(name)) {
    case '.ts': case '.tsx': return 'text-blue-400'
    case '.js': case '.jsx': return 'text-yellow-400'
    case '.css': case '.scss': case '.less': return 'text-purple-400'
    case '.html': case '.htm': return 'text-orange-400'
    case '.json': return 'text-green-400'
    case '.md': case '.mdx': return 'text-gray-400'
    case '.py': return 'text-cyan-400'
    case '.vue': return 'text-emerald-400'
    case '.svelte': return 'text-orange-300'
    case '.go': return 'text-sky-400'
    case '.rs': return 'text-amber-400'
    case '.java': return 'text-red-400'
    case '.yaml': case '.yml': case '.toml': return 'text-rose-300'
    default: return 'text-claude-text-muted'
  }
}

const EXT_LABELS: Record<string, string> = {
  '.ts': 'TS', '.tsx': 'TX', '.js': 'JS', '.jsx': 'JX', '.mjs': 'MJ', '.cjs': 'CJ',
  '.css': 'CS', '.scss': 'SC', '.less': 'LE',
  '.html': 'HT', '.htm': 'HT',
  '.json': 'JN', '.md': 'MD', '.mdx': 'MX',
  '.py': 'PY', '.go': 'GO', '.rs': 'RS', '.java': 'JA',
  '.vue': 'VU', '.svelte': 'SV',
  '.yaml': 'YM', '.yml': 'YM', '.toml': 'TM',
  '.env': 'EN', '.sh': 'SH', '.bat': 'BT', '.ps1': 'PS',
  '.sql': 'SQ', '.graphql': 'GQ', '.gql': 'GQ',
  '.xml': 'XM', '.svg': 'SG',
  '.txt': 'TX', '.log': 'LG', '.csv': 'CV',
  '.c': 'C', '.cpp': 'C+', '.h': 'H',
  '.rb': 'RB', '.php': 'PH', '.swift': 'SW', '.kt': 'KT',
}

function formatSize(bytes?: number): string {
  if (bytes == null || bytes === 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function getLangFromExt(name: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.json': 'json', '.css': 'css', '.html': 'html', '.md': 'markdown',
    '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.xml': 'xml',
    '.sh': 'bash', '.bat': 'batch', '.sql': 'sql', '.vue': 'vue',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
    '.scss': 'css', '.less': 'css',
    '.svelte': 'html', '.mdx': 'markdown',
  }
  return map[getExt(name)] || 'text'
}

// CodeMirror 语言扩展映射
function getCmLangExtension(langId: string) {
  switch (langId) {
    case 'typescript': return javascript({ typescript: true })
    case 'tsx': return javascript({ jsx: true, typescript: true })
    case 'javascript': return javascript()
    case 'jsx': return javascript({ jsx: true })
    case 'python': return python()
    case 'html': case 'vue': case 'svelte': return html()
    case 'css': return css()
    case 'json': return json()
    case 'markdown': return markdown()
    case 'xml': case 'toml': return xml()
    case 'sql': return sql()
    case 'java': return java()
    case 'rust': return rust()
    case 'c': case 'cpp': return cpp()
    case 'yaml': return yaml()
    case 'bash': case 'batch': return [] // 无专用扩展，用纯文本
    default: return []
  }
}

// ── 图标组件 ──────────────────────────────────────────
function FileIcon({ name, isDir, isOpen }: { name: string; isDir: boolean; isOpen?: boolean }) {
  if (isDir) {
    return isOpen
      ? <FolderOpen size={15} className="text-yellow-400 flex-shrink-0" />
      : <Folder size={15} className="text-yellow-400/70 flex-shrink-0" />
  }
  const ext = getExt(name)
  const label = EXT_LABELS[ext]
  if (label) {
    return (
      <span className={`text-[9px] font-bold w-4 h-4 flex items-center justify-center flex-shrink-0 leading-none ${getExtColor(name)}`}>
        {label}
      </span>
    )
  }
  return <FileText size={14} className="text-claude-text-muted flex-shrink-0" />
}

// ── 树节点（懒加载） ──────────────────────────────────
interface TreeNodeProps {
  entry: DirEntry
  depth: number
  selectedPath: string | null
  onFileClick: (entry: DirEntry) => void
  onLoadChildren: (dirPath: string) => Promise<DirEntry[]>
  searchQuery: string
}

function TreeNode({ entry, depth, selectedPath, onFileClick, onLoadChildren, searchQuery }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(
    entry.children === undefined ? null : (entry.children as DirEntry[])
  )
  const [childLoading, setChildLoading] = useState(false)

  // 搜索时自动展开匹配的目录
  useEffect(() => {
    if (searchQuery && entry.isDir && !expanded) {
      setExpanded(true)
    }
  }, [searchQuery, entry.isDir, expanded])

  // 文件节点 - 搜索不匹配时隐藏
  if (!entry.isDir) {
    if (searchQuery && !entry.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return null
    }
    const isSelected = selectedPath === entry.path
    return (
      <button
        onClick={() => onFileClick(entry)}
        className={`w-full flex items-center gap-1.5 py-[3px] px-2 transition-colors text-left group
          ${isSelected ? 'bg-claude-primary/15 text-claude-primary' : 'hover:bg-claude-surface-light text-claude-text'}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        title={entry.path}
      >
        <FileIcon name={entry.name} isDir={false} />
        <span className="text-xs truncate flex-1">{entry.name}</span>
        <span className="text-[10px] text-claude-text-muted opacity-0 group-hover:opacity-100 flex-shrink-0">
          {formatSize(entry.size)}
        </span>
      </button>
    )
  }

  // 目录节点
  const hasContent = children === null // null = 有子项未加载
  const handleToggle = async () => {
    if (!expanded && children === null) {
      setChildLoading(true)
      try {
        const loaded = await onLoadChildren(entry.path)
        setChildren(loaded)
      } catch {
        setChildren([])
      } finally {
        setChildLoading(false)
      }
    }
    setExpanded(!expanded)
  }

  // 搜索模式下没有匹配的子项 → 隐藏本目录
  // (但因为懒加载可能还没加载子项，所以搜索时总是显示目录)

  return (
    <div>
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-1 py-[3px] px-2 hover:bg-claude-surface-light transition-colors text-left"
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        {childLoading ? (
          <Loader2 size={13} className="text-claude-text-muted flex-shrink-0 animate-spin" />
        ) : hasContent || (children && children.length > 0) ? (
          expanded
            ? <ChevronDown size={13} className="text-claude-text-muted flex-shrink-0" />
            : <ChevronRight size={13} className="text-claude-text-muted flex-shrink-0" />
        ) : (
          <span className="w-[13px] flex-shrink-0" />
        )}
        <FileIcon name={entry.name} isDir isOpen={expanded} />
        <span className="text-xs text-claude-text truncate">{entry.name}</span>
      </button>
      {expanded && children && children.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onFileClick={onFileClick}
          onLoadChildren={onLoadChildren}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────
export default function FileBrowserPanel() {
  const { settings } = useAppSettings()
  // 监听会话级工作目录变化（由 ChatPanel 广播）
  const [sessionCwd, setSessionCwd] = useState<string>('')
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string
      setSessionCwd(detail || '')
    }
    window.addEventListener('app:cwd-change', handler)
    return () => window.removeEventListener('app:cwd-change', handler)
  }, [])
  // 会话级目录优先于全局
  const cwd = sessionCwd || settings.workingDirectory.trim()

  const [tree, setTree] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ dirs: 0, files: 0 })
  const [showHidden, setShowHidden] = useState(false)

  // 搜索
  const [searchQuery, setSearchQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // 文件预览
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; content: string } | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [previewMode, setPreviewMode] = useState<'source' | 'rendered'>('rendered')

  // 编辑模式
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // 加载根目录
  const loadRoot = useCallback(async () => {
    if (!cwd || !window.electronAPI?.listDirectory) {
      setTree([])
      setError(cwd ? 'electronAPI 不可用' : null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.listDirectory(cwd, undefined, showHidden)
      if (result.error) {
        setError(result.error)
        setTree([])
      } else {
        setTree(result.entries as DirEntry[])
        const dirs = result.entries.filter(e => e.isDir).length
        const files = result.entries.filter(e => !e.isDir).length
        setStats({ dirs, files })
      }
    } catch (err) {
      setError((err as Error).message)
      setTree([])
    } finally {
      setLoading(false)
    }
  }, [cwd, showHidden])

  useEffect(() => {
    loadRoot()
  }, [loadRoot])

  // 懒加载子目录
  const loadChildren = useCallback(async (dirPath: string): Promise<DirEntry[]> => {
    if (!cwd || !window.electronAPI?.listDirectory) return []
    try {
      const result = await window.electronAPI.listDirectory(cwd, dirPath, showHidden)
      if (result.error) return []
      return result.entries as DirEntry[]
    } catch {
      return []
    }
  }, [cwd, showHidden])

  // 文件点击预览
  const handleFileClick = useCallback(async (entry: DirEntry) => {
    if (!window.electronAPI?.readFileContent || !cwd) return
    setFileLoading(true)
    try {
      const result = await window.electronAPI.readFileContent(cwd, entry.path)
      if (result.error) {
        setSelectedFile({ path: entry.path, name: entry.name, content: `// ${result.error}` })
      } else {
        setSelectedFile({ path: entry.path, name: entry.name, content: result.content || '' })
      }
    } catch {
      setSelectedFile({ path: entry.path, name: entry.name, content: '// 读取失败' })
    } finally {
      setFileLoading(false)
    }
  }, [cwd])

  const handleCopy = useCallback(() => {
    if (!selectedFile) return
    navigator.clipboard.writeText(selectedFile.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [selectedFile])

  const isMarkdown = selectedFile ? ['.md', '.mdx'].includes(getExt(selectedFile.name)) : false
  const isHtml = selectedFile ? ['.html', '.htm'].includes(getExt(selectedFile.name)) : false

  // 自动切换：md/html 文件默认渲染，其他文件默认源码
  useEffect(() => {
    if (selectedFile) {
      const ext = getExt(selectedFile.name)
      const previewable = ['.md', '.mdx', '.html', '.htm'].includes(ext)
      setPreviewMode(previewable ? 'rendered' : 'source')
    }
  }, [selectedFile])

  // 在浏览器中打开文件
  const handleOpenInBrowser = useCallback(() => {
    if (!selectedFile) return
    window.electronAPI?.openExternal(selectedFile.path)
  }, [selectedFile])

  // 保存文件
  const handleSave = useCallback(async () => {
    if (!selectedFile || !cwd || !window.electronAPI?.writeFileContent) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const result = await window.electronAPI.writeFileContent(cwd, selectedFile.path, editContent)
      if (result.error) {
        setSaveMsg(`保存失败: ${result.error}`)
      } else {
        setSaveMsg('已保存')
        setSelectedFile({ ...selectedFile, content: editContent })
        setEditing(false)
        setTimeout(() => setSaveMsg(null), 2000)
      }
    } catch (err) {
      setSaveMsg(`保存失败: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [selectedFile, editContent, cwd])

  // 进入编辑模式
  const enterEdit = useCallback(() => {
    if (!selectedFile) return
    setEditContent(selectedFile.content)
    setEditing(true)
    setSaveMsg(null)
  }, [selectedFile])

  const isLight = settings.chatTheme === 'light'

  // CodeMirror 只读样式
  const cmReadonlyTheme = useMemo(() => EditorView.theme({
    '&': { backgroundColor: 'transparent', height: '100%' },
    '.cm-gutters': { backgroundColor: isLight ? '#f5f1eb' : '#1e1e1e', borderRight: isLight ? '1px solid #d5d0c8' : '1px solid #3e3e42' },
    '.cm-activeLineGutter': { backgroundColor: isLight ? '#ebe7e0' : '#2a2d2e' },
    '.cm-activeLine': { backgroundColor: isLight ? '#ebe7e040' : '#2a2d2e40' },
    '.cm-cursor': { borderLeftColor: isLight ? '#333' : '#d4d4d4' },
    '.cm-selectionBackground': { backgroundColor: isLight ? '#b4d7ff !important' : '#264f78 !important' },
  }), [isLight])

  // CodeMirror 语言扩展（缓存避免重建）
  const cmExtensions = useMemo(() => {
    if (!selectedFile) return []
    const langId = getLangFromExt(selectedFile.name)
    const langExt = getCmLangExtension(langId)
    return [
      cmReadonlyTheme,
      ...(Array.isArray(langExt) ? langExt : [langExt]),
    ]
  }, [selectedFile, cmReadonlyTheme])

  // Markdown 代码块组件（带语法高亮）
  const MdCodeBlock = ({ code, language }: { code: string; language?: string }) => {
    const [codeCopied, setCodeCopied] = useState(false)
    const onCopy = () => {
      navigator.clipboard.writeText(code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    }
    if (language) {
      return (
        <div className="relative group my-3">
          <button onClick={onCopy}
            className="absolute top-2 right-2 p-1 rounded bg-white/10 hover:bg-white/20 text-claude-text-muted hover:text-claude-text opacity-0 group-hover:opacity-100 transition-all z-10"
            title="复制代码">
            {codeCopied ? <span className="text-[10px] text-green-400">OK</span> : <Copy size={12} />}
          </button>
          <Highlight theme={isLight ? prismThemes.oneLight : prismThemes.vsDark} code={code} language={language}>
            {({ style, tokens, getLineProps, getTokenProps }) => (
              <pre style={{ ...style, backgroundColor: 'transparent' }} className="rounded-md p-3 overflow-x-auto text-xs border border-claude-border bg-claude-bg my-2">
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    <span className={`inline-block w-7 text-right mr-2 select-none text-[10px] ${isLight ? 'text-black/20' : 'text-white/20'}`}>{i + 1}</span>
                    {line.map((token, key) => <span key={key} {...getTokenProps({ token })} />)}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        </div>
      )
    }
    return <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs font-mono">{code}</code>
  }

  // Markdown 渲染视图
  const renderMarkdown = (content: string) => (
    <div className={`prose prose-sm max-w-none px-5 py-4 ${isLight ? '' : 'prose-invert'}
      prose-headings:text-claude-text prose-headings:border-b prose-headings:border-claude-border/30 prose-headings:pb-2 prose-headings:mb-3
      prose-h1:text-xl prose-h1:font-bold
      prose-h2:text-lg prose-h2:font-semibold
      prose-h3:text-base prose-h3:font-semibold
      prose-p:text-claude-text prose-p:leading-relaxed prose-p:text-sm
      prose-a:text-claude-primary prose-a:no-underline hover:prose-a:underline
      prose-strong:text-claude-text prose-strong:font-semibold
      prose-em:text-claude-text/80
      prose-code:text-claude-primary prose-code:bg-claude-surface prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-transparent prose-pre:p-0
      prose-ul:text-claude-text prose-ul:text-sm
      prose-ol:text-claude-text prose-ol:text-sm
      prose-li:text-claude-text prose-li:text-sm prose-li:marker:text-claude-text-muted
      prose-blockquote:border-claude-primary/40 prose-blockquote:text-claude-text-muted prose-blockquote:text-sm
      prose-hr:border-claude-border/40
      prose-table:text-sm
      prose-th:text-claude-text prose-th:border-claude-border prose-th:px-3 prose-th:py-1.5 prose-th:bg-claude-surface/50
      prose-td:text-claude-text prose-td:border-claude-border prose-td:px-3 prose-td:py-1.5
      prose-img:rounded-lg prose-img:max-w-full
    `}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const codeStr = String(children).replace(/\n$/, '')
            if (match) return <MdCodeBlock code={codeStr} language={match[1]} />
            return <code className={className} {...props}>{children}</code>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-claude-border bg-claude-surface">
        <h2 className="text-sm font-semibold text-claude-text">项目文件</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowHidden(!showHidden)}
            className={`p-1.5 rounded hover:bg-claude-surface-light transition-colors ${showHidden ? 'text-claude-primary' : 'text-claude-text-muted hover:text-claude-text'
              }`}
            title={showHidden ? '隐藏点文件' : '显示点文件'}
          >
            {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={loadRoot}
            className="p-1.5 text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light transition-colors"
            title="刷新"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* 工作目录 + 搜索 */}
      {cwd && (
        <div className="px-3 py-2 border-b border-claude-border bg-claude-surface/30 space-y-1.5">
          <p className="text-[10px] text-claude-text-muted truncate" title={cwd}>{cwd}</p>
          <div className="flex items-center gap-1.5 bg-claude-bg rounded border border-claude-border px-2 py-1">
            <Search size={12} className="text-claude-text-muted flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索文件名..."
              className="flex-1 bg-transparent text-xs text-claude-text placeholder-claude-text-muted focus:outline-none min-w-0"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-claude-text-muted hover:text-claude-text">
                <X size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20 flex items-start gap-2">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-400 break-all">{error}</p>
        </div>
      )}

      {/* 统计信息 */}
      {!error && tree.length > 0 && (
        <div className="px-3 py-1 text-[10px] text-claude-text-muted border-b border-claude-border/30">
          {stats.dirs} 个目录, {stats.files} 个文件
        </div>
      )}

      {/* 主体区域 */}
      <div className="flex-1 overflow-hidden flex">
        {/* 文件树 */}
        <div className={`overflow-y-auto ${selectedFile ? 'w-60 border-r border-claude-border flex-shrink-0' : 'flex-1'}`}>
          {!cwd ? (
            <div className="p-8 text-center">
              <Folder size={36} className="mx-auto mb-3 text-claude-text-muted opacity-30" />
              <p className="text-xs text-claude-text-muted mb-1">请先在设置中选择工作目录</p>
              <p className="text-[10px] text-claude-text-muted/60">Ctrl+6 打开设置面板</p>
            </div>
          ) : loading ? (
            <div className="p-8 text-center">
              <Loader2 size={24} className="mx-auto mb-2 text-claude-text-muted animate-spin" />
              <p className="text-xs text-claude-text-muted">加载中...</p>
            </div>
          ) : tree.length === 0 && !error ? (
            <div className="p-8 text-center">
              <Folder size={36} className="mx-auto mb-3 text-claude-text-muted opacity-30" />
              <p className="text-xs text-claude-text-muted">目录为空</p>
              <p className="text-[10px] text-claude-text-muted/60 mt-1">
                {showHidden ? '没有任何可读取的文件' : '尝试打开"显示隐藏文件"'}
              </p>
            </div>
          ) : (
            <div className="py-0.5">
              {tree.map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  selectedPath={selectedFile?.path || null}
                  onFileClick={handleFileClick}
                  onLoadChildren={loadChildren}
                  searchQuery={searchQuery}
                />
              ))}
            </div>
          )}
        </div>

        {/* 文件预览 */}
        {selectedFile && (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* 预览头 */}
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-claude-border bg-claude-surface/50">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode size={14} className={getExtColor(selectedFile.name)} />
                <span className="text-xs text-claude-text truncate font-mono">{selectedFile.name}</span>
                <span className="text-[10px] text-claude-text-muted px-1.5 py-0.5 bg-claude-surface rounded flex-shrink-0">
                  {getLangFromExt(selectedFile.name)}
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Markdown/HTML 源码/预览切换 */}
                {(isMarkdown || isHtml) && (
                  <div className="flex items-center bg-claude-surface rounded overflow-hidden mr-1">
                    <button
                      onClick={() => setPreviewMode('rendered')}
                      className={`flex items-center gap-1 px-2 py-1 text-[10px] transition-colors ${previewMode === 'rendered'
                          ? 'bg-claude-primary text-white'
                          : 'text-claude-text-muted hover:text-claude-text'
                        }`}
                      title="预览"
                    >
                      <BookOpen size={11} /> 预览
                    </button>
                    <button
                      onClick={() => setPreviewMode('source')}
                      className={`flex items-center gap-1 px-2 py-1 text-[10px] transition-colors ${previewMode === 'source'
                          ? 'bg-claude-primary text-white'
                          : 'text-claude-text-muted hover:text-claude-text'
                        }`}
                      title="源码"
                    >
                      <Code2 size={11} /> 源码
                    </button>
                  </div>
                )}
                {/* HTML 文件 - 在浏览器中打开 */}
                {isHtml && (
                  <button
                    onClick={handleOpenInBrowser}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-blue-400 hover:text-blue-300 rounded hover:bg-claude-surface-light transition-colors mr-1"
                    title="在默认浏览器中打开"
                  >
                    <Globe size={12} /> 浏览器打开
                  </button>
                )}
                {/* 编辑/保存 */}
                {editing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-green-400 hover:text-green-300 rounded hover:bg-green-500/10 transition-colors"
                      title="保存 (Ctrl+S)"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} 保存
                    </button>
                    <button
                      onClick={() => { setEditing(false); setSaveMsg(null) }}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light transition-colors"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    onClick={enterEdit}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light transition-colors"
                    title="编辑文件"
                  >
                    <Pencil size={12} /> 编辑
                  </button>
                )}
                {saveMsg && <span className={`text-[10px] ml-1 ${saveMsg.startsWith('保存失败') ? 'text-red-400' : 'text-green-400'}`}>{saveMsg}</span>}
                <button
                  onClick={handleCopy}
                  className="p-1 text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light"
                  title="复制内容"
                >
                  <Copy size={12} />
                </button>
                {copied && <span className="text-[10px] text-green-400 ml-1">OK</span>}
                <button
                  onClick={() => { setSelectedFile(null); setEditing(false); setSaveMsg(null) }}
                  className="p-1 text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* 预览内容 */}
            <div className="flex-1 overflow-auto">
              {fileLoading ? (
                <div className="flex items-center gap-2 p-4 text-xs text-claude-text-muted">
                  <Loader2 size={14} className="animate-spin" /> 加载中...
                </div>
              ) : isMarkdown && previewMode === 'rendered' && !editing ? (
                renderMarkdown(selectedFile.content)
              ) : isHtml && previewMode === 'rendered' && !editing ? (
                <iframe
                  src={`file:///${selectedFile.path.replace(/\\/g, '/')}`}
                  className="w-full h-full border-0 bg-white"
                  sandbox="allow-same-origin allow-scripts"
                  title={selectedFile.name}
                />
              ) : (
                <CodeMirror
                  value={editing ? editContent : selectedFile.content}
                  extensions={cmExtensions}
                  theme={isLight ? 'light' : vscodeDark}
                  editable={editing}
                  readOnly={!editing}
                  onChange={editing ? (val) => setEditContent(val) : undefined}
                  onKeyDown={(e) => {
                    if (editing && e.ctrlKey && e.key === 's') {
                      e.preventDefault()
                      handleSave()
                    }
                  }}
                  basicSetup={{
                    lineNumbers: true,
                    highlightActiveLineGutter: true,
                    highlightActiveLine: editing,
                    foldGutter: true,
                    bracketMatching: true,
                    closeBrackets: editing,
                    autocompletion: false,
                    indentOnInput: editing,
                  }}
                  style={{ height: '100%', fontSize: '13px' }}
                />
              )}
            </div>

            {/* 预览底栏 */}
            <div className="px-3 py-1 border-t border-claude-border bg-claude-surface/30 flex items-center justify-between">
              <p className="text-[10px] text-claude-text-muted truncate flex-1" title={selectedFile.path}>
                {selectedFile.path}
              </p>
              <span className="text-[10px] text-claude-text-muted/60 ml-2 flex-shrink-0">
                {selectedFile.content.split('\n').length} 行
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
