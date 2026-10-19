import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { hash } from '@node-rs/argon2'
import { z } from 'zod'
import { connect, type Database } from './db.ts'
import { users } from './schema.ts'
import { roles, type Role } from '../shared/workspace.ts'
export async function createUser(db: Database, email: string, name: string, password: string, role: Role, offices: string[] | null = null) {
  z.email().parse(email); z.string().min(2).max(100).parse(name); z.string().min(14).max(256).parse(password); z.enum(roles).parse(role)
  if (role === 'admin' && offices?.length) throw new Error('Administrator memakai akses global')
  await db.insert(users).values({ id: randomUUID(), email: email.toLowerCase().trim(), name, role, offices: offices?.length ? offices : null, passwordHash: await hash(password) })
}
if (process.argv[1]?.endsWith('/create-user.ts') || process.argv[1]?.endsWith('/create-user.js')) {
  const [email, name, role = 'viewer', passwordFile] = process.argv.slice(2)
  if (!passwordFile || !process.env.DATABASE_URL) throw new Error('Usage: user:create -- email name role /private/path/password-file (password >=14 chars)')
  const { db, sql } = connect(process.env.DATABASE_URL)
  try { await createUser(db, email, name, (await readFile(passwordFile, 'utf8')).trim(), z.enum(roles).parse(role)); console.log('User created; password not displayed') } finally { await sql.end() }
}
