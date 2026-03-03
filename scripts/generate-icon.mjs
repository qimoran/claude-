/**
 * 将 SVG 图标转换为 PNG 和 ICO 格式
 * 用法: node scripts/generate-icon.mjs
 */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const buildDir = path.resolve(__dirname, '..', 'build')
const svgPath = path.join(buildDir, 'icon.svg')

async function generateIco(pngBuffers) {
  // ICO 文件格式：ICONDIR + ICONDIRENTRY[] + 图像数据
  const images = []
  for (const { size, buffer } of pngBuffers) {
    images.push({ size, data: buffer })
  }

  // ICONDIR header: 6 bytes
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)           // Reserved
  header.writeUInt16LE(1, 2)           // Type: 1 = ICO
  header.writeUInt16LE(images.length, 4) // Count

  // 计算偏移量
  const entrySize = 16
  let offset = 6 + images.length * entrySize

  const entries = []
  for (const img of images) {
    const entry = Buffer.alloc(entrySize)
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 0) // Width (0 = 256)
    entry.writeUInt8(img.size >= 256 ? 0 : img.size, 1) // Height (0 = 256)
    entry.writeUInt8(0, 2)             // Color palette
    entry.writeUInt8(0, 3)             // Reserved
    entry.writeUInt16LE(1, 4)          // Color planes
    entry.writeUInt16LE(32, 6)         // Bits per pixel
    entry.writeUInt32LE(img.data.length, 8) // Image data size
    entry.writeUInt32LE(offset, 12)    // Offset to image data
    entries.push(entry)
    offset += img.data.length
  }

  return Buffer.concat([header, ...entries, ...images.map(i => i.data)])
}

async function main() {
  const svgBuffer = fs.readFileSync(svgPath)
  console.log('读取 SVG:', svgPath)

  // 生成多种尺寸的 PNG
  const sizes = [256, 128, 64, 48, 32, 16]
  const pngBuffers = []

  for (const size of sizes) {
    const pngBuffer = await sharp(svgBuffer, { density: 300 })
      .resize(size, size)
      .png()
      .toBuffer()
    pngBuffers.push({ size, buffer: pngBuffer })
    console.log(`  生成 ${size}x${size} PNG`)
  }

  // 保存 256x256 PNG 作为主图标
  const png256 = pngBuffers.find(p => p.size === 256)
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png256.buffer)
  console.log('保存 icon.png (256x256)')

  // 生成 ICO（包含多个尺寸）
  const icoBuffer = await generateIco(pngBuffers)
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer)
  console.log('保存 icon.ico')

  // 生成 16x16 的 base64 PNG（用于托盘图标）
  const tray16 = pngBuffers.find(p => p.size === 16)
  const trayBase64 = tray16.buffer.toString('base64')
  console.log('\n托盘图标 base64（16x16）:')
  console.log(trayBase64)

  // 同时生成 32x32 的托盘图标（Windows 推荐用更大的）
  const tray32 = pngBuffers.find(p => p.size === 32)
  const tray32Base64 = tray32.buffer.toString('base64')
  console.log('\n托盘图标 base64（32x32，推荐）:')
  console.log(tray32Base64)

  // 保存 base64 到文件便于复制
  fs.writeFileSync(
    path.join(buildDir, 'tray-icon-base64.txt'),
    `// 16x16\n${trayBase64}\n\n// 32x32\n${tray32Base64}\n`
  )
  console.log('\nbase64 已保存到 build/tray-icon-base64.txt')

  console.log('\n完成!')
}

main().catch(err => {
  console.error('生成图标失败:', err)
  process.exit(1)
})
