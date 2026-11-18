import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'

const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * Sajikan SPA hasil build. Berkas ber-hash di /assets/ boleh di-cache selamanya; index.html wajib divalidasi ulang
 * agar browser tidak memakai HTML lama yang merujuk bundel yang sudah tidak ada setelah deploy.
 * /assets/* yang tidak ada dijawab 404 (bukan index.html) supaya modul yang gagal dimuat tidak menerima HTML 200.
 */
export function mountStatic(app: Hono<any, any, any>, dist = './dist') {
  app.use('*', async (c, next) => {
    await next()
    if (c.res.status !== 200) return
    if (c.req.path.startsWith('/assets/')) c.header('Cache-Control', IMMUTABLE)
    else if (c.res.headers.get('Content-Type')?.startsWith('text/html')) c.header('Cache-Control', 'no-cache')
  })
  app.use('/*', serveStatic({ root: dist }))
  app.on(['GET', 'HEAD'], '/assets/*', c => c.text('Not found', 404, { 'Cache-Control': 'no-store' }))
  app.get('*', serveStatic({ path: `${dist}/index.html` }))
}
