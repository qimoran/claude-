import { useState } from 'react'
import { Search } from 'lucide-react'
import { commands } from '../../data/commands'
import CommandCard from './CommandCard'
import { useAppSettings } from '../../hooks/useAppSettings'

// 不适用于 GUI 的命令
const UNSUPPORTED_COMMANDS = new Set([
  '/login', '/logout', '/terminal-setup', '/vim', '/compact',
  '/doctor', '/pr-comments',
])

interface CommandPanelProps {
  onClearChat?: () => void
  onShowCost?: () => string
  onSwitchPanel?: (panel: string) => void
}

export default function CommandPanel({ onClearChat, onShowCost, onSwitchPanel }: CommandPanelProps) {
  const [search, setSearch] = useState('')
  const [executionResult, setExecutionResult] = useState<string | null>(null)
  const { settings } = useAppSettings()

  const filteredCommands = commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(search.toLowerCase()) ||
      cmd.description.toLowerCase().includes(search.toLowerCase())
  )

  const handleExecute = async (commandName: string) => {
    // 本地处理的命令
    if (commandName === '/clear') {
      if (onClearChat) {
        onClearChat()
        setExecutionResult('对话已清除')
      } else {
        setExecutionResult('请切换到对话面板后使用此命令，或按 Ctrl+L')
      }
      return
    }

    if (commandName === '/cost') {
      if (onShowCost) {
        setExecutionResult(onShowCost())
      } else {
        setExecutionResult('请切换到对话面板查看费用统计')
      }
      return
    }

    if (commandName === '/help') {
      const helpText = commands
        .map((cmd) => `  ${cmd.name.padEnd(20)} ${cmd.description}`)
        .join('\n')
      setExecutionResult(`可用命令:\n\n${helpText}\n\n提示: 在对话中直接输入 / 开头的文本也可触发命令。`)
      return
    }

    if (commandName === '/status') {
      const lines = [
        `API 端点: ${settings.apiEndpoint}`,
        `API 格式: ${settings.apiFormat}`,
        `默认模型: ${settings.customModel || settings.defaultModel}`,
        `工作目录: ${settings.workingDirectory || '(未设置)'}`,
        `自动执行: ${settings.dangerouslySkipPermissions ? '已开启' : '已关闭'}`,
        `已配置模型: ${settings.models.length} 个`,
        `MCP 服务器: ${settings.mcpServers.length} 个`,
        `Hooks: ${settings.hooks.length} 个`,
      ]
      setExecutionResult(lines.join('\n'))
      return
    }

    if (commandName === '/config') {
      if (onSwitchPanel) {
        onSwitchPanel('settings')
      }
      setExecutionResult('请在设置面板中修改配置，或按 Ctrl+,')
      return
    }

    if (commandName === '/model') {
      const modelList = settings.models
        .map((m) => `  ${m.modelId.padEnd(30)} ${m.name}`)
        .join('\n')
      setExecutionResult(
        `当前模型: ${settings.customModel || settings.defaultModel}\n\n可用模型:\n${modelList}\n\n切换模型请到设置 > 模型管理`
      )
      return
    }

    if (commandName === '/permissions') {
      setExecutionResult(
        `跳过权限确认: ${settings.dangerouslySkipPermissions ? '已开启' : '已关闭'}\n\n` +
        `修改权限请到设置 > 权限`
      )
      return
    }

    if (UNSUPPORTED_COMMANDS.has(commandName)) {
      setExecutionResult(`${commandName} 在 GUI 模式下不可用。此功能仅在 CLI 终端中支持。`)
      return
    }

    // 其他命令（/init, /review, /memory 等）→ 发送给 API 作为提示
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.execute({ prompt: commandName })
        setExecutionResult(result.output)
      } else {
        setExecutionResult(`模拟执行: ${commandName}`)
      }
    } catch (error) {
      setExecutionResult(`执行失败: ${error}`)
    }
  }

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      {/* Header */}
      <div className="p-6 border-b border-claude-border">
        <h1 className="text-lg font-semibold text-claude-text mb-4">斜杠命令</h1>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-claude-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索命令..."
            className="w-full bg-claude-surface border border-claude-border rounded-lg pl-10 pr-4 py-2
                       text-claude-text placeholder-claude-text-muted
                       focus:outline-none focus:border-claude-primary"
          />
        </div>
      </div>

      {/* Commands Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCommands.map((command) => (
            <CommandCard
              key={command.name}
              command={command}
              onExecute={() => handleExecute(command.name)}
            />
          ))}
        </div>
      </div>

      {/* Execution Result */}
      {executionResult && (
        <div className="p-4 border-t border-claude-border bg-claude-surface">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-claude-text">执行结果</span>
            <button
              onClick={() => setExecutionResult(null)}
              className="text-xs text-claude-text-muted hover:text-claude-text"
            >
              关闭
            </button>
          </div>
          <pre className="text-sm text-claude-text-muted bg-claude-bg rounded p-3 overflow-x-auto max-h-40 whitespace-pre-wrap">
            {executionResult}
          </pre>
        </div>
      )}
    </div>
  )
}
