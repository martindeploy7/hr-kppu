import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import * as XLSX from 'xlsx'
import { connect } from '../server/db.ts'
import { migrateDatabase } from '../server/migrate.ts'
import { createApp } from '../server/app.ts'
import { createUser } from '../server/create-user.ts'
import { stableStringify } from '../src/engine/dayReview.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import type { Assignment, Employee, Evidence, SourceFile } from '../src/engine/types.ts'

// Regresi untuk perubahan performa: reconcile(onlyEmployees), indeks baris per kantor-tanggal, stableStringify ber-cache,
// deteksi keputusan tidak berubah di PUT /api/workspace, dan cache dampak impor.

// ---------- fixture mesin rekonsiliasi ----------
const emp = (id: string, nama: string, nip: string, extra: Partial<Employee> = {}): Employee => ({ ...blankEmployee(id), nama, nip, kantor: 'Pusat', statusKepegawaian: 'PNS' as const, golongan: 'III/a', ...extra })
const policy = { ...DEFAULT_POLICY, parametersApproved: true, arrivalBoundary: 'inclusive' as const, holidays: [] }
const range = { start: '2026-10-05', end: '2026-10-09' }
const asOf = '2026-10-12'
const scan = (id: string, date: string, ids: Evidence['ids'], name: string, clockIn = '07:50'): Evidence => ({ id, fileId: 'offline', kind: 'mesin', office: 'Pusat', name, ids, date, schedule: { start: '08:00', end: '16:30', label: 'Jadwal fixture' }, clockIn, clockOut: '16:30', ref: `baris ${id}` })
const file = (id: string, kind: SourceFile['kind'], evidence: Evidence[], assignments: Assignment[] = []): SourceFile => ({ id, fileName: `${id}.xlsx`, kind, label: id, office: 'Pusat', importedAt: '2026-10-10T00:00:00Z', period: range, evidence, assignments, warnings: [], stats: { rows: evidence.length, people: 3 } })
const a = emp('a', 'Ani Satu', '198001012020011001'), b = emp('b', 'Budi Dua', '198001012020011002'), c = emp('c', 'Cici Tiga', '198001012020011003')
const full = (files: SourceFile[], master: Employee[], onlyEmployees?: ReadonlySet<string>) => reconcile(files, buildRoster(files, master, {}, []), range, policy, [], asOf, [], undefined, onlyEmployees)

describe('reconcile onlyEmployees', () => {
  test('hanya menghitung pegawai terpilih dengan hasil identik dengan hitungan penuh', () => {
    const evidence = [
      ...['2026-10-05', '2026-10-06', '2026-10-07'].map((d, i) => scan(`a${i}`, d, { nip: a.nip }, a.nama)),
      { ...scan('b0', '2026-10-05', { nip: b.nip }, b.nama, '09:30'), clockOut: undefined },
      scan('c0', '2026-10-06', { nip: c.nip }, c.nama),
    ]
    const files = [file('offline', 'mesin', evidence)]
    const all = full(files, [a, b, c])
    expect(all.months.map(m => m.employee.id).sort()).toEqual(['a', 'b', 'c'])
    expect(all.issues.length).toBeGreaterThan(0)
    for (const id of ['a', 'b', 'c']) {
      const only = full(files, [a, b, c], new Set([id]))
      expect(only.months.map(m => m.employee.id)).toEqual([id])
      expect(only.months[0]).toEqual(all.months.find(m => m.employee.id === id))
      expect(only.issues).toEqual(all.issues.filter(i => i.employeeId === id))
    }
    expect(full(files, [a, b, c], new Set()).months).toHaveLength(0)
  })
})

describe('indeks baris per kantor-tanggal (reviewSignature)', () => {
  const alias = { kind: 'mesin' as const, value: 'Pusat:M-77', source: 'fixture' }
  const target = emp('t', 'Tono Target', '', { aliases: [alias] })
  const other = emp('o', 'Oki Lain', '198001012020011009')
  const st = (id = 'st1', note = 'Rapat'): Assignment => ({ id, fileId: 'st', employeeId: 't', office: 'Pusat', name: 'Tono Target', start: '2026-10-06', end: '2026-10-06', rawDate: '6 Oktober 2026', destination: 'Bandung', local: false, ref: 'st 1', note } as Assignment)
  const signature = (targetClockIn: string, withOther: boolean) => {
    const evidence = [scan('t1', '2026-10-06', { mesin: 'M-77' }, 'Tono Target', targetClockIn), ...(withOther ? [scan('o1', '2026-10-06', { nip: other.nip }, other.nama), scan('o2', '2026-10-06', { mesin: 'M-99' }, 'Orang Asing')] : [])]
    const files = [file('offline', 'mesin', evidence), file('st', 'surat-tugas', [], [st()])]
    const result = full(files, withOther ? [target, other] : [target])
    return result.months.find(m => m.employee.id === 't')!.days.find(d => d.date === '2026-10-06')!
  }
  test('baris pegawai lain pada kantor-tanggal yang sama tidak mengubah tanda tangan', () => {
    const alone = signature('07:50', false), crowded = signature('07:50', true)
    expect(alone.evidence.map(e => e.id)).toEqual(['t1'])
    expect(alone.assignments.map(s => s.id)).toEqual(['st1'])
    expect(alone.reviewSignature).toBe(crowded.reviewSignature)
  })
  test('tanda tangan berubah ketika bukti milik pegawai itu berubah', () => {
    expect(signature('07:50', true).reviewSignature).not.toBe(signature('07:40', true).reviewSignature)
  })
})

