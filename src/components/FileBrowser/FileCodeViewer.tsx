import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

interface FileCodeViewerProps {
  fileName: string
  fileKind: 'text' | 'image' | 'excel'
  value: string
  editable: boolean
  isLight: boolean
  onChange?: (value: string) => void
  onSave?: () => void
}

function getExt(name: string): string {
  return name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : ''
}

function getLangFromExt(name: string, kind: FileCodeViewerProps['fileKind'] = 'text'): string {
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

async function loadLanguageExtension(langId: string): Promise<Extension[]> {
  switch (langId) {
    case 'typescript': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return [javascript({ typescript: true })]
    }
    case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return [javascript({ jsx: true, typescript: true })]
    }
    case 'javascript': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return [javascript()]
    }
    case 'jsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return [javascript({ jsx: true })]
    }
    case 'python': {
      const { python } = await import('@codemirror/lang-python')
      return [python()]
    }
    case 'html':
    case 'vue':
    case 'svelte': {
      const { html } = await import('@codemirror/lang-html')
      return [html()]
    }
    case 'css': {
      const { css } = await import('@codemirror/lang-css')
      return [css()]
    }
    case 'json': {
      const { json } = await import('@codemirror/lang-json')
      return [json()]
    }
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown')
      return [markdown()]
    }
    case 'xml':
    case 'toml': {
      const { xml } = await import('@codemirror/lang-xml')
      return [xml()]
    }
    case 'sql': {
      const { sql } = await import('@codemirror/lang-sql')
      return [sql()]
    }
    case 'java': {
      const { java } = await import('@codemirror/lang-java')
      return [java()]
    }
    case 'rust': {
      const { rust } = await import('@codemirror/lang-rust')
      return [rust()]
    }
    case 'c':
    case 'cpp': {
      const { cpp } = await import('@codemirror/lang-cpp')
      return [cpp()]
    }
    case 'yaml': {
      const { yaml } = await import('@codemirror/lang-yaml')
      return [yaml()]
    }
    case 'bash':
    case 'batch':
    case 'go':
    case 'text':
    default:
      return []
  }
}

export default function FileCodeViewer({ fileName, fileKind, value, editable, isLight, onChange, onSave }: FileCodeViewerProps) {
  const [languageExtensions, setLanguageExtensions] = useState<Extension[]>([])
  const [langLoading, setLangLoading] = useState(false)
  const langId = useMemo(() => getLangFromExt(fileName, fileKind), [fileName, fileKind])

  useEffect(() => {
    let disposed = false

    const load = async () => {
      setLangLoading(true)
      try {
        const loaded = await loadLanguageExtension(langId)
        if (!disposed) {
          setLanguageExtensions(loaded)
        }
      } catch {
        if (!disposed) {
          setLanguageExtensions([])
        }
      } finally {
        if (!disposed) {
          setLangLoading(false)
        }
      }
    }

    load()
    return () => {
      disposed = true
    }
  }, [langId])

  const readonlyTheme = useMemo(() => EditorView.theme({
    '&': { backgroundColor: 'transparent', height: '100%' },
    '.cm-gutters': { backgroundColor: isLight ? '#f5f1eb' : '#1e1e1e', borderRight: isLight ? '1px solid #d5d0c8' : '1px solid #3e3e42' },
    '.cm-activeLineGutter': { backgroundColor: isLight ? '#ebe7e0' : '#2a2d2e' },
    '.cm-activeLine': { backgroundColor: isLight ? '#ebe7e040' : '#2a2d2e40' },
    '.cm-cursor': { borderLeftColor: isLight ? '#333' : '#d4d4d4' },
    '.cm-selectionBackground': { backgroundColor: isLight ? '#b4d7ff !important' : '#264f78 !important' },
  }), [isLight])

  const extensions = useMemo(() => [readonlyTheme, ...languageExtensions], [readonlyTheme, languageExtensions])

  return (
    <div className="h-full relative">
      {langLoading && (
        <div className="absolute top-2 right-3 z-10 text-[10px] text-claude-text-muted bg-claude-surface/80 border border-claude-border rounded px-2 py-1">
          加载语法中...
        </div>
      )}
      <CodeMirror
        value={value}
        extensions={extensions}
        theme={isLight ? 'light' : vscodeDark}
        editable={editable}
        readOnly={!editable}
        onChange={editable ? onChange : undefined}
        onKeyDown={(e) => {
          if (editable && e.ctrlKey && e.key === 's') {
            e.preventDefault()
            onSave?.()
          }
        }}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: editable,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: editable,
          autocompletion: false,
          indentOnInput: editable,
        }}
        style={{ height: '100%', fontSize: '13px' }}
      />
    </div>
  )
}
