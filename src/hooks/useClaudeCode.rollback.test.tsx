import { describe, it, expect } from 'vitest'
import type { Message } from './useClaudeCode'

function resolveRollbackTargetByMessage(msgs: Message[], msgIndex: number): { targetTurn: number; cutIndex: number } {
  const msg = msgs[msgIndex]
  if (msg.role === 'user') {
    const userCountBefore = msgs.slice(0, msgIndex).filter(m => m.role === 'user').length
    return { targetTurn: userCountBefore - 1, cutIndex: msgIndex }
  }

  const userCountBeforeOrAt = msgs.slice(0, msgIndex + 1).filter(m => m.role === 'user').length
  const targetTurn = userCountBeforeOrAt - 1
  let cutIndex = msgIndex + 1
  while (cutIndex < msgs.length && msgs[cutIndex].role !== 'user') cutIndex++
  return { targetTurn, cutIndex }
}

describe('rollbackToMessage semantics', () => {
  const baseMessages: Message[] = [
    { id: 'u0', role: 'user', content: 'u0', blocks: [], timestamp: new Date() },
    { id: 'a0', role: 'assistant', content: 'a0', blocks: [], timestamp: new Date() },
    { id: 'u1', role: 'user', content: 'u1', blocks: [], timestamp: new Date() },
    { id: 'a1', role: 'assistant', content: 'a1', blocks: [], timestamp: new Date() },
  ]

  it('clicking user message rolls back to before that message', () => {
    const res = resolveRollbackTargetByMessage(baseMessages, 2)
    expect(res).toEqual({ targetTurn: 0, cutIndex: 2 })
  })

  it('clicking assistant message rolls back to end of that turn', () => {
    const res = resolveRollbackTargetByMessage(baseMessages, 1)
    expect(res).toEqual({ targetTurn: 0, cutIndex: 2 })
  })

  it('clicking first user message maps to full rollback', () => {
    const res = resolveRollbackTargetByMessage(baseMessages, 0)
    expect(res).toEqual({ targetTurn: -1, cutIndex: 0 })
  })
})
