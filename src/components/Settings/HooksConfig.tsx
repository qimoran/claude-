import { useState, useEffect } from 'react'
import { Plus, Trash2, Save } from 'lucide-react'
import { useAppSettings } from '../../hooks/useAppSettings'
import type { HookConfig } from '../../hooks/useAppSettings'

export default function HooksConfig() {
  const { settings, saveSettings } = useAppSettings()
  const [hooks, setHooks] = useState<HookConfig[]>(settings.hooks)
  const [saved, setSaved] = useState(false)

  // 同步外部设置变化
  useEffect(() => {
    setHooks(settings.hooks)
  }, [settings.hooks])

  const addHook = () => {
    setHooks([
      ...hooks,
      { id: Date.now().toString(), event: 'PreToolUse', command: '', enabled: true },
    ])
  }

  const removeHook = (id: string) => {
    setHooks(hooks.filter((h) => h.id !== id))
  }

  const updateHook = (id: string, updates: Partial<HookConfig>) => {
    setHooks(hooks.map((h) => (h.id === id ? { ...h, ...updates } : h)))
  }

  const handleSave = () => {
    saveSettings({ hooks })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h3 className="font-medium text-claude-text mb-1">Hooks 配置</h3>
        <p className="text-sm text-claude-text-muted">
          在工具调用前后执行自定义命令
        </p>
      </div>

      <div className="space-y-3">
        {hooks.map((hook) => (
          <div
            key={hook.id}
            className="bg-claude-surface border border-claude-border rounded-lg p-4"
          >
            <div className="flex items-center gap-3 mb-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hook.enabled}
                  onChange={(e) => updateHook(hook.id, { enabled: e.target.checked })}
                  className="w-4 h-4 rounded border-claude-border text-claude-primary"
                />
                <span className="text-sm text-claude-text">启用</span>
              </label>

              <select
                value={hook.event}
                onChange={(e) => updateHook(hook.id, { event: e.target.value as HookConfig['event'] })}
                className="bg-claude-bg border border-claude-border rounded px-3 py-1.5
                           text-sm text-claude-text focus:outline-none focus:border-claude-primary"
              >
                <option value="PreToolUse">PreToolUse</option>
                <option value="PostToolUse">PostToolUse</option>
                <option value="Notification">Notification</option>
              </select>

              <button
                onClick={() => removeHook(hook.id)}
                className="ml-auto p-1.5 text-red-400 hover:bg-red-500/10 rounded"
              >
                <Trash2 size={16} />
              </button>
            </div>

            <input
              type="text"
              value={hook.command}
              onChange={(e) => updateHook(hook.id, { command: e.target.value })}
              placeholder="要执行的命令..."
              className="w-full bg-claude-bg border border-claude-border rounded px-3 py-2
                         text-sm text-claude-text font-mono placeholder-claude-text-muted
                         focus:outline-none focus:border-claude-primary"
            />
          </div>
        ))}
      </div>

      {hooks.length === 0 && (
        <div className="text-sm text-claude-text-muted bg-claude-surface border border-claude-border rounded-lg p-4 mb-3">
          暂无 Hook 配置，点击下方按钮添加。
        </div>
      )}

      <div className="flex gap-3 mt-4">
        <button
          onClick={addHook}
          className="flex items-center gap-2 px-4 py-2 bg-claude-surface border border-claude-border
                     text-claude-text rounded-lg hover:bg-claude-surface-light transition-colors"
        >
          <Plus size={16} />
          添加 Hook
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