describe('stableStringify setara implementasi lama', () => {
  const legacy = (v: unknown) => {
    const cn = (i: unknown): unknown => Array.isArray(i) ? i.map(cn) : i && typeof i === 'object' ? Object.fromEntries(Object.entries(i).filter(([, f]) => f !== undefined).sort(([x], [y]) => x.localeCompare(y)).map(([k, f]) => [k, cn(f)])) : i
    return JSON.stringify(cn(v))
  }
  const cases: [string, unknown][] = [
    ['kunci campur huruf', { aB: 1, ab: 2, _c: 3, C: 4, c: 5, B: 6 }],
    ['field undefined', { z: undefined, a: 1, m: { y: undefined, x: 2 } }],
    ['array dengan undefined', { list: [1, undefined, { b: 1, a: undefined }, [undefined, 'x']] }],
    ['NaN dan -0', { n: NaN, z: -0, i: Infinity, arr: [NaN, -0] }],
    ['unicode', { 'é': 'é', 'e': '\u{1F600}', 'ä': 'Ünïcödé', zebra: '日本語' }],
    ['kunci __proto__ dari JSON.parse', JSON.parse('{"b":1,"__proto__":{"x":1},"a":{"__proto__":2,"c":3}}')],
    ['Date', { when: new Date('2026-10-05T00:00:00Z'), list: [new Date(0)] }],
    ['objek kosong', {}],
    ['array kosong', []],
    ['primitif', 'teks'], ['angka', 42], ['null', null], ['undefined', undefined], ['boolean', false],
    ['bersarang dalam', { b: { d: { f: [{ h: 1, g: undefined, a: 2 }] }, c: 1 }, a: null }],
  ]
  test.each(cases)('%s', (_name, value) => { expect(stableStringify(value)).toBe(legacy(value)) })
  test('bentuk sama berulang dengan field undefined berbeda', () => {
    const items = [{ a: 1, b: undefined, c: 3 }, { a: undefined, b: 2, c: 3 }, { a: 1, b: 2, c: undefined }, { a: 1, b: 2, c: 3 }]
    for (const round of [1, 2]) for (const item of items) expect(stableStringify(item), `putaran ${round}`).toBe(legacy(item))
    // Urutan penyisipan berbeda menghasilkan string sama.
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })
  test('hasil tidak berbagi state antar panggilan', () => {
    const first = stableStringify({ k: 1, j: undefined }), second = stableStringify({ k: 1, j: 2 })
    expect(first).toBe('{"k":1}'); expect(second).toBe('{"j":2,"k":1}')
  })
})

// ---------- integrasi PostgreSQL ----------
const URL = process.env.TEST_DATABASE_URL ?? 'postgres://kppu:kppu-local@127.0.0.1:5544/kppu_perfsafety_test'
const parsedUrl = new globalThis.URL(URL)
if (!parsedUrl.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) throw new Error('Integration tests require a local database ending in _test')
const origin = 'http://kppu-perf.test'
const connection = connect(URL), app = createApp(connection.db, { origin, production: false })
const password = randomBytes(24).toString('hex')
let cookie = ''
const request = (path: string, method = 'GET', body?: unknown) => app.request(`${origin}/api${path}`, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const workspace = async () => await (await request('/workspace')).json()

beforeAll(async () => {
  const base = postgres(new globalThis.URL('/postgres', URL).href)
  try {
    const exists = await base`select 1 from pg_database where datname = ${parsedUrl.pathname.slice(1)}`
    if (!exists.length) await base.unsafe(`create database "${parsedUrl.pathname.slice(1)}"`)
  } finally { await base.end() }
  await migrateDatabase(URL)
  await connection.sql.unsafe('TRUNCATE hr_internal.audit_events, hr_internal.sessions, hr_internal.uploads, hr_internal.users, hr_internal.workspaces, hr_internal.login_attempts, hr_internal.whatsapp_auth_state, hr_internal.meal_claimed_days, hr_internal.meal_submissions CASCADE')
  await createUser(connection.db, 'super@kppu-perf.test', 'Super Test', password, 'superadmin')
  const login = await request('/auth/login', 'POST', { email: 'super@kppu-perf.test', password })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]
})
afterAll(async () => { await connection.sql.end() })

