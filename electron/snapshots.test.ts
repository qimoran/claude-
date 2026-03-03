import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveSnapshot, rollbackSnapshots, deleteSnapshots } from './snapshots'

describe('rollbackSnapshots', () => {
  const sessionId = 'session-test-snapshots'
  let tempDir = ''
  let fileA = ''
  let fileB = ''

  beforeEach(() => {
    deleteSnapshots(sessionId)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-snapshots-'))
    fileA = path.join(tempDir, 'a.txt')
    fileB = path.join(tempDir, 'b.txt')
    fs.writeFileSync(fileA, 'new-a', 'utf-8')
    fs.writeFileSync(fileB, 'new-b', 'utf-8')

    saveSnapshot(sessionId, {
      filePath: fileA,
      existed: true,
      content: 'old-a',
      toolName: 'edit_file',
      toolId: '1',
      turnNumber: 2,
    })
    saveSnapshot(sessionId, {
      filePath: fileB,
      existed: true,
      content: 'old-b',
      toolName: 'edit_file',
      toolId: '2',
      turnNumber: 2,
    })
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    deleteSnapshots(sessionId)
    vi.restoreAllMocks()
  })

  it('retains failed snapshots for retry and can succeed later', () => {
    const originalWrite = fs.writeFileSync
    const failOnce = vi.spyOn(fs, 'writeFileSync').mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      const target = args[0]
      if (typeof target === 'string' && target === fileA) {
        failOnce.mockImplementation(originalWrite)
        throw new Error('simulated write failure')
      }
      return originalWrite(...args)
    })

    const first = rollbackSnapshots(sessionId, 1)
    expect(first.errors.length).toBe(1)
    expect(first.restored).toBe(1)
    expect(first.retainedSnapshots).toBe(1)
    expect(fs.readFileSync(fileB, 'utf-8')).toBe('old-b')
    expect(fs.readFileSync(fileA, 'utf-8')).toBe('new-a')

    const second = rollbackSnapshots(sessionId, 1)
    expect(second.errors).toEqual([])
    expect(second.restored).toBe(1)
    expect(second.retainedSnapshots).toBe(0)
    expect(fs.readFileSync(fileA, 'utf-8')).toBe('old-a')
  })
})
