/**
 * The app icons (Phase 9). `node scripts/generate-icons.mjs`.
 *
 * Until now the icon was a clock drawn pixel by pixel with a signed-distance field, because the
 * repo had no image library. Phase 9 gives the app a real mark — the heart with an ECG trace
 * through it, `src/components/brand/Mark.tsx` — and the icons have to be that same mark or the
 * home screen and the header disagree. Rasterising a two-path SVG by hand is not worth writing,
 * so `sharp` comes in as a devDependency, pinned to 0.35.4, the version already in the lockfile
 * (Next resolves it for image optimisation). Nothing at runtime imports it.
 *
 * The mark is white on a rounded square of `--color-accent` (#1f7a8c, design/tokens.md), which
 * is also the manifest's `theme_color`. The paths below are a copy of the ones in Mark.tsx, with
 * one deliberate difference: on screen the heart is an outline with the trace running through the
 * hollow, and at 32 px that outline and that trace fuse into a blob. So the icon is the solid
 * counterpart — a filled white heart with the trace knocked out of it in the accent — which is
 * the same shape and survives a browser tab. Two files, one mark; a screenshot of the header
 * beside the installed icon is the check.
 *
 * Outputs (regenerating them is idempotent; commit the result):
 *   public/icons/icon-192.png        192 maskable + any
 *   public/icons/icon-512.png        512 maskable + any
 *   public/apple-touch-icon.png      180, iOS home screen
 *   public/favicon.ico               32x32 PNG in an ICO container, for the browser tab
 *
 * Maskable means everything that must survive a circular crop sits inside the middle 80% (the
 * W3C safe zone). The mark's drawn extent is very nearly as wide as it is tall, so its diagonal
 * is about the size of its box: a box of 74% of the canvas puts the whole mark inside the 80%
 * circle with room to spare. The Apple icon is never masked by the manifest's rules — iOS applies
 * its own rounding — so it fills the square edge to edge and carries a slightly larger mark.
 */
import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ACCENT = '#1f7a8c' // --color-accent
const INK = '#ffffff' // --color-panel

/** The mark, on the 24 x 24 grid of src/components/brand/Mark.tsx. */
const HEART = 'M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 6.5-7 11-7 11z'
const TRACE = 'M6 12h3l1.5-3 2 6 1.5-3H18'
/**
 * The drawn shape sits a little low in its 24-unit box (the heart's point reaches y 21, its
 * shoulders start at 5.5), so it is lifted by this much to look centred rather than measured.
 */
const OPTICAL_LIFT = 1.25

/**
 * @param {number} size canvas edge in px
 * @param {{ glyph: number, tile: number, radius: number, trace: number }} opts
 *   `glyph` is the mark's box as a fraction of the canvas, `tile` the painted square's edge as a
 *   fraction of the canvas (1 fills it), `radius` the corner radius as a fraction of that square,
 *   `trace` the ECG stroke width on the 24-unit grid — wider on the small icons, where a hairline
 *   would disappear into the antialiasing.
 */
function markSvg(size, { glyph, tile, radius, trace }) {
  const square = size * tile
  const inset = (size - square) / 2
  const box = size * glyph
  const scale = box / 24
  const x = (size - box) / 2
  const y = (size - box) / 2 - OPTICAL_LIFT * scale
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect x="${inset}" y="${inset}" width="${square}" height="${square}" rx="${square * radius}" fill="${ACCENT}"/>` +
      `<g transform="translate(${x} ${y}) scale(${scale})">` +
      // The stroke on the heart is only there to round its point the way the outline mark does.
      `<path d="${HEART}" fill="${INK}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="${TRACE}" fill="none" stroke="${ACCENT}" stroke-width="${trace}" stroke-linecap="round" stroke-linejoin="round"/>` +
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

// Maskable: the rounded tile fills the canvas and the mark stays inside the 80% safe circle.
const MASKABLE = { glyph: 0.74, tile: 1, radius: 0.115, trace: 2.2 }
write('public/icons/icon-192.png', await png(192, MASKABLE))
write('public/icons/icon-512.png', await png(512, MASKABLE))
// iOS rounds the corners itself, so the square is painted flat to the edge; a rounded tile here
// would show its own transparent corners through Apple's mask.
write('public/apple-touch-icon.png', await png(180, { glyph: 0.78, tile: 1, radius: 0, trace: 2.2 }))
// The tab favicon is never masked and is tiny, so the tile is inset and the mark is as large as
// the rounding allows, with the trace opened up to survive 32 px.
write('public/favicon.ico', encodeIco(32, await png(32, { glyph: 0.8, tile: 0.94, radius: 0.235, trace: 2.4 })))
