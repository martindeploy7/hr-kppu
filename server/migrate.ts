import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { connect } from './db.ts'
export async function migrateDatabase(url: string) {
  const { db, sql } = connect(url)
  try { await migrate(db, { migrationsFolder: './drizzle' }) } finally { await sql.end() }
}
if (process.argv[1]?.endsWith('/migrate.ts') || process.argv[1]?.endsWith('/migrate.js')) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL wajib diisi')
  await migrateDatabase(process.env.DATABASE_URL)
  console.log('Database migrations applied')
}
