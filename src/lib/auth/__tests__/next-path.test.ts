import { describe, expect, it } from 'vitest'
import { safeNextPath } from '../next-path'

describe('safeNextPath', () => {
  it('keeps a plain in-app path, with its query string', () => {
    expect(safeNextPath('/')).toBe('/')
    expect(safeNextPath('/cases/abc123')).toBe('/cases/abc123')
    expect(safeNextPath('/dashboard?range=30d&week=2026-09-06')).toBe('/dashboard?range=30d&week=2026-09-06')
    expect(safeNextPath('/?f=open')).toBe('/?f=open')
  })

  it('falls back to the board for anything that is not a string path', () => {
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath(undefined)).toBe('/')
    expect(safeNextPath('')).toBe('/')
    expect(safeNextPath('cases/abc')).toBe('/')
    expect(safeNextPath('https://nav.towardpcc.com/cases/abc')).toBe('/')
    expect(safeNextPath('javascript:alert(1)')).toBe('/')
  })

  it('rejects every off-site shape, including the ones a string check misses', () => {
    expect(safeNextPath('//evil.example')).toBe('/')
    expect(safeNextPath('//evil.example/phish')).toBe('/')
    expect(safeNextPath('/\\evil.example')).toBe('/')
    expect(safeNextPath('/\\\\evil.example')).toBe('/')
    // The final review's C7: an ASCII tab, CR or LF after the first slash survives
    // `startsWith('//')` but a browser strips it before parsing the Location header.
    expect(safeNextPath('/\t//evil.example')).toBe('/')
    expect(safeNextPath('/\n//evil.example')).toBe('/')
    expect(safeNextPath('/\r//evil.example')).toBe('/')
    expect(safeNextPath('/\t/\\evil.example')).toBe('/')
    // A space is not stripped by the parser, so this stays an in-app path (percent-encoded):
    // harmless, and the browser resolves it on our origin.
    expect(safeNextPath('/ //evil.example')).toBe('/%20//evil.example')
    expect(safeNextPath('/@evil.example')).toBe('/@evil.example')
  })

  it('never returns a path that begins with two slashes or points at the login form', () => {
    expect(safeNextPath('/login')).toBe('/')
    expect(safeNextPath('/login?next=/cases/abc')).toBe('/')
    expect(safeNextPath('/x//y')).toBe('/x//y')
  })

  it('normalises what it returns: no tabs, newlines or backslashes survive', () => {
    for (const input of ['/cases/\tabc', '/cases/abc\n', '/cases\\abc']) {
      const out = safeNextPath(input)
      expect(out).not.toMatch(/[\t\r\n\\]/)
      expect(out.startsWith('/')).toBe(true)
      expect(out.startsWith('//')).toBe(false)
    }
  })
})
