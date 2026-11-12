import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import postgres from 'postgres'
import * as XLSX from 'xlsx'
import { eq } from 'drizzle-orm'
import { connect } from '../server/db.ts'
import { migrateDatabase } from '../server/migrate.ts'
import { createApp } from '../server/app.ts'
import { createUser } from '../server/create-user.ts'
import { uploads } from '../server/schema.ts'
import { readSheets } from '../src/lib/xlsx.ts'
import { parseWorkbook } from '../src/engine/parse.ts'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://kppu:kppu-local@127.0.0.1:5544/kppu_import_adapter_test'
const parsed = new globalThis.URL(URL)
if (!parsed.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('Import persistence integration test requires an isolated local *_test database')
const connection = connect(URL)
const app = createApp(connection.db, { origin: 'http://kppu-import.test', production: false })
const password = randomBytes(24).toString('hex')
let cookie = ''

const request = (path: string, method = 'GET', body?: unknown) => app.request(`http://kppu-import.test/api${path}`, {
  method,
  headers: { origin: 'http://kppu-import.test', cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  body: body === undefined ? undefined : JSON.stringify(body),
})

beforeAll(async () => {
  const dbName = parsed.pathname.slice(1)
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error('Test database name is invalid')
  const base = postgres(new globalThis.URL('/postgres', URL).href)
  try {
    const exists = await base`select 1 from pg_database where datname = ${dbName}`
    if (!exists.length) await base.unsafe(`create database "${dbName}"`)
  } finally { await base.end() }

  await migrateDatabase(URL)
  await connection.sql.unsafe('TRUNCATE hr_internal.audit_events, hr_internal.sessions, hr_internal.uploads, hr_internal.users, hr_internal.workspaces, hr_internal.login_attempts CASCADE')
  await createUser(connection.db, 'import-test@kppu.test', 'Import Persistence Test', password, 'superadmin')
  const login = await app.request('http://kppu-import.test/api/auth/login', {
    method: 'POST', headers: { origin: 'http://kppu-import.test', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'import-test@kppu.test', password }),
  })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]
})

afterAll(async () => { await connection.sql.end() })

