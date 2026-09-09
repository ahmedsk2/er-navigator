/**
 * The app icons, drawn in code (Phase 7). `node scripts/generate-icons.mjs`.
 *
 * No image library and no logo from any template: the mark is the elapsed clock the whole app is
 * about — a white ring with an hour and a minute hand — knocked out of a rounded square in the
 * accent colour (`--color-accent`, #1f7a8c, design/tokens.md). It is rasterised here by hand,
 * supersampled 4x for smooth edges, and written as a PNG with nothing but `node:zlib`.
 *
 * Outputs (regenerating them is idempotent; commit the result):
 *   public/icons/icon-192.png        192 maskable + any
 *   public/icons/icon-512.png        512 maskable + any
 *   public/apple-touch-icon.png      180, iOS home screen (no maskable concept, so no safe area)
 *   public/favicon.ico               32x32 PNG in an ICO container, for the browser tab
 *
 * Maskable means the whole square is painted and everything that must survive a circular crop
 * sits inside the middle 80% (the W3C safe zone). That is why the glyph is drawn at 52% of the
 * canvas here and rather larger on the Apple icon, which is never masked.
 */
import { deflateSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ACCENT = [0x1f, 0x7a, 0x8c] // --color-accent
const INK = [0xff, 0xff, 0xff]

/** Supersampling factor. 4 is enough that no edge on a 192 px icon reads as a staircase. */
const SS = 4

// --- geometry ----------------------------------------------------------------------------------

/** Signed distance to a rounded square centred on (cx, cy), negative inside. */
function roundedSquare(x, y, cx, cy, half, radius) {
  const dx = Math.abs(x - cx) - (half - radius)
  const dy = Math.abs(y - cy) - (half - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

/** Signed distance to a line segment, negative inside a stroke of the given half-width. */
function segment(x, y, ax, ay, bx, by, halfWidth) {
  const vx = bx - ax
  const vy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)))
  return Math.hypot(x - (ax + t * vx), y - (ay + t * vy)) - halfWidth
}

/**
 * The mark. `glyph` is the fraction of the canvas the clock occupies; `bleed` true paints the
 * whole square (maskable), false insets the tile so a transparent margin remains.
 */
function drawIcon(size, { glyph, bleed }) {
  const pixels = Buffer.alloc(size * size * 4)
  const s = size * SS
  const c = s / 2
  const tileHalf = bleed ? c : c * 0.94
  const tileRadius = tileHalf * 0.235
  const ringOuter = (s * glyph) / 2
  const ringWidth = ringOuter * 0.155
  const ringInner = ringOuter - ringWidth
  const handWidth = ringWidth * 0.52
  // Twelve and three: a short hand up, a long hand right. The watch-ad "ten past ten" pose makes
  // a symmetrical V that reads as a tick at 32 px; this reads as a clock at every size.
  const hourAngle = -Math.PI / 2
  const minuteAngle = 0
  const hourLen = ringInner * 0.5
  const minuteLen = ringInner * 0.74

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const x = px * SS + sx + 0.5
          const y = py * SS + sy + 0.5
          const inTile = roundedSquare(x, y, c, c, tileHalf, tileRadius) <= 0
          if (!inTile) continue

          const fromCentre = Math.hypot(x - c, y - c)
          const onRing = fromCentre <= ringOuter && fromCentre >= ringInner
          const onHour =
            segment(x, y, c, c, c + Math.cos(hourAngle) * hourLen, c + Math.sin(hourAngle) * hourLen, handWidth) <= 0
          const onMinute =
            segment(
              x,
              y,
              c,
              c,
              c + Math.cos(minuteAngle) * minuteLen,
              c + Math.sin(minuteAngle) * minuteLen,
              handWidth,
            ) <= 0
          const ink = onRing || onHour || onMinute
          const [cr, cg, cb] = ink ? INK : ACCENT
          r += cr
          g += cg
          b += cb
          a += 255
        }
      }
      const samples = SS * SS
      const i = (py * size + px) * 4
      if (a === 0) continue
      // Premultiplied average over the covered samples, so the tile's edge fades cleanly.
      const covered = a / 255
      pixels[i] = Math.round(r / covered)
      pixels[i + 1] = Math.round(g / covered)
      pixels[i + 2] = Math.round(b / covered)
      pixels[i + 3] = Math.round(a / samples)
    }
  }
  return pixels
}

// --- PNG ---------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** RGBA8 PNG, filter type 0 on every row (the images are small; the gain is not worth the code). */
function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A single-image ICO wrapping a PNG, which every browser since IE11 reads. */
function encodeIco(size, png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // one image
  const entry = Buffer.alloc(16)
  entry[0] = size < 256 ? size : 0
  entry[1] = size < 256 ? size : 0
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)
  return Buffer.concat([header, entry, png])
}

// --- write -------------------------------------------------------------------------------------

function write(path, buffer) {
  const full = resolve(ROOT, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, buffer)
  console.log(`${path}  ${buffer.length} bytes`)
}

const icon = (size, options) => encodePng(size, drawIcon(size, options))

write('public/icons/icon-192.png', icon(192, { glyph: 0.52, bleed: true }))
write('public/icons/icon-512.png', icon(512, { glyph: 0.52, bleed: true }))
// iOS crops the corners itself and never masks, so the glyph can be bigger and the tile bleeds.
write('public/apple-touch-icon.png', icon(180, { glyph: 0.66, bleed: true }))
write('public/favicon.ico', encodeIco(32, icon(32, { glyph: 0.74, bleed: false })))
