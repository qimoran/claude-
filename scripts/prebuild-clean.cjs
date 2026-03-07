const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function killProcessOnWindows(imageName) {
  if (process.platform !== 'win32') return
  try {
    execFileSync('taskkill', ['/IM', imageName, '/F', '/T'], { stdio: 'ignore' })
  } catch {
    // ignore: process may not exist
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function removeWithRetry(targetPath, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      const code = error && typeof error === 'object' ? error.code : ''
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY'
      if (!retryable || i === attempts - 1) throw error
      await sleep(300 * (i + 1))
    }
  }
}

async function resolveReleaseDir(root) {
  try {
    const packageJsonPath = path.join(root, 'package.json')
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8')
    const packageJson = JSON.parse(packageJsonContent)
    const outputDir = packageJson?.build?.directories?.output
    if (typeof outputDir === 'string' && outputDir.trim()) {
      return path.join(root, outputDir.trim())
    }
  } catch {
    // ignore package.json parse failure
  }
  return path.join(root, 'release')
}

async function main() {
  const root = path.resolve(__dirname, '..')
  const releaseDir = await resolveReleaseDir(root)
  const cleanupTargets = [
    path.join(root, 'dist'),
    path.join(root, 'dist-electron'),
    releaseDir,
    path.join(root, 'release-alt'),
    path.join(root, 'release-alt2'),
    path.join(root, 'release-alt3')
  ]

  killProcessOnWindows('Claude Code GUI.exe')

  for (const targetPath of new Set(cleanupTargets)) {
    try {
      await removeWithRetry(targetPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isLocked = /EPERM|EBUSY|ENOTEMPTY/i.test(message)
      if (!isLocked) {
        throw error
      }
      console.warn(`[prebuild-clean] skip locked path ${targetPath}: ${message}`)
    }
  }
}

main().catch((error) => {
  console.error('[prebuild-clean] failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
