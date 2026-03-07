import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Highlight, themes as prismThemes } from 'prism-react-renderer'

interface FileMarkdownPreviewProps {
  content: string
  isLight: boolean
}

function MarkdownCodeBlock({ code, language, isLight }: { code: string; language?: string; isLight: boolean }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  if (language) {
    return (
      <div className="relative group my-3">
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px] text-claude-text-muted hover:text-claude-text opacity-0 group-hover:opacity-100 transition-all z-10"
          title="复制代码"
        >
          {copied ? 'OK' : '复制'}
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

export default function FileMarkdownPreview({ content, isLight }: FileMarkdownPreviewProps) {
  return (
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
            if (match) return <MarkdownCodeBlock code={codeStr} language={match[1]} isLight={isLight} />
            return <code className={className} {...props}>{children}</code>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
