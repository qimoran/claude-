import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { snapshotBashTargets } from './tools'
import type { FileSnapshot } from './types'

describe('snapshotBashTargets', () => {
  let cwd = ''
  let src = ''
  let dest = ''
  let target = ''
  let snapshots: FileSnapshot[] = []

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-tools-'))
    src = path.join(cwd, 'source file.txt')
    dest = path.join(cwd, 'dest file.txt')
    target = path.join(cwd, 'redirect output.txt')
    fs.writeFileSync(src, 'src-old', 'utf-8')
    fs.writeFileSync(dest, 'dest-old', 'utf-8')
    fs.writeFileSync(target, 'redirect-old', 'utf-8')
    snapshots = []
  })

  afterEach(() => {
    try {
      fs.rmSync(cwd, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  const saveSnapshot = (_sid: string, snapshot: FileSnapshot) => {
    snapshots.push(snapshot)
  }

  it('captures both source and destination for quoted mv overwrite', () => {
    snapshotBashTargets(
      `mv "${path.basename(src)}" "${path.basename(dest)}"`,
      cwd,
      { sessionId: 's1', turnNumber: 1, toolId: 't1' },
      saveSnapshot,
    )

    const files = snapshots.map(s => s.filePath).sort()
    expect(files).toEqual([dest, src].sort())
  })

  it('captures quoted overwrite redirection target', () => {
    snapshotBashTargets(
      `echo hi > "${path.basename(target)}"`,
      cwd,
      { sessionId: 's1', turnNumber: 1, toolId: 't1' },
      saveSnapshot,
    )

    expect(snapshots.some(s => s.filePath === target)).toBe(true)
  })

  it('captures wildcard delete targets', () => {
    const f1 = path.join(cwd, 'a.log')
    const f2 = path.join(cwd, 'b.log')
    fs.writeFileSync(f1, '1', 'utf-8')
    fs.writeFileSync(f2, '2', 'utf-8')

    snapshotBashTargets(
      'rm *.log',
      cwd,
      { sessionId: 's1', turnNumber: 1, toolId: 't1' },
      saveSnapshot,
    )

    const files = snapshots.map(s => s.filePath)
    expect(files).toContain(f1)
    expect(files).toContain(f2)
  })
})
