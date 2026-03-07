import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Highlight, themes } from 'prism-react-renderer'
import { Check, Copy } from 'lucide-react'
import { useAppSettings } from '../../hooks/useAppSettings'

interface MarkdownRendererProps {
  content: string
  onPreviewImage?: (url: string) => void
  hiddenImageUrls?: Set<string>
}

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

  text = text.replace(/!\[[^\]]*\]\(\s*\)/g, '')
  text = text.replace(/<img\b[^>]*\bsrc=["']\s*["'][^>]*>/gi, '')

  return { text, urls }
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { settings } = useAppSettings()
  const isLight = settings.chatTheme === 'light'
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  if (language) {
    return (
      <div className="relative group">
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 p-1.5 rounded bg-[var(--c-hover-overlay)] hover:bg-[var(--c-white-alpha-4)] text-claude-text-muted hover:text-claude-text opacity-0 group-hover:opacity-100 transition-all z-10"
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

  const lines = code.split('\n')
  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-[var(--c-hover-overlay)] hover:bg-[var(--c-white-alpha-4)] text-claude-text-muted hover:text-claude-text opacity-0 group-hover:opacity-100 transition-all z-10"
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

export default function MarkdownRenderer({ content, onPreviewImage, hiddenImageUrls }: MarkdownRendererProps) {
  const { normalizedContent, supplementalImageUrls, isLarge, hasStreamingBase64 } = useMemo(() => {
    const hasBase64 = content.includes('data:image/')

    if (hasBase64) {
      const idx = content.indexOf('data:image/')
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
  const [enableHighlight, setEnableHighlight] = useState(false)

  useEffect(() => {
    if (enableHighlight || !normalizedContent.includes('```')) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        setEnableHighlight(true)
      }
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [enableHighlight, normalizedContent])

  return (
    <div className="prose prose-invert prose-sm max-w-none">
      {!isLarge ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            pre({ children }) {
              return <div className="not-prose my-3">{children}</div>
            },
            code({ className, children, node, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              const code = String(children).replace(/\n$/, '')
              const isInline = !match && node?.position && node.position.start.line === node.position.end.line

              if (isInline) {
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                )
              }

              if (!enableHighlight) {
                return (
                  <pre className="rounded-md p-3 overflow-x-auto text-sm bg-[var(--c-code-block-bg)] font-mono text-claude-text border border-claude-border">
                    <code>{code}</code>
                  </pre>
                )
              }

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
