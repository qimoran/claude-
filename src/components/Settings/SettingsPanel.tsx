import { useEffect, useState } from 'react'
import { Save, FolderOpen, Plus, Trash2, Wifi, WifiOff, Type, Sliders, RefreshCw, Download } from 'lucide-react'
import HooksConfig from './HooksConfig'
import McpConfig from './McpConfig'
import { useAppSettings, ModelConfig, EndpointSlot } from '../../hooks/useAppSettings'

type SettingsTab = 'general' | 'api' | 'models' | 'hooks' | 'mcp' | 'updates' | 'permissions'

export default function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [saved, setSaved] = useState(false)
  const { settings, updateSettings, saveSettings } = useAppSettings()

  // ── 连接检测状态 ──
  const [connStatus, setConnStatus] = useState<'idle' | 'checking' | 'connected' | 'failed'>('idle')
  const [connLatency, setConnLatency] = useState(0)
  const [connError, setConnError] = useState('')

  // ── 更新状态 ──
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'>('idle')
  const [latestVersion, setLatestVersion] = useState('')
  const [updatePercent, setUpdatePercent] = useState(0)
  const [updateError, setUpdateError] = useState('')

  // ── 新模型表单 ──
  const [newModelName, setNewModelName] = useState('')
  const [newModelId, setNewModelId] = useState('')
  const [newModelEndpoint, setNewModelEndpoint] = useState<EndpointSlot>('auto')

  const handleSave = () => {
    saveSettings()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleCheckConnection = async (endpointOverride?: string, keyOverride?: string, formatOverride?: 'anthropic' | 'openai') => {
    if (!window.electronAPI) return
    setConnStatus('checking')
    setConnError('')
    try {
      const result = await window.electronAPI.checkApiConnection({
        endpoint: endpointOverride || settings.apiEndpoint,
        key: keyOverride ?? settings.apiKey,
        format: formatOverride || settings.apiFormat,
      })
      if (result.connected) {
        setConnStatus('connected')
        setConnLatency(result.latency)
      } else {
        setConnStatus('failed')
        setConnError(result.error || '无法连接')
      }
    } catch (err) {
      setConnStatus('failed')
      setConnError(err instanceof Error ? err.message : '检测失败')
    }
  }

  const handleAddModel = () => {
    const name = newModelName.trim()
    const modelId = newModelId.trim()
    if (!name || !modelId) return

    const newModel: ModelConfig = {
      id: `custom-${Date.now()}`,
      name,
      modelId,
      endpoint: newModelEndpoint,
    }
    updateSettings({ models: [...settings.models, newModel] })
    setNewModelName('')
    setNewModelId('')
    setNewModelEndpoint('auto')
  }

  const handleRemoveModel = (id: string) => {
    updateSettings({ models: settings.models.filter((m) => m.id !== id) })
  }

  useEffect(() => {
    if (!window.electronAPI) return

    let mounted = true

    window.electronAPI.getAppVersion().then((result) => {
      if (!mounted || !result.success) return
      setAppVersion(result.version || '')
    }).catch(() => {})

    window.electronAPI.onUpdateStatus((data) => {
      if (!mounted) return
      setUpdateStatus(data.status)
      if (data.version) setLatestVersion(data.version)
      if (typeof data.percent === 'number') setUpdatePercent(data.percent)
      if (data.status === 'error') {
        setUpdateError(data.error || '更新失败')
      } else {
        setUpdateError('')
      }
    })

    return () => {
      mounted = false
      window.electronAPI?.removeUpdateListeners()
    }
  }, [])

  const handleCheckUpdate = async () => {
    if (!window.electronAPI) return
    setUpdateError('')
    setUpdatePercent(0)
    setUpdateStatus('checking')
    try {
      const result = await window.electronAPI.checkForUpdate()
      if (!result.success) {
        setUpdateStatus('error')
        setUpdateError(result.error || '检查更新失败')
        return
      }
      if (result.version) setLatestVersion(result.version)
    } catch (err) {
      setUpdateStatus('error')
      setUpdateError(err instanceof Error ? err.message : '检查更新失败')
    }
  }

  const handleDownloadUpdate = async () => {
    if (!window.electronAPI) return
    setUpdateError('')
    setUpdateStatus('downloading')
    try {
      const result = await window.electronAPI.downloadUpdate()
      if (!result.success) {
        setUpdateStatus('error')
        setUpdateError(result.error || '下载更新失败')
      }
    } catch (err) {
      setUpdateStatus('error')
      setUpdateError(err instanceof Error ? err.message : '下载更新失败')
    }
  }

  const handleInstallUpdate = async () => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.installUpdate()
      if (!result.success) {
        setUpdateStatus('error')
        setUpdateError(result.error || '安装更新失败')
      }
    } catch (err) {
      setUpdateStatus('error')
      setUpdateError(err instanceof Error ? err.message : '安装更新失败')
    }
  }

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: '基础设置' },
    { id: 'api', label: 'API 配置' },
    { id: 'models', label: '模型管理' },
    { id: 'hooks', label: 'Hooks' },
    { id: 'mcp', label: 'MCP 服务器' },
    { id: 'updates', label: '更新' },
    { id: 'permissions', label: '权限' },
  ]

  return (
    <div className="h-full flex flex-col bg-claude-bg">
      <div className="p-6 border-b border-claude-border">
        <h1 className="text-lg font-semibold text-claude-text">设置</h1>
        <p className="text-sm text-claude-text-muted mt-1">配置 API 端点、模型、权限等</p>
      </div>

      <div className="flex border-b border-claude-border overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'text-claude-primary border-b-2 border-claude-primary'
                : 'text-claude-text-muted hover:text-claude-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* ── 基础设置 ── */}
        {activeTab === 'general' && (
          <div className="max-w-2xl space-y-6">
            <div>
              <label className="block text-sm font-medium text-claude-text mb-2">默认模型</label>
              <select
                value={settings.defaultModel}
                onChange={(e) => updateSettings({ defaultModel: e.target.value })}
                className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                           text-claude-text focus:outline-none focus:border-claude-primary"
              >
                {settings.models.map((model) => (
                  <option key={model.id} value={model.modelId}>
                    {model.name} ({model.modelId})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-claude-text mb-2">自定义模型名 (可选)</label>
              <input
                type="text"
                value={settings.customModel}
                onChange={(e) => updateSettings({ customModel: e.target.value })}
                placeholder="例如: my-router/claude-sonnet-4.5"
                className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                           text-claude-text placeholder-claude-text-muted
                           focus:outline-none focus:border-claude-primary"
              />
              <p className="text-xs text-claude-text-muted mt-1">
                填写后将覆盖默认模型，方便接入 router 的自定义模型 ID
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-claude-text mb-2">工作目录</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.workingDirectory}
                  onChange={(e) => updateSettings({ workingDirectory: e.target.value })}
                  placeholder="D:\your-project"
                  className="flex-1 bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                             text-claude-text placeholder-claude-text-muted
                             focus:outline-none focus:border-claude-primary"
                />
                <button
                  onClick={async () => {
                    if (!window.electronAPI) return
                    const result = await window.electronAPI.selectFolder()
                    if (!result.canceled && result.path) {
                      updateSettings({ workingDirectory: result.path })
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-claude-surface border border-claude-border
                             rounded-lg text-sm text-claude-text hover:bg-claude-surface-light transition-colors"
                  title="选择文件夹"
                >
                  <FolderOpen size={16} />
                  浏览
                </button>
              </div>
              <p className="text-xs text-claude-text-muted mt-1">
                Claude 将在这个目录执行代码任务，效果更接近终端内运行
              </p>
            </div>

            {/* 字体大小设置 */}
            <div className="border-t border-claude-border pt-4 mt-2">
              <div className="flex items-center gap-2 mb-4">
                <Type size={16} className="text-claude-primary" />
                <h3 className="text-sm font-medium text-claude-text">字体大小</h3>
              </div>

              <div className="space-y-4">
                {/* 聊天消息字体 */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm text-claude-text">聊天消息</label>
                    <span className="text-xs text-claude-primary font-mono">{settings.fontSizeChat}px</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-claude-text-muted w-4">小</span>
                    <input
                      type="range"
                      min={12}
                      max={20}
                      step={1}
                      value={settings.fontSizeChat}
                      onChange={(e) => updateSettings({ fontSizeChat: Number(e.target.value) })}
                      className="flex-1 accent-claude-primary h-1.5 cursor-pointer"
                    />
                    <span className="text-[10px] text-claude-text-muted w-4">大</span>
                  </div>
                  <p className="text-[11px] text-claude-text-dim mt-1"
                     style={{ fontSize: `${settings.fontSizeChat}px` }}>
                    预览：这是一段聊天消息文字 Preview text
                  </p>
                </div>

                {/* 代码块字体 */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm text-claude-text">代码块</label>
                    <span className="text-xs text-claude-primary font-mono">{settings.fontSizeCode}px</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-claude-text-muted w-4">小</span>
                    <input
                      type="range"
                      min={11}
                      max={18}
                      step={1}
                      value={settings.fontSizeCode}
                      onChange={(e) => updateSettings({ fontSizeCode: Number(e.target.value) })}
                      className="flex-1 accent-claude-primary h-1.5 cursor-pointer"
                    />
                    <span className="text-[10px] text-claude-text-muted w-4">大</span>
                  </div>
                  <pre className="mt-1 bg-claude-bg rounded p-2 font-mono text-claude-text-muted"
                       style={{ fontSize: `${settings.fontSizeCode}px` }}>
                    {'const hello = "预览代码字体"'}
                  </pre>
                </div>

                {/* 界面字体 */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm text-claude-text">界面文字</label>
                    <span className="text-xs text-claude-primary font-mono">{settings.fontSizeUI}px</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-claude-text-muted w-4">小</span>
                    <input
                      type="range"
                      min={11}
                      max={16}
                      step={1}
                      value={settings.fontSizeUI}
                      onChange={(e) => updateSettings({ fontSizeUI: Number(e.target.value) })}
                      className="flex-1 accent-claude-primary h-1.5 cursor-pointer"
                    />
                    <span className="text-[10px] text-claude-text-muted w-4">大</span>
                  </div>
                  <p className="text-claude-text-muted mt-1"
                     style={{ fontSize: `${settings.fontSizeUI}px` }}>
                    预览：工具栏、标签等界面文字
                  </p>
                </div>

                {/* 快速预设 */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-claude-text-muted">快速预设:</span>
                  {[
                    { label: '紧凑', chat: 13, code: 12, ui: 12 },
                    { label: '默认', chat: 14, code: 13, ui: 13 },
                    { label: '舒适', chat: 16, code: 14, ui: 14 },
                    { label: '大字', chat: 18, code: 16, ui: 15 },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => updateSettings({
                        fontSizeChat: preset.chat,
                        fontSizeCode: preset.code,
                        fontSizeUI: preset.ui,
                      })}
                      className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                        settings.fontSizeChat === preset.chat && settings.fontSizeCode === preset.code && settings.fontSizeUI === preset.ui
                          ? 'border-claude-primary bg-claude-primary/10 text-claude-primary'
                          : 'border-claude-border text-claude-text-muted hover:border-claude-primary/50 hover:text-claude-text'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 模型参数 */}
            <div className="border-t border-claude-border pt-4 mt-2">
              <div className="flex items-center gap-2 mb-4">
                <Sliders size={16} className="text-claude-primary" />
                <h3 className="text-sm font-medium text-claude-text">模型参数</h3>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm text-claude-text">最大输出 Tokens</label>
                  <span className="text-xs text-claude-primary font-mono">{settings.maxTokens}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-claude-text-muted w-6">1024</span>
                  <input
                    type="range"
                    min={1024}
                    max={32768}
                    step={1024}
                    value={settings.maxTokens}
                    onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })}
                    className="flex-1 accent-claude-primary h-1.5 cursor-pointer"
                  />
                  <span className="text-[10px] text-claude-text-muted w-8">32768</span>
                </div>
                <p className="text-[10px] text-claude-text-dim mt-1">
                  控制模型单次回复的最大长度。值越大可生成更长回复，但消耗更多 token。
                </p>
              </div>
            </div>

            <button
              onClick={handleSave}
              className="flex items-center gap-2 bg-claude-primary hover:bg-claude-primary-light
                         text-white rounded-lg px-4 py-2 transition-colors"
            >
              <Save size={16} />
              {saved ? '已保存!' : '保存设置'}
            </button>
          </div>
        )}

        {/* ── API 配置 ── */}
        {activeTab === 'api' && (
          <div className="max-w-2xl space-y-6">
            <div>
              <label className="block text-sm font-medium text-claude-text mb-2">API 端点</label>
              <input
                type="text"
                value={settings.apiEndpoint}
                onChange={(e) => updateSettings({ apiEndpoint: e.target.value })}
                placeholder="http://127.0.0.1:3456"
                className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                           text-claude-text placeholder-claude-text-muted
                           focus:outline-none focus:border-claude-primary"
              />
              <p className="text-xs text-claude-text-muted mt-1">
                支持 HTTP/HTTPS，填写完整地址，例如 https://api.openai.com 或 http://127.0.0.1:3456
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-claude-text mb-2">备用 API 端点（Gemini / Claude 4.5 等）</label>
              <input
                type="text"
                value={settings.altApiEndpoint}
                onChange={(e) => updateSettings({ altApiEndpoint: e.target.value })}
                placeholder="http://127.0.0.1:8045"
                className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                           text-claude-text placeholder-claude-text-muted
                           focus:outline-none focus:border-claude-primary"
              />
              <p className="text-xs text-claude-text-muted mt-1">
                当选择 gemini-*、claude-sonnet-4-5*、claude-opus-4-6* 等模型时，会自动使用该端点
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-claude-text mb-2">API Key</label>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => updateSettings({ apiKey: e.target.value })}
                placeholder="留空则使用默认值"
                className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                           text-claude-text placeholder-claude-text-muted
                           focus:outline-none focus:border-claude-primary"
              />
              <p className="text-xs text-claude-text-muted mt-1">
                Key 仅存储在本机（安全存储加密），不会上传到任何服务器
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-claude-text mb-2">备用 API Key（8045）</label>
              <input
                type="password"
                value={settings.altApiKey}
                onChange={(e) => updateSettings({ altApiKey: e.target.value })}
                placeholder="用于备用端点（例如 8045）"
                className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                           text-claude-text placeholder-claude-text-muted
                           focus:outline-none focus:border-claude-primary"
              />
              <p className="text-xs text-claude-text-muted mt-1">
                当选择 Gemini / Claude 4.5/4.6 等模型并走备用端点时，会使用这个 Key
              </p>
            </div>

            {/* 中转站端点 */}
            <div className="border-t border-claude-border pt-4 mt-2">
              <h3 className="text-sm font-medium text-claude-text mb-3">中转站端点</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-claude-text mb-2">中转站 API 端点</label>
                  <input
                    type="text"
                    value={settings.thirdApiEndpoint}
                    onChange={(e) => updateSettings({ thirdApiEndpoint: e.target.value })}
                    placeholder="https://fucaixie.xyz"
                    className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                               text-claude-text placeholder-claude-text-muted
                               focus:outline-none focus:border-claude-primary"
                  />
                  <p className="text-xs text-claude-text-muted mt-1">
                    在模型管理中将模型的「端点」设为「中转站」即可走此端点
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-claude-text mb-2">中转站 API Key</label>
                  <input
                    type="password"
                    value={settings.thirdApiKey}
                    onChange={(e) => updateSettings({ thirdApiKey: e.target.value })}
                    placeholder="用于中转站端点"
                    className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                               text-claude-text placeholder-claude-text-muted
                               focus:outline-none focus:border-claude-primary"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-claude-text mb-2">主端点 API 格式</label>
                <select
                  value={settings.apiFormat}
                  onChange={(e) => updateSettings({ apiFormat: e.target.value as 'anthropic' | 'openai' })}
                  className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                             text-claude-text focus:outline-none focus:border-claude-primary"
                >
                  <option value="anthropic">Anthropic (Messages API)</option>
                  <option value="openai">OpenAI 兼容</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-claude-text mb-2">备用端点 API 格式</label>
                <select
                  value={settings.altApiFormat || 'openai'}
                  onChange={(e) => updateSettings({ altApiFormat: e.target.value as 'anthropic' | 'openai' })}
                  className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                             text-claude-text focus:outline-none focus:border-claude-primary"
                >
                  <option value="anthropic">Anthropic (Messages API)</option>
                  <option value="openai">OpenAI 兼容</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-claude-text mb-2">中转站 API 格式</label>
                <select
                  value={settings.thirdApiFormat || 'openai'}
                  onChange={(e) => updateSettings({ thirdApiFormat: e.target.value as 'anthropic' | 'openai' })}
                  className="w-full bg-claude-surface border border-claude-border rounded-lg px-4 py-2
                             text-claude-text focus:outline-none focus:border-claude-primary"
                >
                  <option value="anthropic">Anthropic (Messages API)</option>
                  <option value="openai">OpenAI 兼容</option>
                </select>
              </div>
            </div>

            {/* 连接检测 */}
            <div className="bg-claude-surface border border-claude-border rounded-lg p-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleCheckConnection(settings.apiEndpoint, settings.apiKey, settings.apiFormat)}
                  disabled={connStatus === 'checking'}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-claude-primary hover:bg-claude-primary-light
                             text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {connStatus === 'checking' ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      检测中...
                    </>
                  ) : (
                    <>
                      <Wifi size={16} />
                      测试连接
                    </>
                  )}
                </button>

                <button
                  onClick={() => handleCheckConnection(settings.altApiEndpoint, settings.altApiKey, settings.altApiFormat || settings.apiFormat)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-claude-surface border border-claude-border
                             text-sm text-claude-text hover:bg-claude-surface-light transition-colors"
                  title="检测备用端点（8045）"
                >
                  <Wifi size={16} className="text-claude-text-muted" />
                  检测备用端点
                </button>

                <button
                  onClick={() => handleCheckConnection(settings.thirdApiEndpoint, settings.thirdApiKey, settings.thirdApiFormat || settings.apiFormat)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-claude-surface border border-claude-border
                             text-sm text-claude-text hover:bg-claude-surface-light transition-colors"
                  title="检测中转站端点"
                >
                  <Wifi size={16} className="text-claude-text-muted" />
                  检测中转站
                </button>

                {connStatus === 'connected' && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-green-400">
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                    已连接 ({connLatency}ms)
                  </span>
                )}
                {connStatus === 'failed' && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-red-400">
                    <WifiOff size={14} />
                    连接失败: {connError}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={handleSave}
              className="flex items-center gap-2 bg-claude-primary hover:bg-claude-primary-light
                         text-white rounded-lg px-4 py-2 transition-colors"
            >
              <Save size={16} />
              {saved ? '已保存!' : '保存设置'}
            </button>
          </div>
        )}

        {/* ── 模型管理 ── */}
        {activeTab === 'models' && (
          <div className="max-w-2xl space-y-6">
            <p className="text-sm text-claude-text-muted">
              管理可用的模型列表。这些模型会出现在会话的模型选择下拉框中。
            </p>

            {/* 已有模型列表 */}
            <div className="space-y-2">
              {settings.models.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between bg-claude-surface border border-claude-border rounded-lg px-4 py-3"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-claude-text">{model.name}</p>
                    <p className="text-xs text-claude-text-muted font-mono">{model.modelId}</p>
                  </div>
                  <select
                    value={model.endpoint || 'auto'}
                    onChange={(e) => {
                      const updated = settings.models.map(m =>
                        m.id === model.id ? { ...m, endpoint: e.target.value as EndpointSlot } : m
                      )
                      updateSettings({ models: updated })
                    }}
                    className="bg-claude-bg border border-claude-border rounded px-2 py-1 text-xs text-claude-text"
                    title="该模型走哪个端点"
                  >
                    <option value="auto">自动</option>
                    <option value="main">主端点</option>
                    <option value="alt">备用端点</option>
                    <option value="third">中转站</option>
                  </select>
                  <button
                    onClick={() => handleRemoveModel(model.id)}
                    className="p-1.5 text-claude-text-muted hover:text-red-400 transition-colors"
                    title="删除模型"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* 添加新模型 */}
            <div className="bg-claude-surface border border-claude-border rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-claude-text">添加模型</h3>
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  placeholder="显示名称 (例: Claude Sonnet 4)"
                  className="bg-claude-bg border border-claude-border rounded-lg px-3 py-2
                             text-sm text-claude-text placeholder-claude-text-muted
                             focus:outline-none focus:border-claude-primary"
                />
                <input
                  type="text"
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                  placeholder="模型 ID (例: claude-sonnet-4)"
                  className="bg-claude-bg border border-claude-border rounded-lg px-3 py-2
                             text-sm text-claude-text placeholder-claude-text-muted font-mono
                             focus:outline-none focus:border-claude-primary"
                />
                <select
                  value={newModelEndpoint}
                  onChange={(e) => setNewModelEndpoint(e.target.value as EndpointSlot)}
                  className="bg-claude-bg border border-claude-border rounded-lg px-3 py-2
                             text-sm text-claude-text focus:outline-none focus:border-claude-primary"
                >
                  <option value="auto">端点: 自动</option>
                  <option value="main">端点: 主端点</option>
                  <option value="alt">端点: 备用</option>
                  <option value="third">端点: 中转站</option>
                </select>
              </div>
              <button
                onClick={handleAddModel}
                disabled={!newModelName.trim() || !newModelId.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-claude-primary hover:bg-claude-primary-light
                           text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                <Plus size={14} />
                添加
              </button>
            </div>

            <button
              onClick={handleSave}
              className="flex items-center gap-2 bg-claude-primary hover:bg-claude-primary-light
                         text-white rounded-lg px-4 py-2 transition-colors"
            >
              <Save size={16} />
              {saved ? '已保存!' : '保存设置'}
            </button>
          </div>
        )}

        {activeTab === 'hooks' && <HooksConfig />}
        {activeTab === 'mcp' && <McpConfig />}

        {/* ── 更新 ── */}
        {activeTab === 'updates' && (
          <div className="max-w-2xl space-y-6">
            <div className="bg-claude-surface border border-claude-border rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-claude-text">自动更新</h3>
              <p className="text-sm text-claude-text-muted">
                当前版本：<span className="font-mono text-claude-text">{appVersion || '-'}</span>
              </p>
              {latestVersion && (
                <p className="text-sm text-claude-text-muted">
                  最新版本：<span className="font-mono text-claude-text">{latestVersion}</span>
                </p>
              )}
              {updateStatus === 'downloading' && (
                <p className="text-sm text-claude-text-muted">下载中：{updatePercent}%</p>
              )}
              {updateStatus === 'up-to-date' && (
                <p className="text-sm text-green-400">已是最新版本</p>
              )}
              {updateStatus === 'available' && (
                <p className="text-sm text-claude-primary">发现新版本，可下载更新</p>
              )}
              {updateStatus === 'downloaded' && (
                <p className="text-sm text-green-400">更新包已下载，可立即重启安装</p>
              )}
              {updateStatus === 'error' && (
                <p className="text-sm text-red-400">{updateError || '更新失败'}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleCheckUpdate}
                  disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-claude-primary hover:bg-claude-primary-light
                             text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={14} className={updateStatus === 'checking' ? 'animate-spin' : ''} />
                  {updateStatus === 'checking' ? '检查中...' : '检查更新'}
                </button>

                <button
                  onClick={handleDownloadUpdate}
                  disabled={updateStatus !== 'available' && updateStatus !== 'downloading'}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-claude-surface border border-claude-border
                             text-sm text-claude-text hover:bg-claude-surface-light transition-colors disabled:opacity-50"
                >
                  <Download size={14} />
                  下载更新
                </button>

                <button
                  onClick={handleInstallUpdate}
                  disabled={updateStatus !== 'downloaded'}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-claude-surface border border-claude-border
                             text-sm text-claude-text hover:bg-claude-surface-light transition-colors disabled:opacity-50"
                >
                  立即安装并重启
                </button>
              </div>

              <p className="text-xs text-claude-text-muted">
                应用会在启动后自动检查更新，并在后台每 30 分钟自动检测一次。
              </p>
            </div>
          </div>
        )}

        {/* ── 权限 ── */}
        {activeTab === 'permissions' && (
          <div className="max-w-2xl space-y-6">
            <div className="bg-claude-surface border border-claude-border rounded-lg p-4">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={settings.dangerouslySkipPermissions}
                  onChange={(e) => updateSettings({ dangerouslySkipPermissions: e.target.checked })}
                  className="mt-0.5 w-4 h-4 rounded border-claude-border text-claude-primary"
                />
                <div>
                  <p className="text-sm font-medium text-claude-text">允许自动执行 (跳过权限确认)</p>
                  <p className="text-xs text-claude-text-muted mt-1">
                    开启后，bash / write_file / edit_file 等工具将不再弹出确认对话框，直接执行。
                    这可能导致文件被批量修改、命令被连续执行，建议仅在完全信任的本地项目中临时开启，完成后立即关闭。
                  </p>
                </div>
              </label>
            </div>

            <div className="bg-claude-surface border border-claude-border rounded-lg p-4">
              <h3 className="font-medium text-claude-text mb-3">说明</h3>
              <p className="text-sm text-claude-text-muted leading-6">
                默认情况下，非只读工具（bash、write_file、edit_file）在执行前会弹出确认框，
                你可以选择允许或拒绝。上方选项相当于 CLI 的 <code className="text-claude-primary">--dangerously-skip-permissions</code> 模式。
              </p>
            </div>

            <button
              onClick={handleSave}
              className="flex items-center gap-2 bg-claude-primary hover:bg-claude-primary-light
                         text-white rounded-lg px-4 py-2 transition-colors"
            >
              <Save size={16} />
              {saved ? '已保存!' : '保存设置'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
