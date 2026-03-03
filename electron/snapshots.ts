import path from 'node:path'
import fs from 'node:fs'
import type { FileSnapshot, RollbackSnapshotResult, SessionTurnInfo } from './types'

// ── 回滚快照系统 ──────────────────────────────────────────
const snapshotStore = new Map<string, FileSnapshot[]>()
const sessionTurnInfo = new Map<string, SessionTurnInfo>()

export function getOrCreateTurnInfo(sessionId: string): SessionTurnInfo {
  if (!sessionTurnInfo.has(sessionId)) {
    sessionTurnInfo.set(sessionId, {
      currentTurn: -1,
      turnEndHistoryIndex: new Map(),
      minRollbackTurn: -1,
    })
  }
  return sessionTurnInfo.get(sessionId)!
}

export function getSessionTurnInfo(sessionId: string): SessionTurnInfo | undefined {
  return sessionTurnInfo.get(sessionId)
}

export function deleteSessionTurnInfo(sessionId: string) {
  sessionTurnInfo.delete(sessionId)
}

export function clearAllSessionTurnInfo() {
  sessionTurnInfo.clear()
}

export function saveSnapshot(sessionId: string, snapshot: FileSnapshot) {
  if (!snapshotStore.has(sessionId)) {
    snapshotStore.set(sessionId, [])
  }
  snapshotStore.get(sessionId)!.push(snapshot)
}

export function getSnapshots(sessionId: string): FileSnapshot[] {
  return snapshotStore.get(sessionId) || []
}

export function deleteSnapshots(sessionId: string) {
  snapshotStore.delete(sessionId)
}

export function clearAllSnapshots() {
  snapshotStore.clear()
}

export function recomputeMinRollbackTurn(sessionId: string) {
  const info = sessionTurnInfo.get(sessionId)
  if (!info) return

  if (info.turnEndHistoryIndex.size === 0) {
    info.minRollbackTurn = info.currentTurn < 0 ? -1 : Number.MAX_SAFE_INTEGER
    return
  }

  let min = Number.MAX_SAFE_INTEGER
  for (const turn of info.turnEndHistoryIndex.keys()) {
    if (turn < min) min = turn
  }
  info.minRollbackTurn = min
}

// 历史被头部重写/截断后重建 turn -> historyIndex 映射
// preservedFromHistoryIndex: 旧 history 中被保留尾段的起始位置（按长度计）
// prefixCount: 新 history 头部新增的前缀消息数（例如摘要占位）
export function rebaseTurnInfoAfterHistoryRewrite(
  sessionId: string,
  preservedFromHistoryIndex: number,
  prefixCount: number,
  newHistoryLength: number,
) {
  const info = sessionTurnInfo.get(sessionId)
  if (!info) return

  const rebased = new Map<number, number>()

  for (const [turn, endIndex] of info.turnEndHistoryIndex) {
    if (endIndex <= preservedFromHistoryIndex) continue
    const nextEnd = endIndex - preservedFromHistoryIndex + prefixCount
    if (nextEnd < 0 || nextEnd > newHistoryLength) continue
    rebased.set(turn, nextEnd)
  }

  info.turnEndHistoryIndex = rebased
  recomputeMinRollbackTurn(sessionId)
}

// 仅删除成功恢复的快照；失败项保留，便于重试
export function rollbackSnapshots(sessionId: string, targetTurn: number): RollbackSnapshotResult {
  const snapshots = getSnapshots(sessionId)
  const errors: string[] = []
  let restored = 0

  const toRestore = snapshots.filter(s => s.turnNumber > targetTurn)
  const failedSnapshots = new Set<FileSnapshot>()

  // 倒序恢复，确保文件最终回到较早状态
  for (let i = toRestore.length - 1; i >= 0; i--) {
    const snap = toRestore[i]
    try {
      if (snap.existed && snap.content !== null) {
        const dir = path.dirname(snap.filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(snap.filePath, snap.content, 'utf-8')
        restored++
      } else if (!snap.existed) {
        if (fs.existsSync(snap.filePath)) {
          fs.unlinkSync(snap.filePath)
          restored++
        }
      }
    } catch (err) {
      failedSnapshots.add(snap)
      errors.push(`${snap.filePath}: ${(err as Error).message}`)
    }
  }

  const kept = snapshots.filter(s => s.turnNumber <= targetTurn || failedSnapshots.has(s))
  snapshotStore.set(sessionId, kept)

  return {
    restored,
    errors,
    retainedSnapshots: kept.filter(s => s.turnNumber > targetTurn).length,
  }
}
