import { describe, it, expect } from 'vitest'
import { rebaseTurnInfoAfterHistoryRewrite, getOrCreateTurnInfo, deleteSessionTurnInfo } from './snapshots'

describe('turn info rebase after summary rewrite', () => {
  const sessionId = 'session-test-rebase'

  it('rebuilds turnEndHistoryIndex and minRollbackTurn correctly', () => {
    const info = getOrCreateTurnInfo(sessionId)
    info.currentTurn = 5
    info.turnEndHistoryIndex = new Map([
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 8],
      [5, 10],
    ])

    rebaseTurnInfoAfterHistoryRewrite(sessionId, 4, 2, 8)

    expect(Array.from(info.turnEndHistoryIndex.entries())).toEqual([
      [3, 4],
      [4, 6],
      [5, 8],
    ])
    expect(info.minRollbackTurn).toBe(3)
  })

  it('keeps minRollbackTurn as MAX_SAFE_INTEGER when no turn mapping remains', () => {
    const info = getOrCreateTurnInfo(sessionId)
    info.currentTurn = 8
    info.turnEndHistoryIndex = new Map([[1, 1]])

    rebaseTurnInfoAfterHistoryRewrite(sessionId, 2, 0, 0)

    expect(info.turnEndHistoryIndex.size).toBe(0)
    expect(info.minRollbackTurn).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('resets state between tests', () => {
    deleteSessionTurnInfo(sessionId)
    const info = getOrCreateTurnInfo(sessionId)
    expect(info.currentTurn).toBe(-1)
    expect(info.minRollbackTurn).toBe(-1)
    expect(info.turnEndHistoryIndex.size).toBe(0)
  })
})
