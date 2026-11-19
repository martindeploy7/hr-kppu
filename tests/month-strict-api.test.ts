import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import * as XLSX from 'xlsx'
import { connect } from '../server/db.ts'
import { migrateDatabase } from '../server/migrate.ts'
import { createApp } from '../server/app.ts'
import { createUser } from '../server/create-user.ts'
import { mealClaimedDays } from '../server/schema.ts'
import { eachDay, isWeekend } from '../src/engine/dates.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import { blankEmployee } from '../src/engine/roster.ts'
import { emptyWorkspace } from '../shared/workspace.ts'

// Integrasi PostgreSQL: pengajuan hanya memuat tanggal bulannya, dampak unggahan dirinci per bulan dengan peringatan pengajuan
// terkunci, deklarasi cakupan lintas bulan terbelah per bulan di server, dan unggah ulang pekan yang sama ditolak.

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://kppu:kppu-local@127.0.0.1:5544/kppu_monthstrict_test'
const parsedUrl = new globalThis.URL(URL)
if (!parsedUrl.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) throw new Error('Integration tests require a local database ending in _test')
const origin = 'http://kppu-month.test'
const connection = connect(URL), app = createApp(connection.db, { origin, production: false })
const password = randomBytes(24).toString('hex'), cookies: Record<string, string> = {}
const request = (path: string, method = 'GET', body?: unknown, role = 'uploader') => app.request(`${origin}/api${path}`, { method, headers: { origin, cookie: cookies[role] ?? '', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const workspace = async () => await (await request('/workspace')).json()
const stamp = '2026-11-01T00:00:00Z'
const personA = { ...blankEmployee('person-a'), nama: 'Pegawai Satu', nip: '198001012020011001', kantor: 'Pusat', statusKepegawaian: 'PNS' as const, golongan: 'III/a' }
const personB = { ...blankEmployee('person-b'), nama: 'Pegawai Dua', nip: '198001012020011002', kantor: 'Pusat', statusKepegawaian: 'PNS' as const, golongan: 'III/a' }
const declared = (status: 'complete' | 'nil' | 'not-applicable', start: string, end: string) => [{ start, end, status, basis: 'Konfirmasi cakupan sintetis uji', actorId: 'fixture', at: stamp }]

beforeAll(async () => {
  const base = postgres(new globalThis.URL('/postgres', URL).href)
  try {
    const exists = await base`select 1 from pg_database where datname = ${parsedUrl.pathname.slice(1)}`
    if (!exists.length) await base.unsafe(`create database "${parsedUrl.pathname.slice(1)}"`)
  } finally { await base.end() }
  await migrateDatabase(URL)
  await connection.sql.unsafe('TRUNCATE hr_internal.audit_events, hr_internal.sessions, hr_internal.uploads, hr_internal.users, hr_internal.workspaces, hr_internal.login_attempts, hr_internal.whatsapp_auth_state, hr_internal.meal_claimed_days, hr_internal.meal_submissions CASCADE')
  for (const role of ['uploader', 'finance']) {
    await createUser(connection.db, `${role}@kppu-month.test`, `${role} Test`, password, 'superadmin')
    const login = await request('/auth/login', 'POST', { email: `${role}@kppu-month.test`, password }, role)
    expect(login.status).toBe(200)
    cookies[role] = login.headers.get('set-cookie')!.split(';')[0]
  }
})
afterAll(async () => { await connection.sql.end() })

const workbook = (rows: (string | number)[][], name: string) => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['NIK', 'Nama', 'Tanggal', 'Scan Masuk', 'Scan Pulang'], ...rows]), 'Sheet1')
  return new File([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })], name)
}
const preview = async (file: File) => {
  const form = new FormData(); form.set('file', file); form.set('weekly', '1')
  const response = await app.request(`${origin}/api/imports/preview`, { method: 'POST', headers: { origin, cookie: cookies.uploader }, body: form })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()).file as { id: string }
}
const dmy = (date: string) => date.split('-').reverse().join('/')