describe('Online source persistence', () => {
  test('original bytes, source fields and provenance survive preview, atomic commit and server reload', async () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['Nama Pegawai', 'Tanggal', 'NIP', 'Jam Mulai', 'Jam Selesai', 'Min. Durasi', 'Jenis', 'Kantor', 'Unit', 'Status', 'Target Pekerjaan', 'Hasil Pekerjaan'],
      ['Pegawai Fixture', '2026-10-05', '198001012020011001', '07:55', '16:00', '8 Jam', 'WFA', 'Kanwil II', '', 'Approved', 'Koordinasi jarak jauh', 'Notulen selesai'],
    ]), 'Online')
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    const expectedHash = createHash('sha256').update(bytes).digest('hex')
    const form = new FormData()
    form.set('file', new File([bytes], 'online-compact.xlsx'))
    const preview = await app.request('http://kppu-import.test/api/imports/preview', {
      method: 'POST', headers: { origin: 'http://kppu-import.test', cookie }, body: form,
    })
    expect(preview.status, await preview.clone().text()).toBe(200)
    const uploaded = (await preview.json()).file
    expect(uploaded).toMatchObject({ parserVersion: '2.2.0', hash: expectedHash, period: { start: '2026-10-05', end: '2026-10-05' } })
    expect(uploaded.evidence[0]).toMatchObject({ office: 'Kanwil II', targetPekerjaan: 'Koordinasi jarak jauh', hasilPekerjaan: 'Notulen selesai', minimumDurationMin: 480, approvalStatus: 'approved' })
    expect((await request('/workspace').then(r => r.json())).state.files).toHaveLength(0)

    const [staged] = await connection.db.select().from(uploads)
    expect(staged.bytes.equals(bytes)).toBe(true)
    expect(staged.hash).toBe(expectedHash)
    expect(staged.committed).toBe(false)

    const intent = { uploadId: uploaded.id, expectedRevision: 0, office: 'Semua kantor', mode: 'add', reason: 'Fixture uji persistensi sumber asli' }
    const impactResponse = await request('/imports/impact', 'POST', intent)
    expect(impactResponse.status, await impactResponse.clone().text()).toBe(200)
    const impact = await impactResponse.json()
    expect(impact.source.selectedRows).toBe(1)
    const commit = await request('/imports/commit', 'POST', { ...intent, confirmedImpact: impact.checksum })
    expect(commit.status, await commit.clone().text()).toBe(200)

    // This separate API read loads the saved JSON workspace from PostgreSQL again.
    const reloaded = await request('/workspace').then(r => r.json())
    const saved = reloaded.state.files.find((file: { id: string }) => file.id === uploaded.id)
    expect(reloaded.revision).toBe(1)
    expect(saved.evidence[0]).toMatchObject({
      office: 'Kanwil II', date: '2026-10-05', clockIn: '07:55', clockOut: '16:00',
      targetPekerjaan: 'Koordinasi jarak jauh', hasilPekerjaan: 'Notulen selesai', minimumDurationMin: 480,
      approvalStatus: 'approved', sourceValues: { identifier: '198001012020011001', date: '2026-10-05', approval: 'Approved', minimumDuration: '8 Jam' },
    })
    expect(saved.hash).toBe(expectedHash)
    const [committed] = await connection.db.select().from(uploads).where(eq(uploads.id, uploaded.id))
    expect(committed.committed).toBe(true)
    expect(committed.bytes.equals(bytes)).toBe(true)

    const headers = ['No', 'Nama Pegawai', 'Tanggal', 'NIP', 'Jam Mulai', 'Jam Selesai', 'Durasi', 'Terlambat', 'Pulang Cepat', 'Lembur', 'Min. Durasi', 'Jenis', 'Foto', 'Nama Lokasi', 'Unit', 'Koordinat (IN)', 'Koordinat (OUT)', 'status']
    const allWorkdays: string[] = []
    for (let day = Date.parse('2026-04-01T00:00:00Z'); day <= Date.parse('2026-09-30T00:00:00Z'); day += 86400000) {
      const weekday = new Date(day).getUTCDay()
      if (weekday > 0 && weekday < 6) allWorkdays.push(new Date(day).toISOString().slice(0, 10))
    }
    const dateSlots = Array.from({ length: 41 }, (_, index) => allWorkdays[Math.floor(index * (allWorkdays.length - 1) / 40)])
    const units = ['Sekretaris Jenderal', 'Satuan Pelaksana Medan', 'Satuan Pelaksana Lampung', 'Satuan Pelaksana Bandung', 'Satuan Pelaksana Surabaya', 'Satuan Pelaksana Samarinda', 'Satuan Pelaksana Makassar', 'Satuan Pelaksana Yogyakarta']
    const rows: (string | number)[][] = [headers]
    for (let index = 0; index < 11348; index++) {
      const person = index % 282, date = dateSlots[Math.floor(index / 282)]
      const nip = `198001012020211${String(person + 1).padStart(3, '0')}`
      rows.push([index + 1, `Pegawai Fixture ${String(person + 1).padStart(3, '0')}`, date, nip, '07:55', '16:00', '8 Jam', '0 Menit', '0 Menit', '0 Jam', '8 Jam', person % 2 ? 'WFA' : 'WFO', '', '', units[person % units.length], '', '', 'Approved'])
    }
    const volumeWorkbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(volumeWorkbook, XLSX.utils.aoa_to_sheet(rows), 'Online')
    const volumeBytes = XLSX.write(volumeWorkbook, { type: 'buffer', bookType: 'xlsx' })
    let started = performance.now()
    const sheets = await readSheets(new File([volumeBytes], 'online-volume.xlsx'))
    const readMs = performance.now() - started
    started = performance.now()
    const parsedVolume = parseWorkbook('online-volume.xlsx', sheets, 'volume-fixture')
    const parseMs = performance.now() - started
    expect(parsedVolume.evidence).toHaveLength(11348)
    expect(parsedVolume.period).toEqual({ start: dateSlots[0], end: dateSlots.at(-1) })

    const volumeForm = new FormData()
    volumeForm.set('file', new File([volumeBytes], 'online-volume.xlsx'))
    started = performance.now()
    const volumeUpload = await app.request('http://kppu-import.test/api/imports/preview', { method: 'POST', headers: { origin: 'http://kppu-import.test', cookie }, body: volumeForm })
    const uploadMs = performance.now() - started
    expect(volumeUpload.status, await volumeUpload.clone().text()).toBe(200)
    const volumeFile = (await volumeUpload.json()).file
    expect(volumeFile.evidence).toHaveLength(11348)
    const volumeIntent = { uploadId: volumeFile.id, expectedRevision: 1, office: 'Semua kantor', mode: 'add', reason: 'Fixture sintetis uji volume ekspor Online' }
    started = performance.now()
    const volumeImpactResponse = await request('/imports/impact', 'POST', volumeIntent)
    const impactMs = performance.now() - started
    expect(volumeImpactResponse.status, await volumeImpactResponse.clone().text()).toBe(200)
    const volumeImpact = await volumeImpactResponse.json()
    expect(volumeImpact.source.selectedRows).toBe(11348)
    started = performance.now()
    const volumeCommit = await request('/imports/commit', 'POST', { ...volumeIntent, confirmedImpact: volumeImpact.checksum })
    expect(volumeCommit.status, await volumeCommit.clone().text()).toBe(200)
    await volumeCommit.json()
    const commitMs = performance.now() - started
    started = performance.now()
    const volumeReload = await request('/workspace').then(response => response.json())
    const reloadMs = performance.now() - started
    const savedVolume = volumeReload.state.files.find((file: { id: string }) => file.id === volumeFile.id)
    expect(savedVolume.evidence).toHaveLength(11348)
    expect(savedVolume.evidence[0]).toMatchObject({ office: 'Pusat', date: dateSlots[0], ids: { nip: '198001012020211001' }, approvalStatus: 'approved' })
    process.stdout.write(`IMPORT_VOLUME ${JSON.stringify({ records: savedVolume.evidence.length, workbooksBytes: volumeBytes.length, readMs: Math.round(readMs), parserMs: Math.round(parseMs), apiUploadMs: Math.round(uploadMs), previewMs: Math.round(impactMs), commitMs: Math.round(commitMs), reloadMs: Math.round(reloadMs) })}\n`)
  }, 60000)
})
