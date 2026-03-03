import { describe, it, expect } from 'vitest'
import { createSession } from './sessionStorage'

describe('createSession', () => {
  it('should create a session with correct defaults', () => {
    const session = createSession(1)
    expect(session.id).toContain('session-')
    expect(session.title).toBe('会话 1')
    expect(session.model).toBe('')
    expect(session.messages).toEqual([])
    expect(session.autoIncludeGitStatus).toBe(false)
    expect(session.lastGitStatus).toBe('')
    expect(session.workingDirectory).toBeUndefined()
  })

  it('should set workingDirectory when provided', () => {
    const session = createSession(2, '/path/to/project')
    expect(session.workingDirectory).toBe('/path/to/project')
    expect(session.title).toBe('会话 2')
  })

  it('should generate unique session IDs', () => {
    const s1 = createSession(1)
    const s2 = createSession(2)
    expect(s1.id).not.toBe(s2.id)
  })

})
