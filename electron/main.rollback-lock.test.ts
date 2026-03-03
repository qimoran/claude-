import { describe, it, expect } from 'vitest'
import type { SessionTurnInfo } from './types'

function canRollback(targetTurn: number, turnInfo?: SessionTurnInfo) {
  if (targetTurn < -1) {
    return { ok: false, reason: 'invalid_turn' as const }
  }
  if (turnInfo && targetTurn >= 0 && targetTurn < turnInfo.minRollbackTurn) {
    return { ok: false, reason: 'below_min_rollback_turn' as const }
  }
  return { ok: true as const }
}

describe('rollback guard semantics', () => {
  it('rejects rollback below minRollbackTurn', () => {
    const turnInfo: SessionTurnInfo = {
      currentTurn: 10,
      minRollbackTurn: 4,
      turnEndHistoryIndex: new Map([[4, 8], [5, 10]]),
    }

    const result = canRollback(3, turnInfo)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('below_min_rollback_turn')
  })

  it('accepts rollback at minRollbackTurn', () => {
    const turnInfo: SessionTurnInfo = {
      currentTurn: 10,
      minRollbackTurn: 4,
      turnEndHistoryIndex: new Map([[4, 8], [5, 10]]),
    }

    const result = canRollback(4, turnInfo)
    expect(result.ok).toBe(true)
  })

  it('rejects invalid target turn smaller than -1', () => {
    const result = canRollback(-2)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_turn')
  })
})
