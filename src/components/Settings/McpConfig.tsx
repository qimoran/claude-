import { useState, useEffect } from 'react'
import { Plus, Trash2, Save, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import { useAppSettings } from '../../hooks/useAppSettings'
import type { McpServerConfig } from '../../hooks/useAppSettings'

export default function McpConfig() {
  const { settings, saveSettings } = useAppSettings()
  const [servers, setServers] = useState<McpServerConfig[]>(settings.mcpServers)
  const [saved, setSaved] = useState(false)

  // 同步外部设置变化
  useEffect(() => {
    setServers(settings.mcpServers)
  }, [settings.mcpServers])

  const addServer = () => {
    setServers([
      ...servers,
      { id: Date.now().toString(), name: '', command: '', args: '', status: 'unknown' },
    ])
  }

  const removeServer = (id: string) => {
    setServers(servers.filter((s) => s.id !== id))
  }

  const updateServer = (id: string, updates: Partial<McpServerConfig>) => {
    setServers(servers.map((s) => (s.id === id ? { ...s, ...updates } : s)))
  }

  const testConnection = async (id: string) => {
    const server = servers.find((s) => s.id === id)
    if (!server || !server.command.trim()) {
      updateServer(id, { status: 'disconnected' })
      return
    }
    // 通过 IPC 测试连接（如果可用）
    if (window.electronAPI?.testMcpConnection) {
      try {
        const result = await window.electronAPI.testMcpConnection({
          command: server.command,
          args: server.args,
        })
        updateServer(id, { status: result.connected ? 'connected' : 'disconnected' })
      } catch {
        updateServer(id, { status: 'disconnected' })
      }
    } else {
      // 回退：简单检查命令是否非空
      updateServer(id, { status: server.command.trim() ? 'connected' : 'disconnected' })
    }
  }

  const handleSave = () => {
    saveSettings({ mcpServers: servers })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h3 className="font-medium text-claude-text mb-1">MCP 服务器配置</h3>
        <p className="text-sm text-claude-text-muted">
          管理 Model Context Protocol 服务器连接
        </p>
      </div>

      <div className="space-y-4">
        {servers.map((server) => (
          <div
            key={server.id}
            className="bg-claude-surface border border-claude-border rounded-lg p-4"
          >
            <div className="flex items-center gap-3 mb-3">
              <input
                type="text"
                value={server.name}
                onChange={(e) => updateServer(server.id, { name: e.target.value })}
                placeholder="服务器名称"
                className="flex-1 bg-claude-bg border border-claude-border rounded px-3 py-1.5
                           text-sm text-claude-text placeholder-claude-text-muted
                           focus:outline-none focus:border-claude-primary"
              />

              <div className="flex items-center gap-1">
                {server.status === 'connected' && (
                  <CheckCircle size={16} className="text-green-400" />
                )}
                {server.status === 'disconnected' && (
                  <XCircle size={16} className="text-red-400" />
                )}
                {server.status === 'unknown' && (
                  <span className="w-4 h-4 rounded-full bg-claude-text-muted/30"></span>
                )}
              </div>

              <button
                onClick={() => testConnection(server.id)}
                className="p-1.5 text-claude-text-muted hover:text-claude-text hover:bg-claude-surface-light rounded"
                title="测试连接"
              >
                <RefreshCw size={16} />
              </button>

              <button
                onClick={() => removeServer(server.id)}
                className="p-1.5 text-red-400 hover:bg-red-500/10 rounded"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-claude-text-muted mb-1">命令</label>
                <input
                  type="text"
                  value={server.command}
                  onChange={(e) => updateServer(server.id, { command: e.target.value })}
                  placeholder="npx"
                  className="w-full bg-claude-bg border border-claude-border rounded px-3 py-1.5
                             text-sm text-claude-text font-mono placeholder-claude-text-muted
                             focus:outline-none focus:border-claude-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-claude-text-muted mb-1">参数</label>
                <input
                  type="text"
                  value={server.args}
                  onChange={(e) => updateServer(server.id, { args: e.target.value })}
                  placeholder="-y @modelcontextprotocol/server-xxx"
                  className="w-full bg-claude-bg border border-claude-border rounded px-3 py-1.5
                             text-sm text-claude-text font-mono placeholder-claude-text-muted
                             focus:outline-none focus:border-claude-primary"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {servers.length === 0 && (
        <div className="text-sm text-claude-text-muted bg-claude-surface border border-claude-border rounded-lg p-4 mb-3">
          暂无 MCP 服务器配置，点击下方按钮添加。
        </div>
      )}

      <div className="flex gap-3 mt-4">
        <button
          onClick={addServer}
          className="flex items-center gap-2 px-4 py-2 bg-claude-surface border border-claude-border
                     text-claude-text rounded-lg hover:bg-claude-surface-light transition-colors"
        >
          <Plus size={16} />
          添加服务器
        </button>

        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-4 py-2 bg-claude-primary
                     text-white rounded-lg hover:bg-claude-primary-light transition-colors"
        >
          <Save size={16} />
          {saved ? '已保存!' : '保存配置'}
        </button>
      </div>
    </div>
  )
}
