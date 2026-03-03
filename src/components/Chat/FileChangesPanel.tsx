import { useState, useEffect, useCallback } from 'react'
import { FileText, Undo2, ChevronDown, ChevronRight, X, RefreshCw } from 'lucide-react'

interface SnapshotItem {
  filePath: string
  existed: boolean
  toolName: string
  toolId: string
  turnNumber: number
}

interface FileChangesGroup {
  filePath: string
  snapshots: SnapshotItem[]
  latestTool: string
  latestTurn: number
}

interface FileChangesPanelProps {
  sessionId: string
  onClose: () => void
  onRollbackToTurn: (targetTurn: number, note?: string) => Promise<void>
  isRollbacking?: boolean
}

export default function FileChangesPanel({ sessionId, onClose, onRollbackToTurn, isRollbacking }: FileChangesPanelProps) {
  const [groups, setGroups] = useState<FileChangesGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoringSingle, setRestoringSingle] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const fetchSnapshots = useCallback(async () => {
    if (!window.electronAPI?.getSnapshots) return
    setLoading(true)
    try {
      const result = await window.electronAPI.getSnapshots(sessionId)
      if (!result || !Array.isArray(result)) {
        setGroups([])
        return
      }

      // 按文件路径分组
      const map = new Map<string, SnapshotItem[]>()
      for (const s of result) {
        const key = s.filePath
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(s)
      }

      const grouped: FileChangesGroup[] = []
      for (const [filePath, snapshots] of map) {
        const sorted = snapshots.sort((a, b) => a.turnNumber - b.turnNumber)
        grouped.push({
          filePath,
          snapshots: sorted,
          latestTool: sorted[sorted.length - 1].toolName,
          latestTurn: sorted[sorted.length - 1].turnNumber,
        })
      }
      // 按最新修改轮次降序
      grouped.sort((a, b) => b.latestTurn - a.latestTurn)
      setGroups(grouped)
    } catch {
      setGroups([])
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    fetchSnapshots()
  }, [fetchSnapshots])

  const handleRestoreOnlyThisFile = async (filePath: string) => {
    if (isRollbacking) return
    if (!window.electronAPI?.restoreFile) {
      setMessage('当前版本不支持单文件恢复')
      setTimeout(() => setMessage(null), 3000)
      return
    }

    setRestoringSingle(filePath)
    try {
      const ok = window.confirm(
        `即将“仅恢复此文件”到首次修改之前的状态：\n\n${filePath}\n\n` +
        `注意：这不会截断对话消息，也不会影响其他文件。\n是否继续？`,
      )
      if (!ok) return

      const result = await window.electronAPI.restoreFile({ sessionId, filePath })
      if (!result.success) {
        throw new Error(result.error || '恢复失败')
      }
      setMessage(`已恢复该文件（移除 ${result.removedSnapshots || 0} 条快照记录）`)
      setTimeout(() => setMessage(null), 3000)
      await fetchSnapshots()
    } catch (err) {
      setMessage(`恢复失败: ${(err as Error).message}`)
      setTimeout(() => setMessage(null), 3000)
    } finally {
      setRestoringSingle(null)
    }
  }

  const handleRestoreFile = async (filePath: string) => {
    if (isRollbacking) return
    setRestoring(filePath)
    try {
      // 找到这个文件最早的快照轮次，回滚到它之前
      const group = groups.find(g => g.filePath === filePath)
      if (!group || group.snapshots.length === 0) return

      const earliestTurn = group.snapshots[0].turnNumber
      const targetTurn = earliestTurn - 1

      const ok = window.confirm(
        `即将回滚整个会话到“轮次 ${targetTurn}”（该文件首次修改之前）。\n\n` +
        `注意：这会恢复该轮次之后的文件修改，并截断该轮次之后的对话消息，可能影响其他文件。\n\n` +
        `是否继续？`,
      )
      if (!ok) return

      await onRollbackToTurn(targetTurn, `来源：文件变更面板（${filePath}）`) 
      setMessage('已发起回滚（详情请看对话末尾的系统提示）')
      setTimeout(() => setMessage(null), 3000)
      await fetchSnapshots()
    } catch (err) {
      setMessage(`恢复失败: ${(err as Error).message}`)
      setTimeout(() => setMessage(null), 3000)
    } finally {
      setRestoring(null)
    }
  }

  const getToolLabel = (toolName: string) => {
    switch (toolName) {
      case 'write_file': return '写入'
      case 'edit_file': return '编辑'
      default: return toolName
    }
  }

  const getToolColor = (toolName: string) => {
    switch (toolName) {
      case 'write_file': return 'text-yellow-400'
      case 'edit_file': return 'text-orange-400'
      default: return 'text-gray-400'
    }
  }

  const getShortPath = (fullPath: string) => {
    const parts = fullPath.replace(/\\/g, '/').split('/')
    return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : fullPath
  }

  return (
    <div className="w-80 border-l border-claude-border bg-claude-surface flex flex-col h-full">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-claude-text">文件变更</span>
          {isRollbacking && <span className="text-[10px] text-orange-400 mt-0.5">回滚中，操作已暂时禁用</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchSnapshots}
            disabled={isRollbacking}
            className="p-1.5 text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={isRollbacking ? '回滚中不可刷新' : '刷新'}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-claude-text-muted hover:text-claude-text rounded hover:bg-claude-surface-light transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 提示消息 */}
      {message && (
        <div className="px-4 py-2 bg-claude-primary/10 text-xs text-claude-primary border-b border-claude-border">
          {message}
        </div>
      )}

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="p-6 text-center">
            <FileText size={32} className="mx-auto mb-2 text-claude-text-muted opacity-40" />
            <p className="text-xs text-claude-text-muted">
              {loading ? '加载中...' : '本次会话暂无文件变更'}
            </p>
          </div>
        ) : (
          <div className="py-1">
            <div className="px-4 py-1.5 text-[10px] text-claude-text-muted">
              共 {groups.length} 个文件被修改
            </div>
            {groups.map((group) => (
              <div key={group.filePath} className="border-b border-claude-border/30">
                <button
                  onClick={() => setExpandedFile(expandedFile === group.filePath ? null : group.filePath)}
                  className="w-full px-4 py-2.5 text-left hover:bg-claude-surface-light transition-colors flex items-start gap-2"
                >
                  {expandedFile === group.filePath
                    ? <ChevronDown size={14} className="text-claude-text-muted mt-0.5 flex-shrink-0" />
                    : <ChevronRight size={14} className="text-claude-text-muted mt-0.5 flex-shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-claude-text truncate font-mono" title={group.filePath}>
                      {getShortPath(group.filePath)}
                    </p>
                    <p className="text-[10px] text-claude-text-muted mt-0.5">
                      <span className={getToolColor(group.latestTool)}>{getToolLabel(group.latestTool)}</span>
                      {' '}{group.snapshots.length > 1 ? `x${group.snapshots.length}` : ''}
                      {' '}| 轮次 {group.latestTurn}
                    </p>
                  </div>
                </button>

                {/* 展开详情 */}
                {expandedFile === group.filePath && (
                  <div className="px-4 pb-3 pl-10">
                    <div className="space-y-1.5 mb-2">
                      {group.snapshots.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px]">
                          <span className={`${getToolColor(s.toolName)} font-medium`}>
                            {getToolLabel(s.toolName)}
                          </span>
                          <span className="text-claude-text-muted">
                            轮次 {s.turnNumber}
                          </span>
                          <span className="text-claude-text-muted">
                            {s.existed ? '(已存在)' : '(新建)'}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleRestoreOnlyThisFile(group.filePath)}
                        disabled={isRollbacking || restoringSingle === group.filePath}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-green-400 hover:text-green-300
                                   hover:bg-green-500/10 rounded transition-colors disabled:opacity-50"
                      >
                        <Undo2 size={10} />
                        {isRollbacking ? '回滚中...' : (restoringSingle === group.filePath ? '恢复中...' : '仅恢复此文件')}
                      </button>

                      <button
                        onClick={() => handleRestoreFile(group.filePath)}
                        disabled={isRollbacking || restoring === group.filePath}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-orange-400 hover:text-orange-300
                                   hover:bg-orange-500/10 rounded transition-colors disabled:opacity-50"
                      >
                        <Undo2 size={10} />
                        {isRollbacking ? '回滚中...' : (restoring === group.filePath ? '回滚中...' : '回滚会话到首次修改之前')}
                      </button>

                      <span className="text-[10px] text-claude-text-muted">
                        （回滚会截断消息并可能影响其他文件）
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
