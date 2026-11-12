import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { connect } from './db.ts'
import { createApp } from './app.ts'
import { migrateDatabase } from './migrate.ts'
import { createUser } from './create-user.ts'
import { auditEvents, sessions, users } from './schema.ts'
import { WhatsAppService } from './whatsapp.ts'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
if (!process.env.DATABASE_URL || !process.env.APP_ORIGIN) throw new Error('DATABASE_URL dan APP_ORIGIN wajib diisi')
if (process.env.NODE_ENV === 'production' && new URL(process.env.APP_ORIGIN).protocol !== 'https:') throw new Error('Production APP_ORIGIN harus HTTPS')
await migrateDatabase(process.env.DATABASE_URL)
const { db, sql } = connect(process.env.DATABASE_URL)
if (process.env.INITIAL_ADMIN_EMAIL && !(await db.select({ id: users.id }).from(users).limit(1)).length) {
  await createUser(db, process.env.INITIAL_ADMIN_EMAIL, process.env.INITIAL_ADMIN_NAME ?? 'Administrator SDM', process.env.INITIAL_ADMIN_PASSWORD ?? '', 'superadmin')
}
if (process.env.SUPERADMIN_EMAIL) {
  const activeSuperadmins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, 'superadmin'), eq(users.active, true))).limit(1)
  if (!activeSuperadmins.length) {
    const email = process.env.SUPERADMIN_EMAIL.toLowerCase().trim()
    const [target] = await db.select().from(users).where(eq(users.email, email))
    if (!target?.active) throw new Error('SUPERADMIN_EMAIL harus cocok dengan akun aktif yang sudah ada')
    await db.transaction(async tx => {
      await tx.update(users).set({ role: 'superadmin', offices: null }).where(eq(users.id, target.id))
      await tx.delete(sessions).where(eq(sessions.userId, target.id))
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: target.id, action: 'user.bootstrap-superadmin', revision: 0, reason: 'Promosi awal dari konfigurasi SUPERADMIN_EMAIL', details: { userId: target.id, email } })
    })
    console.log('Configured initial Superadmin account; sign in again to refresh permissions')
  }
}
const whatsapp = new WhatsAppService(db)
await whatsapp.restore()
const app = createApp(db, { origin: new URL(process.env.APP_ORIGIN).origin, production: process.env.NODE_ENV === 'production' }, whatsapp)
app.use('/*', serveStatic({ root: './dist' }))
app.get('*', serveStatic({ path: './dist/index.html' }))
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8788), hostname: '0.0.0.0' }, info => console.log(`KPPU HR listening on ${info.port}`))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(async () => { await whatsapp.close(); await sql.end(); process.exit(0) }))
