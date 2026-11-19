import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { connect } from '../server/db.ts'
import { migrateDatabase } from '../server/migrate.ts'
import { createApp } from '../server/app.ts'
import { createUser } from '../server/create-user.ts'
import { workspaces } from '../server/schema.ts'
import { emptyWorkspace } from '../shared/workspace.ts'
import { blankEmployee } from '../src/engine/roster.ts'
import type { Employee } from '../src/engine/types.ts'

const DB_NAME = 'kppu_rekapst_test'
const URL = process.env.REKAPST_TEST_DATABASE_URL ?? `postgres://kppu:kppu-local@127.0.0.1:5544/${DB_NAME}`
const parsed = new globalThis.URL(URL)
if (!parsed.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('Integration tests require a local database ending in _test')
const connection = connect(URL), app = createApp(connection.db, { origin: 'http://kppu.test', production: false })
const password = randomBytes(24).toString('hex'), cookies: Record<string, string> = {}
const emp = (id: string, kantor: string): Employee => ({ ...blankEmployee(id), nama: `Pegawai ${id}`, kantor, jabatan: 'Analis', unit: 'Biro SDM', nip: `1990${id.padStart(4, '0')}` })
const request = (path: string, method = 'GET', body?: unknown, who = 'super') => app.request(`http://kppu.test/api${path}`, {
  method, headers: { origin: 'http://kppu.test', cookie: cookies[who] ?? '', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const revision = async () => (await (await request('/workspace')).json()).revision as number
const post = async (body: Record<string, unknown>, who = 'super') => request('/rekap-st', 'POST', { expectedRevision: await revision(), registerOffice: 'Pusat', letterNo: '256/', letterDate: '2026-04-01', destination: 'Bogor, Jawa Barat', ...body }, who)
const manualRows = async () => {
  const [w] = await connection.db.select().from(workspaces).where(eq(workspaces.id, 'default'))
  return w.state.files.filter(file => file.id.startsWith('manual-st:')).flatMap(file => file.assignments)
}

beforeAll(async () => {
  const base = postgres('postgres://kppu:kppu-local@127.0.0.1:5544/postgres')
  try { if (!(await base`select 1 from pg_database where datname=${DB_NAME}`).length) await base.unsafe(`create database ${DB_NAME}`) } finally { await base.end() }
  await migrateDatabase(URL)
  await connection.sql.unsafe('TRUNCATE hr_internal.audit_events, hr_internal.sessions, hr_internal.users, hr_internal.workspaces, hr_internal.login_attempts CASCADE')
  await connection.db.insert(workspaces).values({ id: 'default', revision: 1, state: { ...emptyWorkspace(), master: [emp('1', 'Pusat'), emp('2', 'Pusat'), emp('3', 'Pusat'), emp('4', 'Kanwil I')] } })
  const accounts: [string, string, string[] | null][] = [['super', 'superadmin', null], ['admin', 'admin', null], ['op', 'operator_st', ['Pusat']]]
  for (const [key, role, offices] of accounts) {
    await createUser(connection.db, `${key}@kppu.test`, `${key} Test`, password, role as never, offices)
    const response = await request('/auth/login', 'POST', { email: `${key}@kppu.test`, password })
    expect(response.status).toBe(200)
    cookies[key] = response.headers.get('set-cookie')!.split(';')[0]
  }
})
afterAll(async () => { await connection.sql.end() })

describe('POST /api/rekap-st (satu ST, banyak pegawai, rentang tanggal)', () => {
  test('admin gets 403', async () => {
    expect((await post({ employeeIds: ['1'], startDate: '2026-04-01', endDate: '2026-04-01' }, 'admin')).status).toBe(403)
  })
  test('span over 31 days or reversed range is 400', async () => {
    expect((await post({ employeeIds: ['1'], startDate: '2026-04-01', endDate: '2026-05-02' })).status).toBe(400)
    expect((await post({ employeeIds: ['1'], startDate: '2026-04-05', endDate: '2026-04-01' })).status).toBe(400)
    expect((await post({ employeeIds: [], startDate: '2026-04-01', endDate: '2026-04-01' })).status).toBe(400)
    expect((await post({ employeeId: '1', activityDate: '2026-04-01', startDate: '2026-04-01', endDate: '2026-04-01', employeeIds: ['1'] })).status).toBe(400)
  })
  test('expands employees x dates across months', async () => {
    const response = await post({ letterNo: '300/', employeeIds: ['1', '2', '1'], startDate: '2026-09-30', endDate: '2026-10-02' })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({ created: 6, skipped: 0 })
    expect(new Set(body.records.map((r: { activityDate: string }) => r.activityDate))).toEqual(new Set(['2026-09-30', '2026-10-01', '2026-10-02']))
    const rows = (await manualRows()).filter(row => row.letterNo === '300/')
    expect(rows).toHaveLength(6)
    expect(rows.every(row => row.start === row.end && row.rawDate === row.start)).toBe(true)
  })
  test('partial duplicates are skipped, full duplicates are 409', async () => {
    expect((await post({ employeeIds: ['1'], startDate: '2026-04-01', endDate: '2026-04-02' })).status).toBe(201)
    const partial = await post({ employeeIds: ['1', '3'], startDate: '2026-04-01', endDate: '2026-04-03' })
    expect(partial.status).toBe(201)
    expect(await partial.json()).toMatchObject({ created: 4, skipped: 2 })
    const again = await post({ employeeIds: ['1', '3'], startDate: '2026-04-01', endDate: '2026-04-03' })
    expect(again.status).toBe(409)
    expect((await manualRows()).filter(row => row.letterNo === '256/')).toHaveLength(6)
  })
  test('operator register office is forced to own office; participants may come from any office', async () => {
    const cross = await post({ letterNo: '390/', employeeIds: ['4'], startDate: '2026-04-10', endDate: '2026-04-10' }, 'op')
    expect(cross.status).toBe(201)
    const crossRows = (await manualRows()).filter(row => row.letterNo === '390/')
    expect(crossRows).toHaveLength(1)
    expect(crossRows[0]).toMatchObject({ office: 'Pusat', employeeId: '4' })
    const ok = await post({ letterNo: '400/', registerOffice: 'Kanwil I', employeeIds: ['1'], startDate: '2026-04-10', endDate: '2026-04-11' }, 'op')
    expect(ok.status).toBe(201)
    const rows = (await manualRows()).filter(row => row.letterNo === '400/')
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.office === 'Pusat')).toBe(true)
  })
  test('a new ST from any office reopens the KPPU-wide "lengkap" confirmation for that month', async () => {
    expect((await post({ letterNo: '600/', employeeIds: ['1'], startDate: '2026-06-02', endDate: '2026-06-02' })).status).toBe(201)
    const [w] = await connection.db.select().from(workspaces).where(eq(workspaces.id, 'default'))
    const pusat = w.state.files.find(file => file.id.startsWith('manual-st:') && file.office === 'Pusat' && file.assignments.some(a => a.letterNo === '600/'))!
    pusat.coverageDeclarations = [{ start: '2026-06-01', end: '2026-06-30', status: 'complete', basis: 'Rekap ST Juni sudah lengkap', actorId: 'x', at: '2026-07-01T00:00:00Z' }]
    await connection.db.update(workspaces).set({ state: w.state, revision: w.revision + 1 }).where(eq(workspaces.id, 'default'))
    expect((await post({ letterNo: '601/', registerOffice: 'Kanwil I', employeeIds: ['4'], startDate: '2026-06-10', endDate: '2026-06-10' })).status).toBe(201)
    const [after] = await connection.db.select().from(workspaces).where(eq(workspaces.id, 'default'))
    const reopened = after.state.files.find(file => file.id === pusat.id)!.coverageDeclarations!
    expect(reopened.map(d => d.status)).toEqual(['partial'])
    expect(reopened[0].basis).toContain('dibuka kembali setelah input ST 601/ (Kanwil I)')
  })
  test('unknown employee is 422 and writes nothing', async () => {
    const before = (await manualRows()).length
    expect((await post({ letterNo: '500/', employeeIds: ['1', 'ghost'], startDate: '2026-04-20', endDate: '2026-04-20' })).status).toBe(422)
    expect((await manualRows()).length).toBe(before)
  })
})
