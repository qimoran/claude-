import { useState, useCallback, useRef, useEffect, KeyboardEvent, DragEvent, ClipboardEvent } from 'react'
import { Send, Square, Paperclip, Zap, X } from 'lucide-react'
import { builtinTemplates, categoryLabels } from '../../data/promptTemplates'
import type { PromptTemplate } from '../../data/promptTemplates'
import type { ImageAttachment } from '../../hooks/useClaudeCode'
import { useAppSettings } from '../../hooks/useAppSettings'

interface InputAreaProps {
  onSend: (message: string, images?: ImageAttachment[]) => void
  onStop: () => void
  isLoading: boolean
}

export default function InputArea({ onSend, onStop, isLoading }: InputAreaProps) {
  const { settings } = useAppSettings()
  const [input, setInput] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; content: string }>>([])
  const [attachedImages, setAttachedImages] = useState<Array<{ name: string; mediaType: string; base64: string; previewUrl: string }>>([])

  // ── Prompt 模板命令菜单 ──
  const [showCmdMenu, setShowCmdMenu] = useState(false)
  const [cmdFilter, setCmdFilter] = useState('')
  const [cmdSelectedIdx, setCmdSelectedIdx] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cmdMenuRef = useRef<HTMLDivElement>(null)

  const filteredTemplates = builtinTemplates.filter((t) => {
    if (!cmdFilter) return true
    const q = cmdFilter.toLowerCase()
    return t.command.toLowerCase().includes(q)
      || t.label.toLowerCase().includes(q)
      || t.description.toLowerCase().includes(q)
  })

  // 按分类分组
  const groupedTemplates: Array<{ category: string; label: string; items: PromptTemplate[] }> = []
  const seen = new Set<string>()
  for (const t of filteredTemplates) {
    if (!seen.has(t.category)) {
      seen.add(t.category)
      groupedTemplates.push({
        category: t.category,
        label: categoryLabels[t.category] || t.category,
        items: filteredTemplates.filter((x) => x.category === t.category),
      })
    }
  }

  const flatFiltered = filteredTemplates

  useEffect(() => {
    setCmdSelectedIdx(0)
  }, [cmdFilter])

  // 面板恢复可见时自动聚焦输入框
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoading) {
          el.focus()
        }
      },
      { threshold: 0.01 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isLoading])

  // 点击外部关闭菜单
  useEffect(() => {
    if (!showCmdMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (cmdMenuRef.current && !cmdMenuRef.current.contains(e.target as Node)) {
        setShowCmdMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showCmdMenu])

  const insertTemplate = useCallback((template: PromptTemplate) => {
    setInput(template.prompt)
    setShowCmdMenu(false)
    setCmdFilter('')
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [])

  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    // 检测 / 命令
    if (value.startsWith('/')) {
      setShowCmdMenu(true)
      setCmdFilter(value.slice(1))
    } else {
      setShowCmdMenu(false)
      setCmdFilter('')
    }
  }, [])

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      // 释放 previewUrl
      URL.revokeObjectURL(prev[index]?.previewUrl || '')
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleSend = () => {
    let message = input.trim()
    // 附加文件内容
    if (attachedFiles.length > 0) {
      const fileContents = attachedFiles.map(f =>
        `\n\n--- 文件: ${f.name} ---\n${f.content}`
      ).join('')
      message = message + fileContents
    }
    // 收集图片附件
    const imagePayload = attachedImages.length > 0
      ? attachedImages.map(img => ({ mediaType: img.mediaType, base64: img.base64 }))
      : undefined
    if ((message || imagePayload) && !isLoading) {
      onSend(message || '(图片)', imagePayload)
      setInput('')
      setAttachedFiles([])
      setAttachedImages([])
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 命令菜单打开时拦截键盘
    if (showCmdMenu && flatFiltered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdSelectedIdx((prev) => Math.min(prev + 1, flatFiltered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdSelectedIdx((prev) => Math.max(prev - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        insertTemplate(flatFiltered[cmdSelectedIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowCmdMenu(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const readFileAsText = useCallback((file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        let text = reader.result as string
        if (text.length > 50000) {
          text = text.slice(0, 50000) + '\n... (文件过大，已截断)'
        }
        resolve(text)
      }
      reader.onerror = () => resolve(`[无法读取文件: ${file.name}]`)
      reader.readAsText(file)
    })
  }, [])

  const readImageAsBase64 = useCallback((file: File): Promise<{ mediaType: string; base64: string; previewUrl: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        // data:image/png;base64,XXXXX
        const base64 = dataUrl.split(',')[1]
        resolve({ mediaType: file.type, base64, previewUrl: dataUrl })
      }
      reader.onerror = () => reject(new Error(`无法读取图片: ${file.name}`))
      reader.readAsDataURL(file)
    })
  }, [])

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    const textResults: Array<{ name: string; content: string }> = []
    const imgResults: Array<{ name: string; mediaType: string; base64: string; previewUrl: string }> = []

    for (const file of files.slice(0, 5)) {
      if (file.type.startsWith('image/')) {
        try {
          const imgData = await readImageAsBase64(file)
          imgResults.push({ name: file.name, ...imgData })
        } catch { /* ignore unreadable images */ }
      } else {
        const content = await readFileAsText(file)
        textResults.push({ name: file.name, content })
      }
    }
    if (textResults.length > 0) setAttachedFiles((prev) => [...prev, ...textResults])
    if (imgResults.length > 0) setAttachedImages((prev) => [...prev, ...imgResults])
  }, [readFileAsText, readImageAsBase64])

  // Ctrl+V 粘贴图片
  const handlePaste = useCallback(async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter(item => item.type.startsWith('image/'))
    if (imageItems.length === 0) return // 不是图片，让默认粘贴行为继续

    e.preventDefault() // 阻止默认粘贴
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue
      try {
        const imgData = await readImageAsBase64(file)
        setAttachedImages((prev) => [...prev, { name: `截图-${Date.now()}.${file.type.split('/')[1]}`, ...imgData }])
      } catch { /* ignore */ }
    }
  }, [readImageAsBase64])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <div
      className="px-4 py-3 input-area-wrap"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* 拖放提示遮罩 */}
      {isDragging && (
        <div className="mb-2 p-3 rounded-md border-2 border-dashed border-claude-primary/50 bg-claude-primary/5 text-center">
          <Paperclip size={18} className="mx-auto mb-1 text-claude-primary" />
          <p className="text-xs text-claude-primary">松开以添加文件或图片</p>
        </div>
      )}

      {/* 已附加文件列表 */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachedFiles.map((file, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-1 bg-claude-surface border border-claude-border rounded text-xs text-claude-text-muted"
            >
              <Paperclip size={10} />
              {file.name}
              <button
                onClick={() => removeFile(i)}
                className="ml-1 text-claude-text-muted hover:text-red-400"
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 已附加图片缩略图 */}
      {attachedImages.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachedImages.map((img, i) => (
            <div key={i} className="relative group">
              <img
                src={img.previewUrl}
                alt={img.name}
                className="h-16 w-16 object-cover rounded border border-claude-border"
              />
              <button
                onClick={() => removeImage(i)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white
                           flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={10} />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-white px-1 truncate rounded-b">
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 命令菜单弹出层 */}
      {showCmdMenu && flatFiltered.length > 0 && (
        <div
          ref={cmdMenuRef}
          className="mb-2 max-h-64 overflow-y-auto rounded-md border border-claude-border bg-claude-surface shadow-panel"
        >
          {groupedTemplates.map((group) => (
            <div key={group.category}>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider bg-claude-bg sticky top-0 border-b border-claude-border">
                {group.label}
              </div>
              {group.items.map((t) => {
                const globalIdx = flatFiltered.indexOf(t)
                return (
                  <button
                    key={t.id}
                    onClick={() => insertTemplate(t)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${globalIdx === cmdSelectedIdx
                      ? 'bg-claude-primary/20 text-claude-text'
                      : 'text-claude-text-muted hover:bg-claude-surface-light hover:text-claude-text'
                      }`}
                  >
                    <Zap size={14} className="text-claude-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-[#d2a8ff]">{t.command}</span>
                        <span className="text-sm font-medium">{t.label}</span>
                      </div>
                      <p className="text-xs text-claude-text-muted truncate">{t.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end">
        {/* 附件按钮 */}
        <button
          onClick={async () => {
            if (!window.electronAPI?.selectFiles) return
            const result = await window.electronAPI.selectFiles()
            if (result.canceled) return
            const textFiles: Array<{ name: string; content: string }> = []
            const imgFiles: Array<{ name: string; mediaType: string; base64: string; previewUrl: string }> = []
            for (const f of result.files) {
              if (f.isImage && f.base64 && f.mediaType) {
                imgFiles.push({ name: f.name, mediaType: f.mediaType, base64: f.base64, previewUrl: `data:${f.mediaType};base64,${f.base64}` })
              } else {
                textFiles.push({ name: f.name, content: f.content })
              }
            }
            if (textFiles.length > 0) setAttachedFiles(prev => [...prev, ...textFiles])
            if (imgFiles.length > 0) setAttachedImages(prev => [...prev, ...imgFiles])
          }}
          disabled={isLoading}
          className="h-[38px] w-9 flex items-center justify-center text-claude-text-dim hover:text-claude-text
                     bg-transparent border border-transparent hover:bg-claude-surface-light rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          title="附加文件或图片"
        >
          <Paperclip size={16} />
        </button>

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="输入消息... (/ 快捷指令 | Ctrl+V 粘贴图片 | Enter 发送)"
          disabled={isLoading}
          rows={3}
          style={{ fontSize: `${settings.fontSizeChat}px` }}
          className="flex-1 bg-claude-bg border border-claude-border rounded px-3 py-2
                     text-claude-text placeholder-claude-text-dim resize-none
                     focus:outline-none focus:border-claude-primary
                     disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
        />

        {isLoading ? (
          <button
            onClick={onStop}
            className="h-[38px] px-3 bg-transparent hover:bg-red-500/10 border border-red-500/50 rounded
                       flex items-center justify-center gap-1.5 transition-all text-red-500"
          >
            <Square size={14} />
            <span className="text-xs font-medium">Stop</span>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim() && attachedFiles.length === 0 && attachedImages.length === 0}
            className="h-[38px] w-[38px] bg-claude-primary hover:bg-claude-primary-light rounded
                       flex items-center justify-center transition-all duration-150
                       disabled:opacity-25 disabled:cursor-not-allowed disabled:bg-claude-surface-light active:scale-95"
          >
            <Send size={16} className="text-white" />
          </button>
        )}
      </div>
    </div>
  )
}
