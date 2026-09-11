/**
 * The app icons. `node scripts/generate-icons.mjs`.
 *
 * Phase 11: the icons are Ahmed's mark — a heartbeat trace rising into a medical cross and running
 * on into an arrow, white on a badge of `--color-accent-deep` (#0f4d5c), made with Envato's AI
 * generator (`design/brand/er-navigator-logo.envato.svg`) and redrawn as three strokes on a 48-unit
 * grid. The paths are read from `src/components/brand/mark-paths.json`, the same file the header's
 * `Mark` draws from, so the home-screen icon and the header cannot disagree. (Phase 9's icon was a
 * heart with a trace; `sharp` came in then as a devDependency, pinned to 0.35.4, and nothing at
 * runtime imports it.)
 *
 * Outputs (regenerating them is idempotent; commit the result):
 *   public/icons/icon-192.png        192 maskable + any
 *   public/icons/icon-512.png        512 maskable + any
 *   public/apple-touch-icon.png      180, iOS home screen
 *   public/favicon.ico               32x32 PNG in an ICO container, for the browser tab
 *
 * Maskable means everything that must survive a circular crop sits inside the middle 80% (the
 * W3C safe zone): the canvas is painted edge to edge in the badge's teal, the drawing is set at
 * 70% of the canvas and centred, and the trace's baseline is carried out to the left edge the way
 * it leaves the badge in the logo — if a mask trims it, it just enters from further off. The
 * Apple icon is painted flat to the edge (iOS rounds it) with a slightly larger drawing. The tab
 * favicon is the badge itself, rounded, with the stroke opened up to survive 32 px.
 */
import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PATHS = JSON.parse(readFileSync(resolve(ROOT, 'src/components/brand/mark-paths.json'), 'utf8'))

const BADGE = '#0f4d5c' // --color-accent-deep
const INK = '#ffffff' // --color-panel

/**
 * @param {number} size canvas edge in px
 * @param {{ glyph: number, radius: number | null, stroke: number, lead: boolean }} opts
 *   `glyph` is the 48-unit drawing's box as a fraction of the canvas; `radius` rounds the painted
 *   square as a fraction of its edge, or `null` to paint the canvas flat; `stroke` is the line
 *   width on the 48-unit grid; `lead` carries the baseline out to the canvas's left edge.
 */
function markSvg(size, { glyph, radius, stroke, lead }) {
  const box = size * glyph
  const scale = box / PATHS.viewBox
  const offset = (size - box) / 2
  const paint =
    radius == null
      ? `<rect width="${size}" height="${size}" fill="${BADGE}"/>`
      : `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${BADGE}"/>`
  // In the 48-unit frame, the canvas's left edge is at -offset/scale.
  const leadIn = lead ? `<path d="M${(-offset / scale - 2).toFixed(2)} 25.4H1.1"/>` : ''
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      paint +
      `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${INK}" ` +
      `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">` +
      leadIn +
      `<path d="${PATHS.ecg}"/><path d="${PATHS.arrow}"/><path d="${PATHS.cross}"/>` +
      `</g></svg>`,
    'utf8',
  )
}

const png = (size, opts) => sharp(markSvg(size, opts)).png({ compressionLevel: 9 }).toBuffer()

/** A single-image ICO wrapping a PNG, which every browser since IE11 reads. */
function encodeIco(size, image) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // one image
  const entry = Buffer.alloc(16)
  entry[0] = size < 256 ? size : 0
  entry[1] = size < 256 ? size : 0
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(image.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)
  return Buffer.concat([header, entry, image])
}

function write(path, buffer) {
  const full = resolve(ROOT, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, buffer)
  console.log(`${path}  ${buffer.length} bytes`)
}

// Maskable: the teal fills the canvas and the drawing stays inside the 80% safe circle.
const MASKABLE = { glyph: 0.7, radius: null, stroke: 2.6, lead: true }
write('public/icons/icon-192.png', await png(192, MASKABLE))
write('public/icons/icon-512.png', await png(512, MASKABLE))
// iOS rounds the corners itself, so the square is painted flat to the edge; a rounded tile here
// would show its own transparent corners through Apple's mask.
write('public/apple-touch-icon.png', await png(180, { glyph: 0.76, radius: null, stroke: 2.6, lead: true }))
// The tab favicon is the badge itself, never masked and tiny: the drawing fills it, thicker.
write('public/favicon.ico', encodeIco(32, await png(32, { glyph: 1, radius: 0.21, stroke: 3.4, lead: false })))
