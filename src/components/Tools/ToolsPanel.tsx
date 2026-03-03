import { useState } from 'react'
import { Search } from 'lucide-react'
import { tools } from '../../data/tools'
import ToolCard from './ToolCard'

export default function ToolsPanel() {
  const [search, setSearch] = useState('')
  const [selectedTool, setSelectedTool] = useState<string | null>(null)

  const filteredTools = tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(search.toLowerCase()) ||
      tool.description.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* Header */}
      <div className="p-6 border-b border-claude-border">
        <h1 className="text-lg font-semibold text-claude-text mb-2">可用工具</h1>
        <p className="text-sm text-claude-text-muted mb-4">
          Claude Code 内置的工具，用于执行各种操作
        </p>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-claude-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索工具..."
            className="w-full bg-claude-surface border border-claude-border rounded-lg pl-10 pr-4 py-2
                       text-claude-text placeholder-claude-text-muted
                       focus:outline-none focus:border-claude-primary"
          />
        </div>
      </div>

      {/* Tools Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTools.map((tool) => (
            <ToolCard
              key={tool.name}
              tool={tool}
              isExpanded={selectedTool === tool.name}
              onToggle={() => setSelectedTool(selectedTool === tool.name ? null : tool.name)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
