import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Folder, FolderOpen, FileText, FileCode, ChevronRight, ChevronDown,
  RefreshCw, Copy, X, Search, AlertCircle, Eye, EyeOff, Loader2, Code2, BookOpen, Globe,
  Save, Pencil,
} from 'lucide-react'
import { useAppSettings } from '../../hooks/useAppSettings'
import { parseDataInput } from '../../utils/dataAnalysis'

// ── 类型 ──────────────────────────────────────────────
interface DirEntry {
  name: string
  path: string
  isDir: boolean
  size?: number
  children?: DirEntry[] // undefined=有子项待加载, []=确认空
}

interface PreviewTableData {
  columns: string[]
  rows: Array<Record<string, string>>
  total: number
}

interface SelectedFileState {
  path: string
  name: string
  kind: 'text' | 'image' | 'excel'
  content: string
  base64?: string
  mimeType?: string
  size?: number
}

type XlsxLike = {
  read: (data: ArrayBuffer, options: { type: 'array' }) => {
    SheetNames: string[]
    Sheets: Record<string, unknown>
  }
  utils: {
    sheet_to_json: (sheet: unknown, options: { defval: string }) => Array<Record<string, unknown>>
  }
}

const XLSX_SCRIPT_ID = 'file-browser-sheetjs'

const LazyFileMarkdownPreview = import('./FileMarkdownPreview')
const LazyFileCodeViewer = import('./FileCodeViewer')

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg'])
const EXCEL_EXTENSIONS = new Set(['.xls', '.xlsx'])
const TABLE_PREVIEW_ROW_LIMIT = 200

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

function getLangFromExt(name: string, kind: SelectedFileState['kind'] = 'text'): string {
  if (kind === 'image') return 'image'
  if (kind === 'excel') return 'excel'

  const ext = getExt(name)
  if (ext === '.csv') return 'csv'

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
  return map[ext] || 'text'
}

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function normalizeTableRows(rows: Array<Record<string, unknown>>): PreviewTableData {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const normalizedRows = rows.map((row) => {
    const next: Record<string, string> = {}
    columns.forEach((column) => {
      next[column] = normalizeCellValue(row[column])
    })
    return next
  })
  return {
    columns,
    rows: normalizedRows,
    total: normalizedRows.length,
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

async function ensureScript(id: string, src: string): Promise<void> {
  if (document.getElementById(id)) return
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = id
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`加载脚本失败: ${src}`))
    document.head.appendChild(script)
  })
}

