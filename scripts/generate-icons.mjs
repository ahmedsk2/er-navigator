/**
 * The app icons. `node scripts/generate-icons.mjs`.
 *
 * Phase 11: the icons are the app's mark — the medical cross drawn as parallel paths, from the
 * Envato Elements logo Ahmed chose ("Medical Cross Logo — Healthcare & Hospital Health", 3ab2ou),
 * white on the app's deep teal (`--color-accent-deep`, #0f4d5c) instead of the template's red.
 * The three outlines are read from `src/components/brand/mark-paths.json`, the same file the
 * header's `Mark` draws from, so the home-screen icon and the header cannot disagree. (Phase 9's
 * icon was a placeholder heart; `sharp` came in then as a devDependency, pinned to 0.35.4, and
 * nothing at runtime imports it.)
 *
 * Outputs (regenerating them is idempotent; commit the result):
 *   public/icons/icon-192.png        192 maskable + any
 *   public/icons/icon-512.png        512 maskable + any
 *   public/apple-touch-icon.png      180, iOS home screen
 *   public/favicon.ico               32x32 PNG in an ICO container, for the browser tab
 *
 * Maskable means everything that must survive a circular crop sits inside the middle 80% (the
 * W3C safe zone). The cross's farthest points are its arm ends' corners, about 0.53 of its width
 * from the centre, so a cross 56% of the canvas wide keeps them at 0.30 — inside the 0.40 circle
 * with room. The Apple icon is painted flat to the edge (iOS rounds it) with a slightly larger
 * cross. The tab favicon is the rounded badge with the bars grown, because at 32 px a bar a
 * twelfth of the cross wide is a single pixel.
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
 * @param {{ glyph: number, radius: number | null, grow: number }} opts
 *   `glyph` is the cross's width as a fraction of the canvas; `radius` rounds the painted square
 *   as a fraction of its edge, or `null` to paint the canvas flat; `grow` widens every bar by a
 *   stroke of its own colour, in units of the cross's 48-unit grid.
 */
function markSvg(size, { glyph, radius, grow }) {
  const box = size * glyph
  const scale = box / PATHS.viewBox
  const offset = (size - box) / 2
  const paint =
    radius == null
      ? `<rect width="${size}" height="${size}" fill="${BADGE}"/>`
      : `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${BADGE}"/>`
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      paint +
      `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="${INK}" stroke="${INK}" ` +
      `stroke-width="${grow}" stroke-linejoin="miter">` +
      PATHS.cross.map((d) => `<path d="${d}"/>`).join('') +
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

// Maskable: the teal fills the canvas and the cross stays inside the 80% safe circle.
const MASKABLE = { glyph: 0.56, radius: null, grow: 0.4 }
write('public/icons/icon-192.png', await png(192, MASKABLE))
write('public/icons/icon-512.png', await png(512, MASKABLE))
// iOS rounds the corners itself, so the square is painted flat to the edge; a rounded tile here
// would show its own transparent corners through Apple's mask.
write('public/apple-touch-icon.png', await png(180, { glyph: 0.62, radius: null, grow: 0.5 }))
// The tab favicon is the rounded badge itself, never masked and tiny: a larger cross, bars grown.
write('public/favicon.ico', encodeIco(32, await png(32, { glyph: 0.78, radius: 0.22, grow: 1 })))
