const fs = require('fs')
const path = require('path')

// 生成一个简洁的 256x256 PNG 图标（紫色渐变圆形 + "C" 字母）
// 使用纯 Buffer 操作生成 PNG，无需第三方库

function createPNG(width, height, pixels) {
  const crc32Table = (() => {
    const table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      }
      table[i] = c
    }
    return table
  })()

  function crc32(buf) {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < buf.length; i++) {
      crc = crc32Table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
  }

  function makeChunk(type, data) {
    const typeBytes = Buffer.from(type)
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const combined = Buffer.concat([typeBytes, data])
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(combined))
    return Buffer.concat([len, combined, checksum])
  }

  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // IDAT - raw pixel data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const offset = y * (1 + width * 4) + 1 + x * 4
      rawData[offset] = pixels[idx]     // R
      rawData[offset + 1] = pixels[idx + 1] // G
      rawData[offset + 2] = pixels[idx + 2] // B
      rawData[offset + 3] = pixels[idx + 3] // A
    }
  }

  // Use zlib to compress
  const zlib = require('zlib')
  const compressed = zlib.deflateSync(rawData)

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrChunk = makeChunk('IHDR', ihdr)
  const idatChunk = makeChunk('IDAT', compressed)
  const iendChunk = makeChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk])
}

function generateIcon(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const radius = size * 0.42
  const innerRadius = size * 0.28

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist <= radius) {
        // 紫色渐变背景圆
        const t = dist / radius
        const r = Math.round(124 * (1 - t * 0.3) + 80 * t * 0.3)
        const g = Math.round(58 * (1 - t * 0.5))
        const b = Math.round(237 * (1 - t * 0.15) + 180 * t * 0.15)

        // 抗锯齿边缘
        const edgeAlpha = Math.min(1, Math.max(0, (radius - dist) * 2))

        // "C" 字形：外圆环右侧开口
        const angle = Math.atan2(dy, dx)
        const normalizedAngle = ((angle + Math.PI * 2) % (Math.PI * 2))
        const isOpening = normalizedAngle > -Math.PI / 4 && normalizedAngle < Math.PI / 4

        if (dist > innerRadius && isOpening) {
          // 开口区域 - 透明
          pixels[idx] = 0
          pixels[idx + 1] = 0
          pixels[idx + 2] = 0
          pixels[idx + 3] = 0
        } else if (dist > innerRadius) {
          // C 字环形部分 - 白色
          const ringAlpha = Math.min(1, Math.max(0, (dist - innerRadius) * 2)) *
                           Math.min(1, Math.max(0, (radius - dist) * 2))
          pixels[idx] = 255
          pixels[idx + 1] = 255
          pixels[idx + 2] = 255
          pixels[idx + 3] = Math.round(255 * ringAlpha * edgeAlpha)
        } else {
          // 内部填充 - 紫色渐变
          pixels[idx] = r
          pixels[idx + 1] = g
          pixels[idx + 2] = b
          pixels[idx + 3] = Math.round(255 * edgeAlpha)
        }
      } else {
        // 透明
        pixels[idx] = 0
        pixels[idx + 1] = 0
        pixels[idx + 2] = 0
        pixels[idx + 3] = 0
      }
    }
  }

  return createPNG(size, size, pixels)
}

// 生成 256x256 PNG
const buildDir = path.join(__dirname, '..', 'build')
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true })

const png256 = generateIcon(256)
fs.writeFileSync(path.join(buildDir, 'icon.png'), png256)
console.log('Generated build/icon.png (256x256)')

// 生成 ICO (包含 16, 32, 48, 256)
const pngToIco = require('png-to-ico').default || require('png-to-ico')
pngToIco(path.join(buildDir, 'icon.png'))
  .then(buf => {
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), buf)
    console.log('Generated build/icon.ico')
  })
  .catch(err => console.error('ICO generation failed:', err))