async function ensureXlsx(): Promise<XlsxLike> {
  await ensureScript(XLSX_SCRIPT_ID, 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js')
  const win = window as unknown as { XLSX?: XlsxLike }
  if (!win.XLSX) throw new Error('XLSX 引擎加载失败')
  return win.XLSX
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
  const [selectedFile, setSelectedFile] = useState<SelectedFileState | null>(null)
  const [previewTable, setPreviewTable] = useState<PreviewTableData | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [previewMode, setPreviewMode] = useState<'source' | 'rendered'>('rendered')
  const [MarkdownPreviewComponent, setMarkdownPreviewComponent] = useState<null | ((props: { content: string; isLight: boolean }) => JSX.Element)>(null)
  const [CodeViewerComponent, setCodeViewerComponent] = useState<null | ((props: { fileName: string; fileKind: SelectedFileState['kind']; value: string; editable: boolean; isLight: boolean; onChange?: (value: string) => void; onSave?: () => void }) => JSX.Element)>(null)
  const [previewDependencyLoading, setPreviewDependencyLoading] = useState(false)

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
    setEditing(false)
    setSaveMsg(null)
    setPreviewTable(null)

    const ext = getExt(entry.name)
    const isCsvExt = ext === '.csv'
    const isExcelExt = EXCEL_EXTENSIONS.has(ext)
    const isImageExt = IMAGE_EXTENSIONS.has(ext)

    try {
      const result = await window.electronAPI.readFileContent(cwd, entry.path)
      if (result.error) {
        setSelectedFile({ path: entry.path, name: entry.name, kind: 'text', content: `// ${result.error}`, size: result.size })
        return
      }

      const inferredKind: SelectedFileState['kind'] = isImageExt
        ? 'image'
        : isExcelExt
          ? 'excel'
          : result.kind || 'text'

      const nextFile: SelectedFileState = {
        path: entry.path,
        name: entry.name,
        kind: inferredKind,
        content: result.content || '',
        base64: result.base64,
        mimeType: result.mimeType,
        size: result.size,
      }

      if (isCsvExt) {
        try {
          const parsed = parseDataInput(nextFile.content)
          setPreviewTable({
            columns: parsed.columns,
            rows: parsed.rows.slice(0, TABLE_PREVIEW_ROW_LIMIT),
            total: parsed.rows.length,
          })
        } catch (csvError) {
          nextFile.content = `// CSV 预览失败: ${(csvError as Error).message}\n\n${nextFile.content}`
        }
      } else if (isExcelExt && result.base64) {
        try {
          const xlsx = await ensureXlsx()
          const workbook = xlsx.read(base64ToArrayBuffer(result.base64), { type: 'array' })
          const firstSheetName = workbook.SheetNames[0]
          if (!firstSheetName) {
            nextFile.content = '// Excel 文件不包含可读取的工作表'
            nextFile.kind = 'text'
          } else {
            const rows = xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '' })
            const normalized = normalizeTableRows(rows)
            setPreviewTable({
              ...normalized,
              rows: normalized.rows.slice(0, TABLE_PREVIEW_ROW_LIMIT),
            })
            nextFile.content = JSON.stringify(rows, null, 2)
          }
        } catch (excelError) {
          nextFile.content = `// Excel 预览失败: ${(excelError as Error).message}`
          nextFile.kind = 'text'
        }
      }

      setSelectedFile(nextFile)
    } catch {
      setSelectedFile({ path: entry.path, name: entry.name, kind: 'text', content: '// 读取失败' })
    } finally {
      setFileLoading(false)
    }
  }, [cwd])

  const handleCopy = useCallback(() => {
    if (!selectedFile || selectedFile.kind === 'image') return
    navigator.clipboard.writeText(selectedFile.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [selectedFile])

  const selectedExt = selectedFile ? getExt(selectedFile.name) : ''
  const isMarkdown = selectedFile ? ['.md', '.mdx'].includes(selectedExt) : false
  const isHtml = selectedFile ? ['.html', '.htm'].includes(selectedExt) : false
  const isCsv = !!selectedFile && selectedExt === '.csv'
  const isExcel = !!selectedFile && (EXCEL_EXTENSIONS.has(selectedExt) || selectedFile.kind === 'excel')
  const isImage = !!selectedFile && (IMAGE_EXTENSIONS.has(selectedExt) || selectedFile.kind === 'image')
  const isBinaryFile = isImage || isExcel
  const supportsRenderedToggle = isMarkdown || isHtml || isCsv || isExcel
  const canEditFile = !!selectedFile && !isBinaryFile
  const showTablePreview = !!previewTable && (isCsv || isExcel)

  // 自动切换：支持渲染预览的文件默认渲染，其他文件默认源码
  useEffect(() => {
    if (!selectedFile) return
    const previewable = isMarkdown || isHtml || isCsv || isExcel || isImage
    setPreviewMode(previewable ? 'rendered' : 'source')
  }, [selectedFile, isMarkdown, isHtml, isCsv, isExcel, isImage])

  // 在浏览器中打开文件
  const handleOpenInBrowser = useCallback(() => {
    if (!selectedFile) return
    window.electronAPI?.openExternal({ target: selectedFile.path, root: cwd || undefined })
  }, [selectedFile, cwd])

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

  useEffect(() => {
    if (!selectedFile) return

    const needsMarkdownPreview = isMarkdown && previewMode === 'rendered' && !editing && !MarkdownPreviewComponent
    const needsCodeViewer = (!isImage && !showTablePreview && !(isMarkdown && previewMode === 'rendered' && !editing) && !CodeViewerComponent)

    if (!needsMarkdownPreview && !needsCodeViewer) return

    let cancelled = false

    const loadDependencies = async () => {
      setPreviewDependencyLoading(true)
      try {
        if (needsMarkdownPreview) {
          const mod = await LazyFileMarkdownPreview
          if (!cancelled) {
            setMarkdownPreviewComponent(() => mod.default)
          }
        }
        if (needsCodeViewer) {
          const mod = await LazyFileCodeViewer
          if (!cancelled) {
            setCodeViewerComponent(() => mod.default)
          }
        }
      } finally {
        if (!cancelled) {
          setPreviewDependencyLoading(false)
        }
      }
    }

    loadDependencies()
    return () => {
      cancelled = true
    }
  }, [selectedFile, isMarkdown, isImage, showTablePreview, previewMode, editing, MarkdownPreviewComponent, CodeViewerComponent])

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
                  {getLangFromExt(selectedFile.name, selectedFile.kind)}
                </span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* 预览/源码切换 */}
                {supportsRenderedToggle && (
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
                {canEditFile && editing ? (
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
                ) : canEditFile ? (
                  <button
                    onClick={enterEdit}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light transition-colors"
                    title="编辑文件"
                  >
                    <Pencil size={12} /> 编辑
                  </button>
                ) : null}
                {saveMsg && <span className={`text-[10px] ml-1 ${saveMsg.startsWith('保存失败') ? 'text-red-400' : 'text-green-400'}`}>{saveMsg}</span>}
                {!isImage && (
                  <button
                    onClick={handleCopy}
                    className="p-1 text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light"
                    title="复制内容"
                  >
                    <Copy size={12} />
                  </button>
                )}
                {copied && <span className="text-[10px] text-green-400 ml-1">OK</span>}
                <button
                  onClick={() => { setSelectedFile(null); setPreviewTable(null); setEditing(false); setSaveMsg(null) }}
                  className="p-1 text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* 预览内容 */}
            <div className={`flex-1 ${showTablePreview && previewMode === 'rendered' && !editing ? 'overflow-hidden' : 'overflow-auto'}`}>
              {fileLoading ? (
                <div className="flex items-center gap-2 p-4 text-xs text-claude-text-muted">
                  <Loader2 size={14} className="animate-spin" /> 加载中...
                </div>
              ) : isImage && previewMode === 'rendered' ? (
                <div className="h-full w-full flex items-center justify-center p-4 bg-claude-bg">
                  {selectedFile.base64 ? (
                    <img
                      src={`data:${selectedFile.mimeType || 'image/png'};base64,${selectedFile.base64}`}
                      alt={selectedFile.name}
                      className="max-w-full max-h-full object-contain rounded border border-claude-border"
                    />
                  ) : (
                    <p className="text-xs text-red-400">图片数据缺失，无法预览</p>
                  )}
                </div>
              ) : showTablePreview && previewMode === 'rendered' && !editing ? (
                <div className="h-full overflow-auto bg-claude-surface">
                  <div className="px-3 py-2 border-b border-claude-border bg-claude-bg/80 sticky top-0 z-10 text-xs text-claude-text-muted">
                    表格预览：显示 {previewTable?.rows.length ?? 0}/{previewTable?.total ?? 0} 行
                  </div>
                  <table className="w-full text-xs">
                    <thead className="sticky top-[29px] bg-claude-bg/95">
                      <tr>
                        {(previewTable?.columns || []).slice(0, 20).map((column) => (
                          <th key={column} className="text-left font-medium text-claude-text-muted px-2 py-1.5 border-b border-claude-border whitespace-nowrap">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(previewTable?.rows || []).map((row, index) => (
                        <tr key={`${index}-${(previewTable?.columns || []).map(c => row[c] || '').join('|')}`} className="odd:bg-claude-bg/30">
                          {(previewTable?.columns || []).slice(0, 20).map((column) => (
                            <td key={column} className="px-2 py-1.5 text-claude-text border-b border-claude-border/50 whitespace-nowrap">
                              {(row[column] || '-').toString()}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : isMarkdown && previewMode === 'rendered' && !editing ? (
                MarkdownPreviewComponent ? (
                  <MarkdownPreviewComponent content={selectedFile.content} isLight={isLight} />
                ) : (
                  <div className="flex items-center gap-2 p-4 text-xs text-claude-text-muted">
                    <Loader2 size={14} className="animate-spin" /> 加载 Markdown 预览中...
                  </div>
                )
              ) : isHtml && previewMode === 'rendered' && !editing ? (
                <iframe
                  src={`file:///${selectedFile.path.replace(/\\/g, '/')}`}
                  className="w-full h-full border-0 bg-white"
                  sandbox="allow-same-origin"
                  title={selectedFile.name}
                />
              ) : CodeViewerComponent ? (
                <CodeViewerComponent
                  fileName={selectedFile.name}
                  fileKind={selectedFile.kind}
                  value={editing ? editContent : selectedFile.content}
                  editable={editing}
                  isLight={isLight}
                  onChange={editing ? (val) => setEditContent(val) : undefined}
                  onSave={handleSave}
                />
              ) : (
                <div className="flex items-center gap-2 p-4 text-xs text-claude-text-muted">
                  <Loader2 size={14} className="animate-spin" /> {previewDependencyLoading ? '加载代码预览中...' : '准备预览中...'}
                </div>
              )}
            </div>

            {/* 预览底栏 */}
            <div className="px-3 py-1 border-t border-claude-border bg-claude-surface/30 flex items-center justify-between">
              <p className="text-[10px] text-claude-text-muted truncate flex-1" title={selectedFile.path}>
                {selectedFile.path}
              </p>
              <span className="text-[10px] text-claude-text-muted/60 ml-2 flex-shrink-0">
                {selectedFile.kind === 'text' ? `${selectedFile.content.split('\n').length} 行` : (selectedFile.size ? formatSize(selectedFile.size) : '')}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