describe('atribusi bulan per tanggal di server', () => {
  test('pengajuan Juli hanya memuat dan mengklaim tanggal Juli walau data mencakup Juni dan Agustus', async () => {
    const state = emptyWorkspace()
    state.master = [personA, personB]
    state.policy = { ...DEFAULT_POLICY, parametersApproved: true, taxParametersApproved: true, arrivalBoundary: 'inclusive', pph: { ...DEFAULT_POLICY.pph, III: 5 }, holidays: [] }
    const days = eachDay('2026-06-29', '2026-08-07').filter(date => !isWeekend(date))
    const evidence = (fileId: string, kind: 'mesin' | 'daring') => days.map(date => ({ id: `${fileId}-${date}`, fileId, kind, office: 'Pusat', name: personA.nama, ids: { nip: personA.nip }, date, clockIn: '08:00', clockOut: '16:30', ref: `sintetis ${date}`, ...(kind === 'daring' ? { mode: 'WFO' as const, approved: true } : {}) }))
    const source = (id: string, kind: 'mesin' | 'daring' | 'surat-tugas', office: string, rows: ReturnType<typeof evidence>, status: 'complete' | 'nil') => ({
      id, fileName: `Sintetis ${id}`, kind, label: 'Fixture', office, importedAt: stamp, period: { start: '2026-06-29', end: '2026-08-09' }, evidence: rows, assignments: [],
      coverageDeclarations: declared(status, '2026-06-29', '2026-08-09'), warnings: [], stats: { rows: rows.length, people: 1 }, active: true,
    })
    state.files = [source('offline-main', 'mesin', 'Pusat', evidence('offline-main', 'mesin'), 'complete'), source('online-main', 'daring', 'Semua kantor', evidence('online-main', 'daring'), 'complete'), source('st-nil', 'surat-tugas', 'Pusat', [], 'nil')] as never
    const before = await workspace()
    expect((await request('/backup/restore', 'POST', { expectedRevision: before.revision, state, reason: 'Fixture data lintas Juni sampai Agustus' })).status).toBe(200)

    const id = randomUUID(), current = await workspace()
    const submit = await request('/meal-submissions', 'POST', { id, period: '2026-07', office: 'Semua', expectedRevision: current.revision })
    expect(submit.status, await submit.clone().text()).toBe(200)
    const { submission } = await submit.json()
    const dates = submission.snapshot.months.flatMap((m: { days: { date: string }[] }) => m.days.map(d => d.date))
    expect(dates.length).toBeGreaterThan(0)
    expect(dates.every((date: string) => date.startsWith('2026-07'))).toBe(true)
    const mine = submission.snapshot.months.find((m: { employee: { nip: string } }) => m.employee.nip === personA.nip)
    expect(mine.mealDays).toBe(eachDay('2026-07-01', '2026-07-31').filter(date => !isWeekend(date)).length)
    const claims = await connection.db.select().from(mealClaimedDays)
    expect(claims).toHaveLength(mine.mealDays)
    expect(claims.every(claim => claim.date.startsWith('2026-07') && claim.key.endsWith(claim.date))).toBe(true)

    expect((await request(`/meal-submissions/${id}/approve`, 'POST', { expectedRevision: 1, reason: 'Finance memeriksa snapshot Juli' }, 'finance')).status).toBe(200)
    expect((await request(`/meal-submissions/${id}/lock`, 'POST', { expectedRevision: 2, reason: 'Finance mengunci snapshot Juli' }, 'finance')).status).toBe(200)
  })

  test('dampak unggahan lintas Juni dan Juli dirinci per bulan dan memperingatkan Juli yang sudah terkunci tanpa memblokir', async () => {
    const week = { start: '2026-06-29', end: '2026-07-05' }
    const rows = eachDay('2026-06-29', '2026-07-03').map(date => [personB.nip, personB.nama, dmy(date), '07:50', '17:00'])
    const file = workbook(rows, 'Mesin_Offline_B.xlsx')
    const parsed = await preview(file)
    const current = await workspace()
    const intent = {
      uploadId: parsed.id, expectedRevision: current.revision, office: 'Semua kantor', mode: 'add', resolveUnmappedOffice: false, range: week,
      coverage: { ...week, status: 'complete', basis: 'Setoran mingguan Mesin Offline seluruh KPPU melalui unggah file Mesin_Offline_B.xlsx' },
      reason: 'Setoran Mesin Offline seluruh KPPU, 2026-06-29–2026-07-05',
    }
    const impactResponse = await request('/imports/impact', 'POST', intent)
    expect(impactResponse.status, await impactResponse.clone().text()).toBe(200)
    const impact = await impactResponse.json()
    expect(impact.counts.added).toBe(5)
    expect(impact.byMonth.map((row: { month: string; added: number }) => [row.month, row.added])).toEqual([['2026-06', 2], ['2026-07', 3]])
    const june = impact.byMonth[0], july = impact.byMonth[1]
    expect(june.submission).toBeUndefined()
    expect(july.submission).toMatchObject({ status: 'locked', version: 1 })
    expect(impact.warnings).toHaveLength(1)
    expect(impact.warnings[0]).toContain('Juli 2026')
    expect(impact.warnings[0]).toContain('alur koreksi')

    const commit = await request('/imports/commit', 'POST', { ...intent, confirmedImpact: impact.checksum })
    expect(commit.status, await commit.clone().text()).toBe(200)
    const saved = (await workspace()).state.files.find((f: { id: string }) => f.id === parsed.id)
    expect(saved.evidence).toHaveLength(5)
    expect(saved.coverageDeclarations.map((d: { start: string; end: string }) => [d.start, d.end])).toEqual([['2026-06-29', '2026-06-30'], ['2026-07-01', '2026-07-05']])

    // Pekan yang sama dari file yang sama ditolak, dari sisi bulan mana pun pekan itu dipilih.
    const again = await preview(file)
    const next = await workspace()
    const repeat = { ...intent, uploadId: again.id, expectedRevision: next.revision }
    const repeatImpact = await (await request('/imports/impact', 'POST', repeat)).json()
    const rejected = await request('/imports/commit', 'POST', { ...repeat, confirmedImpact: repeatImpact.checksum })
    expect(rejected.status).toBe(409)
    expect((await rejected.json()).error).toContain('sudah disetor untuk pekan ini')
  })

  test('deklarasi cakupan lintas bulan dari endpoint cakupan tersimpan terbelah per bulan', async () => {
    const range = { start: '2026-08-31', end: '2026-09-04' }, pieces = (declarations: { start: string; end: string }[]) => declarations.map(d => [d.start, d.end])
    let current = await workspace()
    const source = await request('/sources/offline-main/coverage', 'POST', { expectedRevision: current.revision, ...range, status: 'complete', basis: 'Konfirmasi cakupan lintas bulan sintetis' })
    expect(source.status, await source.clone().text()).toBe(200)
    current = await workspace()
    expect(pieces(current.state.files.find((f: { id: string }) => f.id === 'offline-main').coverageDeclarations.filter((d: { start: string }) => d.start >= '2026-08-31'))).toEqual([['2026-08-31', '2026-08-31'], ['2026-09-01', '2026-09-04']])

    const na = await request('/coverage/not-applicable', 'POST', { expectedRevision: current.revision, office: 'Pusat', source: 'online', ...range, basis: 'Mesin online tidak beroperasi pada pekan ini' })
    expect(na.status, await na.clone().text()).toBe(200)
    current = await workspace()
    const naFile = current.state.files.find((f: { fileName: string }) => f.fileName.startsWith('Konfirmasi sumber tidak berlaku online'))
    expect(pieces(naFile.coverageDeclarations)).toEqual([['2026-08-31', '2026-08-31'], ['2026-09-01', '2026-09-04']])

    const nil = await request('/coverage/nil-st', 'POST', { expectedRevision: current.revision, office: 'Pusat', ...range, basis: 'Register ST dicek, tidak ada ST pada pekan ini' })
    expect(nil.status, await nil.clone().text()).toBe(200)
    current = await workspace()
    const nilFile = current.state.files.find((f: { fileName: string }) => f.fileName.startsWith('Pernyataan nihil ST Pusat 2026-08-31'))
    expect(pieces(nilFile.coverageDeclarations)).toEqual([['2026-08-31', '2026-08-31'], ['2026-09-01', '2026-09-04']])
  })
})
