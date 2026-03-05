import { MessageSquare, Terminal, Wrench, Settings, FolderTree, History, BarChart3 } from 'lucide-react'

type Panel = 'chat' | 'commands' | 'tools' | 'settings' | 'files' | 'history' | 'analytics'

interface SidebarProps {
  activePanel: Panel
  onPanelChange: (panel: Panel) => void
}

interface NavItem {
  id: Panel
  icon: React.ReactNode
  label: string
}

const mainItems: NavItem[] = [
  { id: 'chat', icon: <MessageSquare size={18} />, label: '对话' },
  { id: 'files', icon: <FolderTree size={18} />, label: '文件' },
  { id: 'history', icon: <History size={18} />, label: '归档' },
  { id: 'commands', icon: <Terminal size={18} />, label: '命令' },
  { id: 'tools', icon: <Wrench size={18} />, label: '工具' },
  { id: 'analytics', icon: <BarChart3 size={18} />, label: '分析' },
]

const bottomItems: NavItem[] = [
  { id: 'settings', icon: <Settings size={18} />, label: '设置' },
]

function NavButton({ item, isActive, onClick }: { item: NavItem; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`
        group relative w-11 h-11 rounded-xl flex flex-col items-center justify-center gap-0.5
        transition-all duration-200
        ${isActive
          ? 'text-claude-primary bg-white/[0.04]'
          : 'text-claude-text-muted hover:text-claude-text hover:bg-white/[0.02]'
        }
      `}
      title={item.label}
    >
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-6 rounded-r bg-claude-primary" />
      )}
      <div className={`transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
        {item.icon}
      </div>
      <span className={`text-[9px] leading-none transition-colors ${isActive ? 'font-semibold text-claude-primary' : 'group-hover:text-claude-primary'}`}>{item.label}</span>
    </button>
  )
}

export default function Sidebar({ activePanel, onPanelChange }: SidebarProps) {
  return (
    <nav className="w-[56px] bg-claude-surface border-r border-claude-border flex flex-col items-center py-3 gap-0.5 justify-between">
      <div className="flex flex-col items-center gap-0.5">
        {mainItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={activePanel === item.id}
            onClick={() => onPanelChange(item.id)}
          />
        ))}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <div className="w-6 h-px bg-claude-border/30 mb-1" />
        {bottomItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            isActive={activePanel === item.id}
            onClick={() => onPanelChange(item.id)}
          />
        ))}
      </div>
    </nav>
  )
}
