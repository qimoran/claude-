import { Play, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { Command } from '../../data/commands'

interface CommandCardProps {
  command: Command
  onExecute: () => void
}

export default function CommandCard({ command, onExecute }: CommandCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-claude-surface border border-claude-border rounded-lg overflow-hidden hover:border-claude-primary/50 transition-colors">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h3 className="font-mono text-claude-primary font-medium">{command.name}</h3>
            <p className="text-sm text-claude-text-muted mt-1">{command.description}</p>
          </div>
          <button
            onClick={onExecute}
            className="ml-2 p-2 bg-claude-primary/10 hover:bg-claude-primary/20 rounded-lg transition-colors"
            title="执行命令"
          >
            <Play size={16} className="text-claude-primary" />
          </button>
        </div>

        {/* Toggle Details */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-3 text-xs text-claude-text-muted hover:text-claude-text"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? '收起详情' : '查看详情'}
        </button>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-claude-border/50">
          {command.usage && (
            <div className="mt-3">
              <span className="text-xs text-claude-text-muted">用法:</span>
              <code className="block mt-1 text-sm bg-claude-bg rounded px-2 py-1 text-claude-accent">
                {command.usage}
              </code>
            </div>
          )}
          {command.examples && command.examples.length > 0 && (
            <div className="mt-3">
              <span className="text-xs text-claude-text-muted">示例:</span>
              <div className="mt-1 space-y-1">
                {command.examples.map((example, idx) => (
                  <code
                    key={idx}
                    className="block text-sm bg-claude-bg rounded px-2 py-1 text-claude-text"
                  >
                    {example}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
