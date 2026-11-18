import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { mountStatic } from '../server/static.ts'

let dir = ''
let app: Hono
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kppu-static-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
  writeFileSync(join(dir, 'assets', 'index-ABC123.js'), 'export default 1')
  app = new Hono()
  app.use('*', secureHeaders())
  app.all('/api/*', c => c.json({ error: 'Endpoint tidak ditemukan' }, 404))
  // serveStatic memakai root relatif terhadap cwd.
  mountStatic(app, relative(process.cwd(), dir))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('static serving', () => {
  test('index.html di / dan SPA fallback tidak di-cache', async () => {
    for (const path of ['/', '/index.html', '/pegawai/123']) {
      const res = await app.request(path)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/text\/html/)
      expect(res.headers.get('cache-control')).toBe('no-cache')
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    }
  })
  test('aset ber-hash immutable', async () => {
    const res = await app.request('/assets/index-ABC123.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/javascript/)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })
  test('aset yang hilang 404, bukan index.html', async () => {
    for (const path of ['/assets/index-OLD.js', '/assets/nope/x.css', '/assets/']) {
      const res = await app.request(path)
      expect(res.status).toBe(404)
      expect(res.headers.get('content-type')).not.toMatch(/text\/html/)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })
  test('/api tetap 404 JSON', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Endpoint tidak ditemukan' })
  })
})