describe('PUT /api/workspace: keputusan lama tidak berubah', () => {
  const oldAt = '2026-09-01T03:00:00.000Z'
  test('resolusi dan keputusan dengan urutan kunci berbeda tidak divalidasi ulang dan tidak distempel ulang', async () => {
    await workspace() // memastikan baris workspace ada
    const state = { ...(await workspace()).state }
    state.resolutions = [{ issueId: 'ghost-employee|2026-10|issue', decision: 'valid', note: 'Catatan lama', reviewer: 'Peninjau Lama', at: oldAt, signature: 'stale' }]
    state.decisions = [{ key: 'nama-lama', employeeId: null, reviewer: 'Peninjau Lama', at: oldAt }]
    await connection.sql.unsafe('update hr_internal.workspaces set state = $1::jsonb where id = $2', [JSON.stringify(state), 'default'])

    const current = await workspace()
    // Kunci disisipkan terbalik: sama isinya, beda urutan.
    const reorder = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse())
    const res = await request('/workspace', 'PUT', {
      expectedRevision: current.revision, reason: 'Kirim ulang data lama',
      patch: { resolutions: [reorder(state.resolutions[0])], decisions: [reorder(state.decisions[0])] },
    })
    expect(res.status, await res.clone().text()).toBe(200)
    const after = (await workspace()).state
    expect(after.resolutions).toHaveLength(1)
    expect(after.resolutions[0]).toMatchObject({ reviewer: 'Peninjau Lama', at: oldAt, signature: 'stale', note: 'Catatan lama' })
    expect(after.decisions[0]).toMatchObject({ reviewer: 'Peninjau Lama', at: oldAt })
  })

  test('resolusi yang benar-benar berubah tetap divalidasi terhadap bukti (409 untuk tanda tangan basi)', async () => {
    const current = await workspace()
    const old = current.state.resolutions[0]
    const res = await request('/workspace', 'PUT', { expectedRevision: current.revision, reason: 'Ubah catatan', patch: { resolutions: [{ ...old, note: 'Catatan baru yang berbeda' }] } })
    expect(res.status).toBe(409)
  })

  test('keputusan yang berubah distempel dengan peninjau saat ini', async () => {
    const current = await workspace()
    const old = current.state.decisions[0]
    const res = await request('/workspace', 'PUT', { expectedRevision: current.revision, reason: 'Ubah keputusan', patch: { decisions: [{ ...old, employeeId: 'emp-x' }] } })
    expect(res.status, await res.clone().text()).toBe(200)
    const saved = (await workspace()).state.decisions[0]
    expect(saved.reviewer).toBe('Super Test')
    expect(saved.at).not.toBe(oldAt)
  })
})

describe('cache dampak impor', () => {
  const workbook = (rows: (string | number)[][]) => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['NIK', 'Nama', 'Tanggal', 'Scan Masuk', 'Scan Pulang'], ...rows]), 'Sheet1')
    return new File([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })], 'Mesin_Offline_Perf.xlsx')
  }
  test('impact berulang menghasilkan checksum sama dan commit dengan checksum itu berhasil', async () => {
    const week = { start: '2026-10-12', end: '2026-10-18' }
    const rows = ['13', '14', '15'].map(d => ['198001012020011050', 'Pegawai Impor', `${d}/10/2026`, '07:50', '17:00'])
    const form = new FormData(); form.set('file', workbook(rows)); form.set('weekly', '1')
    const pv = await app.request(`${origin}/api/imports/preview`, { method: 'POST', headers: { origin, cookie }, body: form })
    expect(pv.status, await pv.clone().text()).toBe(200)
    const parsed = (await pv.json()).file as { id: string }
    const current = await workspace()
    const intent = {
      uploadId: parsed.id, expectedRevision: current.revision, office: 'Semua kantor', mode: 'add', resolveUnmappedOffice: false, range: week,
      coverage: { ...week, status: 'complete', basis: 'Setoran mingguan Mesin Offline seluruh KPPU melalui unggah file uji' },
      reason: 'Setoran Mesin Offline uji performa',
    }
    const first = await request('/imports/impact', 'POST', intent)
    expect(first.status, await first.clone().text()).toBe(200)
    const impact = await first.json()
    const second = await (await request('/imports/impact', 'POST', intent)).json()
    expect(second.checksum).toBe(impact.checksum)
    expect(second.counts).toEqual(impact.counts)
    const commit = await request('/imports/commit', 'POST', { ...intent, confirmedImpact: impact.checksum })
    expect(commit.status, await commit.clone().text()).toBe(200)
    expect((await workspace()).state.files.some((f: { id: string }) => f.id === parsed.id)).toBe(true)
  })
})
