import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { connect } from './db.ts'
import { createApp } from './app.ts'
import { migrateDatabase } from './migrate.ts'
import { createUser } from './create-user.ts'
import { users } from './schema.ts'
import { WhatsAppService } from './whatsapp.ts'
if (!process.env.DATABASE_URL || !process.env.APP_ORIGIN) throw new Error('DATABASE_URL dan APP_ORIGIN wajib diisi')
if (process.env.NODE_ENV === 'production' && new URL(process.env.APP_ORIGIN).protocol !== 'https:') throw new Error('Production APP_ORIGIN harus HTTPS')
await migrateDatabase(process.env.DATABASE_URL)
const { db, sql } = connect(process.env.DATABASE_URL)
if (process.env.INITIAL_ADMIN_EMAIL && !(await db.select({ id: users.id }).from(users).limit(1)).length) {
  await createUser(db, process.env.INITIAL_ADMIN_EMAIL, process.env.INITIAL_ADMIN_NAME ?? 'Administrator SDM', process.env.INITIAL_ADMIN_PASSWORD ?? '', 'admin')
}
const whatsapp = new WhatsAppService(db)
await whatsapp.restore()
const app = createApp(db, { origin: new URL(process.env.APP_ORIGIN).origin, production: process.env.NODE_ENV === 'production' }, whatsapp)
app.use('/*', serveStatic({ root: './dist' }))
app.get('*', serveStatic({ path: './dist/index.html' }))
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8788), hostname: '0.0.0.0' }, info => console.log(`KPPU HR listening on ${info.port}`))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(async () => { await whatsapp.close(); await sql.end(); process.exit(0) }))
