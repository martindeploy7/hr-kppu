import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.ts'
export function connect(url: string) {
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15, ssl: ['localhost', '127.0.0.1'].includes(new URL(url).hostname) ? false : 'require' })
  return { sql, db: drizzle(sql, { schema }) }
}
export type Database = ReturnType<typeof connect>['db']
/** Koneksi tunggal tanpa idle timeout untuk advisory lock scheduler (kunci sesi hilang bila koneksi ditutup). */
export function connectLock(url: string) {
  return postgres(url, { prepare: false, max: 1, idle_timeout: 0, connect_timeout: 15, ssl: ['localhost', '127.0.0.1'].includes(new URL(url).hostname) ? false : 'require' })
}
