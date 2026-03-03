import {
  Terminal,
  FileText,
  FilePlus,
  FileEdit,
  FolderSearch,
  Search,
  Users,
  Globe,
  SearchCode,
  BookOpen,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Tool } from '../../data/tools'

const iconMap: Record<string, React.ReactNode> = {
  Terminal: <Terminal size={20} />,
  FileText: <FileText size={20} />,
  FilePlus: <FilePlus size={20} />,
  FileEdit: <FileEdit size={20} />,
  FolderSearch: <FolderSearch size={20} />,
  Search: <Search size={20} />,
  Users: <Users size={20} />,
  Globe: <Globe size={20} />,
  SearchCode: <SearchCode size={20} />,
  BookOpen: <BookOpen size={20} />,
}

interface ToolCardProps {
  tool: Tool
  isExpanded: boolean
  onToggle: () => void
}

export default function ToolCard({ tool, isExpanded, onToggle }: ToolCardProps) {
  return (
    <div
      className={`bg-claude-surface border rounded-lg overflow-hidden transition-all ${
        isExpanded ? 'border-claude-primary' : 'border-claude-border hover:border-claude-primary/50'
      }`}
    >
      <div
        className="p-4 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-claude-primary/10 flex items-center justify-center text-claude-primary">
            {iconMap[tool.icon] || <Terminal size={20} />}
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-claude-text">{tool.name}</h3>
              {isExpanded ? (
                <ChevronUp size={18} className="text-claude-text-muted" />
              ) : (
                <ChevronDown size={18} className="text-claude-text-muted" />
              )}
            </div>
            <p className="text-sm text-claude-text-muted mt-1">{tool.description}</p>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-claude-border/50">
          {/* Parameters */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-claude-text mb-2">参数</h4>
            <div className="space-y-2">
              {tool.params.map((param) => (
                <div
                  key={param.name}
                  className="bg-claude-bg rounded-lg p-3"
                >
                  <div className="flex items-center gap-2">
                    <code className="text-claude-accent text-sm">{param.name}</code>
                    <span className="text-xs text-claude-text-muted">({param.type})</span>
                    {param.required && (
                      <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">
                        必需
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-claude-text-muted mt-1">{param.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Examples */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-claude-text mb-2">示例</h4>
            <div className="flex flex-wrap gap-2">
              {tool.examples.map((example, idx) => (
                <code
                  key={idx}
                  className="text-xs bg-claude-bg text-claude-text-muted px-2 py-1 rounded"
                >
                  {example}
                </code>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
