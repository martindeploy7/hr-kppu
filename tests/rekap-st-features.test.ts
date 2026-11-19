import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { connect } from '../server/db.ts'
import { migrateDatabase } from '../server/migrate.ts'
import { createApp } from '../server/app.ts'
import { createUser } from '../server/create-user.ts'
import { auditEvents, stAttachments, workspaces } from '../server/schema.ts'
import { emptyWorkspace } from '../shared/workspace.ts'
import { migrateWorkspace } from '../shared/validation.ts'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import type { Employee } from '../src/engine/types.ts'
import { attachmentDisposition, detectAttachmentType, safeAttachmentName } from '../server/rekapSt.ts'

const DB_NAME = 'kppu_rekapst_features_test'
const URL = `postgres://kppu:kppu-local@127.0.0.1:5544/${DB_NAME}`
const connection = connect(URL), app = createApp(connection.db, { origin: 'http://kppu.test', production: false })
const password = randomBytes(24).toString('hex'), cookies: Record<string, string> = {}
const emp = (id: string, kantor: string, nama = `Pegawai ${id}`): Employee => ({ ...blankEmployee(id), nama, kantor, jabatan: 'Analis', unit: 'Biro SDM', nip: `1990${id.padStart(14, '0')}` })
const master = [emp('1', 'Pusat'), emp('2', 'Pusat'), emp('3', 'Pusat'), emp('4', 'Kanwil I', 'Kepala Kanwil I'), emp('5', 'Kanwil I'), emp('6', 'Pusat', 'Eko Susilo'), ...Array.from({ length: 300 }, (_, i) => emp(`b${i}`, i % 2 ? 'Pusat' : 'Kanwil II'))]
const request = (path: string, method = 'GET', body?: unknown, who = 'super') => app.request(`http://kppu.test/api${path}`, {
  method, headers: { origin: 'http://kppu.test', cookie: cookies[who] ?? '', ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
})
const revision = async () => (await (await request('/workspace')).json()).revision as number
const post = async (body: Record<string, unknown>, who = 'super') => request('/rekap-st', 'POST', { expectedRevision: await revision(), registerOffice: 'Pusat', letterNo: '256/', letterDate: '2026-04-01', destination: 'Bogor, Jawa Barat', ...body }, who)
const put = async (groupId: string, body: Record<string, unknown>, who = 'super') => request(`/rekap-st/groups/${groupId}`, 'PUT', { expectedRevision: await revision(), letterNo: '256/', letterDate: '2026-04-01', destination: 'Bogor, Jawa Barat', startDate: '2026-04-06', endDate: '2026-04-07', employeeIds: ['1'], ...body }, who)
const create = async (body: Record<string, unknown>, who = 'super') => { const r = await post(body, who); expect(r.status).toBe(201); return (await r.json()) as { groupId: string; created: number; records: { id: string }[] } }
const state = async () => (await connection.db.select().from(workspaces).where(eq(workspaces.id, 'default')))[0].state
const rowsOf = async (groupId: string) => (await state()).files.flatMap(f => f.assignments).filter(a => a.groupId === groupId)
const PDF = Buffer.from('%PDF-1.4\n%fixture\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])
const upload = (groupId: string, bytes: Buffer, name: string, who = 'super', type = 'application/pdf') => {
  const form = new FormData(); form.append('file', new File([new Uint8Array(bytes)], name, { type }))
  return request(`/rekap-st/groups/${groupId}/attachments`, 'POST', form, who)
}
const list = async (period: string, who = 'super') => (await (await request(`/rekap-st?period=${period}`, 'GET', undefined, who)).json()) as { records: { id: string; groupId: string; status: string; cancelReason: string; external: boolean; note: string; catatan: string; version: number; registerOffice: string }[]; attachments: { id: string; groupId: string; fileName: string }[] }

beforeAll(async () => {
  const base = postgres('postgres://kppu:kppu-local@127.0.0.1:5544/postgres')
  try { if (!(await base`select 1 from pg_database where datname=${DB_NAME}`).length) await base.unsafe(`create database ${DB_NAME}`) } finally { await base.end() }
  await migrateDatabase(URL)
  await connection.sql.unsafe('TRUNCATE hr_internal.st_attachments, hr_internal.audit_events, hr_internal.sessions, hr_internal.users, hr_internal.workspaces, hr_internal.login_attempts CASCADE')
  await connection.db.insert(workspaces).values({ id: 'default', revision: 1, state: { ...emptyWorkspace(), master } })
  const accounts: [string, string, string[] | null][] = [['super', 'superadmin', null], ['admin', 'admin', null], ['op', 'operator_st', ['Pusat']], ['opk', 'operator_st', ['Kanwil I']]]
  for (const [key, role, offices] of accounts) {
    await createUser(connection.db, `${key}@kppu.test`, `${key} Test`, password, role as never, offices)
    const response = await request('/auth/login', 'POST', { email: `${key}@kppu.test`, password })
    expect(response.status).toBe(200)
    cookies[key] = response.headers.get('set-cookie')!.split(';')[0]
  }
})
afterAll(async () => { await connection.sql.end() })

describe('peserta lintas kantor', () => {
  test('operator Pusat melihat seluruh master (semua kantor) dengan kolom identitas dasar saja', async () => {
    const response = await request('/rekap-st/employees', 'GET', undefined, 'op')
    expect(response.status).toBe(200)
    const { employees } = await response.json() as { employees: Record<string, string>[] }
    expect(new Set(employees.map(e => e.kantor))).toEqual(new Set(['Pusat', 'Kanwil I', 'Kanwil II']))
    expect(employees.find(e => e.nama === 'Kepala Kanwil I')).toBeTruthy()
    expect(Object.keys(employees[0]).sort()).toEqual(['id', 'jabatan', 'kantor', 'nama', 'nip', 'unit'])
    const filtered = await (await request('/rekap-st/employees?office=Kanwil I', 'GET', undefined, 'op')).json() as { employees: { kantor: string }[] }
    expect(filtered.employees.every(e => e.kantor === 'Kanwil I')).toBe(true)
  })
  test('operator Pusat boleh memasukkan Kepala Kanwil I; register tetap Pusat', async () => {
    const { groupId } = await create({ letterNo: 'X-1/', employeeIds: ['4', '1'], startDate: '2026-04-06', endDate: '2026-04-06' }, 'op')
    const rows = await rowsOf(groupId)
    expect(rows.map(r => r.employeeId).sort()).toEqual(['1', '4'])
    expect(rows.every(r => r.office === 'Pusat')).toBe(true)
  })
  test('operator Kanwil tidak bisa memakai register kantor lain', async () => {
    const { groupId } = await create({ letterNo: 'X-2/', registerOffice: 'Pusat', employeeIds: ['1'], startDate: '2026-04-06', endDate: '2026-04-06' }, 'opk')
    expect((await rowsOf(groupId))[0].office).toBe('Kanwil I')
  })
  test('admin tidak bisa mengubah apa pun di Rekap ST', async () => {
    expect((await post({ employeeIds: ['1'], startDate: '2026-04-06', endDate: '2026-04-06' }, 'admin')).status).toBe(403)
    expect((await request('/rekap-st/groups/x', 'PUT', {}, 'admin')).status).toBe(403)
    expect((await request('/rekap-st/groups/x/void', 'POST', {}, 'admin')).status).toBe(403)
    expect((await request('/rekap-st/x/void', 'POST', {}, 'admin')).status).toBe(403)
    expect((await request('/rekap-st/attachments/x', 'DELETE', undefined, 'admin')).status).toBe(403)
    expect((await upload('x', PDF, 'a.pdf', 'admin')).status).toBe(403)
  })
})

describe('peserta Lainnya (eksternal)', () => {
  test('disimpan dengan penanda external dan keterangan, tanpa employeeId/NIP, tidak menjadi tugas identitas', async () => {
    const { groupId, created } = await create({ letterNo: 'EXT-1/', employeeIds: ['6'], externalParticipants: [{ name: 'Eko Yulianto', note: 'Driver Komisi' }, { name: 'ade supriyatna', note: 'Driver Komisi' }, { name: 'Eko  Yulianto' }], startDate: '2026-04-08', endDate: '2026-04-09' })
    expect(created).toBe(6)
    const rows = await rowsOf(groupId)
    const ext = rows.filter(r => r.external)
    expect(ext).toHaveLength(4)
    expect(ext.every(r => !r.employeeId && !r.nip)).toBe(true)
    expect(ext.find(r => r.name === 'Eko Yulianto')!.note).toBe('Driver Komisi')
    const s = await state()
    const roster = buildRoster(s.files, s.master, s.overrides, s.decisions)
    const stItems = roster.identity.filter(i => i.context === 'surat-tugas')
    expect(stItems.filter(i => /yulianto|supriyatna/i.test(i.name))).toHaveLength(0)
    expect(stItems.every(i => i.status === 'linked')).toBe(true) // tidak ada tugas pencocokan identitas
    expect(ext.every(r => !roster.assignmentLink.has(r.id))).toBe(true)
    expect(rows.filter(r => !r.external).every(r => roster.assignmentLink.get(r.id) === '6')).toBe(true)
    const view = await list('2026-04')
    expect(view.records.filter(r => r.groupId === groupId && r.external).map(r => r.note)).toContain('Driver Komisi')
    // Backup/restore tidak boleh menghapus penanda eksternal.
    const restored = migrateWorkspace(s)
    expect(restored.files.flatMap(f => f.assignments).filter(a => a.groupId === groupId && a.external)).toHaveLength(4)
  })
  test('peserta eksternal saja sudah cukup; tanpa peserta sama sekali 400', async () => {
    expect((await post({ letterNo: 'EXT-2/', employeeIds: [], externalParticipants: [{ name: 'Joko Driver' }], startDate: '2026-04-10', endDate: '2026-04-10' })).status).toBe(201)
    expect((await post({ letterNo: 'EXT-3/', employeeIds: [], externalParticipants: [], startDate: '2026-04-10', endDate: '2026-04-10' })).status).toBe(400)
    expect((await post({ letterNo: 'EXT-3/', employeeIds: [], externalParticipants: [{ name: 'A' }], startDate: '2026-04-10', endDate: '2026-04-10' })).status).toBe(400)
  })
})

describe('batas 300 peserta', () => {
  test('300 peserta diterima, 301 ditolak', async () => {
    const ids = master.slice(-300).map(e => e.id)
    expect((await post({ letterNo: 'BIG-1/', employeeIds: ids, startDate: '2026-05-04', endDate: '2026-05-04' })).status).toBe(201)
    const tooMany = await post({ letterNo: 'BIG-2/', employeeIds: [...ids, '1'], startDate: '2026-05-05', endDate: '2026-05-05' })
    expect(tooMany.status).toBe(400)
    // Gabungan pegawai master dan eksternal dihitung bersama.
    expect((await post({ letterNo: 'BIG-3/', employeeIds: ids, externalParticipants: [{ name: 'Joko Driver' }], startDate: '2026-05-06', endDate: '2026-05-06' })).status).toBe(400)
  })
})

describe('lampiran scan ST', () => {
  let groupId = '', attachmentId = ''
  test('deteksi byte awal dan nama file aman (unit)', () => {
    expect(detectAttachmentType(PDF)?.mime).toBe('application/pdf')
    expect(detectAttachmentType(PNG)?.mime).toBe('image/png')
    expect(detectAttachmentType(JPG)?.mime).toBe('image/jpeg')
    expect(detectAttachmentType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull()
    expect(detectAttachmentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(detectAttachmentType(Buffer.alloc(0))).toBeNull()
    expect(safeAttachmentName('..\\..\\evil"\r\n.pdf')).toBe('evil.pdf')
    expect(attachmentDisposition('Surat Tugas é.pdf', false)).toContain("filename*=UTF-8''Surat%20Tugas%20%C3%A9.pdf")
  })
  test('operator mengunggah PDF dan gambar; daftar memuat metadata, bukan isi', async () => {
    groupId = (await create({ letterNo: 'ATT-1/', employeeIds: ['1'], startDate: '2026-06-02', endDate: '2026-06-02' }, 'op')).groupId
    const a = await upload(groupId, PDF, 'ST 256.pdf', 'op')
    expect(a.status).toBe(201)
    attachmentId = (await a.json()).attachment.id
    expect((await upload(groupId, PNG, 'scan.PNG', 'op', 'image/png')).status).toBe(201)
    const view = await list('2026-06', 'op')
    const mine = view.attachments.filter(x => x.groupId === groupId)
    expect(mine.map(x => x.fileName)).toEqual(['ST 256.pdf', 'scan.PNG'])
    expect(JSON.stringify(view)).not.toContain('content')
    const [stored] = await connection.db.select().from(stAttachments).where(eq(stAttachments.id, attachmentId))
    expect(stored).toMatchObject({ mime: 'application/pdf', size: PDF.length, registerOffice: 'Pusat' })
    expect(stored.sha256).toHaveLength(64)
    expect(Buffer.compare(stored.content, PDF)).toBe(0)
  })
  test('unduh: Content-Type benar, Content-Disposition, nosniff; isi sama', async () => {
    const response = await request(`/rekap-st/attachments/${attachmentId}/file`, 'GET', undefined, 'op')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="ST 256.pdf"/)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.compare(Buffer.from(await response.arrayBuffer()), PDF)).toBe(0)
    const inline = await request(`/rekap-st/attachments/${attachmentId}/file?inline=1`, 'GET', undefined, 'admin')
    expect(inline.status).toBe(200)
    expect(inline.headers.get('content-disposition')).toMatch(/^inline;/)
  })
  test('byte tidak sesuai ditolak walau ekstensi dan Content-Type klien meyakinkan', async () => {
    expect((await upload(groupId, Buffer.from('<html><script>alert(1)</script></html>'), 'palsu.pdf', 'op')).status).toBe(415)
    expect((await upload(groupId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'gambar.png', 'op', 'image/png')).status).toBe(415)
    expect((await upload(groupId, PDF, 'bukan-png.png', 'op', 'image/png')).status).toBe(415) // PDF bernama .png
    expect((await upload(groupId, JPG, 'foto.gif', 'op', 'image/gif')).status).toBe(415)
    expect((await upload(groupId, Buffer.alloc(0), 'kosong.pdf', 'op')).status).toBe(400)
  })
  test('maksimal 3 lampiran, dan file kembar ditolak', async () => {
    expect((await upload(groupId, PDF, 'sama.pdf', 'op')).status).toBe(409) // isi sama dengan lampiran pertama
    expect((await upload(groupId, JPG, 'foto.jpg', 'op', 'image/jpeg')).status).toBe(201)
    const fourth = await upload(groupId, Buffer.concat([JPG, Buffer.from('lain')]), 'foto2.jpeg', 'op', 'image/jpeg')
    expect(fourth.status).toBe(409)
    expect((await fourth.json()).error).toMatch(/3 lampiran/)
  })
  test('batas ukuran 10 MB', async () => {
    const other = (await create({ letterNo: 'ATT-2/', employeeIds: ['2'], startDate: '2026-06-03', endDate: '2026-06-03' })).groupId
    const exact = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024 - PDF.length)])
    expect((await upload(other, exact, 'persis.pdf')).status).toBe(201)
    const over = Buffer.concat([JPG, Buffer.alloc(10 * 1024 * 1024)])
    expect((await upload(other, over, 'besar.jpg', 'super', 'image/jpeg')).status).toBe(413)
    const huge = Buffer.concat([JPG, Buffer.alloc(11 * 1024 * 1024)])
    expect((await upload(other, huge, 'raksasa.jpg', 'super', 'image/jpeg')).status).toBe(413)
  })
  test('operator kantor lain tidak bisa membaca, menulis, atau menghapus lampiran', async () => {
    expect((await request(`/rekap-st/attachments/${attachmentId}/file`, 'GET', undefined, 'opk')).status).toBe(403)
    expect((await upload(groupId, Buffer.concat([PNG, Buffer.from('x')]), 'x.png', 'opk', 'image/png')).status).toBe(403)
    expect((await request(`/rekap-st/attachments/${attachmentId}`, 'DELETE', undefined, 'opk')).status).toBe(403)
    expect((await list('2026-06', 'opk')).attachments.filter(x => x.groupId === groupId)).toHaveLength(0)
    expect((await request('/rekap-st/attachments/tidak-ada/file', 'GET', undefined, 'op')).status).toBe(404)
    expect((await request(`/rekap-st/attachments/${attachmentId}/file`, 'GET', undefined, 'anon')).status).toBe(401)
  })
  test('hapus lampiran bersifat lunak dan tercatat di audit; slot terbebas', async () => {
    expect((await request(`/rekap-st/attachments/${attachmentId}`, 'DELETE', undefined, 'op')).status).toBe(200)
    expect((await request(`/rekap-st/attachments/${attachmentId}/file`, 'GET', undefined, 'op')).status).toBe(404)
    const [row] = await connection.db.select().from(stAttachments).where(eq(stAttachments.id, attachmentId))
    expect(row.deletedAt).toBeTruthy()
    const actions = (await connection.db.select().from(auditEvents)).map(e => e.action)
    expect(actions).toContain('rekap-st.attachment-add'); expect(actions).toContain('rekap-st.attachment-remove')
    expect((await upload(groupId, Buffer.concat([PDF, Buffer.from('baru')]), 'pengganti.pdf', 'op')).status).toBe(201)
  })
  test('ST yang dibatalkan tidak menerima lampiran baru', async () => {
    const g = (await create({ letterNo: 'ATT-3/', employeeIds: ['3'], startDate: '2026-06-04', endDate: '2026-06-04' })).groupId
    expect((await request(`/rekap-st/groups/${g}/void`, 'POST', { expectedRevision: await revision(), reason: 'salah' })).status).toBe(200)
    expect((await upload(g, PDF, 'a.pdf')).status).toBe(409)
    expect((await upload('tidak-ada', PDF, 'a.pdf')).status).toBe(404)
  })
})

describe('koreksi ST', () => {
  const declare = async (period: string, status: 'complete' | 'nil') => {
    const s = await state()
    const host = s.files.find(f => f.id.startsWith('manual-st:') && f.office === 'Pusat' && f.period?.start.slice(0, 7) === period)!
    host.coverageDeclarations = [{ start: `${period}-01`, end: `${period}-30`, status, basis: 'Rekap ST bulan ini sudah lengkap', actorId: 'x', at: '2026-07-01T00:00:00Z' }]
    await connection.db.update(workspaces).set({ state: s, revision: (await revision()) + 1 }).where(eq(workspaces.id, 'default'))
    return host.id
  }
  test('mengubah no., tanggal, tujuan, peserta, catatan: baris diperbarui di tempat dengan jejak audit sebelum/sesudah', async () => {
    const { groupId } = await create({ letterNo: 'ED-1/', employeeIds: ['1', '2'], externalParticipants: [{ name: 'Joko Driver', note: 'Driver' }], startDate: '2026-07-06', endDate: '2026-07-07', catatan: 'Awal' }, 'op')
    const before = await rowsOf(groupId)
    const keptId = before.find(r => r.employeeId === '1' && r.start === '2026-07-06')!.id
    const response = await put(groupId, { letterNo: 'ED-1A/', letterDate: '2026-07-01', destination: 'Surabaya, Jawa Timur', startDate: '2026-07-06', endDate: '2026-07-08', employeeIds: ['1', '3'], externalParticipants: [{ name: 'Joko Driver', note: 'Driver Komisi' }], catatan: 'Setelah koreksi', reason: 'Salah ketik nomor' }, 'op')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ unchanged: false, groupId })
    const after = await rowsOf(groupId)
    // 3 peserta x 3 hari; peserta 2 dihapus (2 baris lama), selebihnya baru atau tetap.
    expect(after).toHaveLength(9)
    expect(after.every(r => r.letterNo === 'ED-1A/' && r.destination === 'Surabaya, Jawa Timur' && r.catatan === 'Setelah koreksi' && r.version === 2)).toBe(true)
    expect(after.some(r => r.employeeId === '2')).toBe(false)
    expect(after.find(r => r.id === keptId)).toBeTruthy() // ID baris yang tidak berubah dipertahankan
    expect(after.filter(r => r.external).every(r => r.note === 'Driver Komisi')).toBe(true)
    expect(after.every(r => r.local === false)).toBe(true)
    const events = (await connection.db.select().from(auditEvents)).filter(e => e.action === 'rekap-st.edit')
    const event = events.at(-1)!
    expect(event.reason).toContain('Salah ketik nomor')
    const d = event.details as { stEdit: { before: { letterNo: string; participants: { name: string }[]; rows: number }; after: { letterNo: string; rows: number; catatan: string }; added: number; removed: number; kept: number } }
    expect(d.stEdit.before).toMatchObject({ letterNo: 'ED-1/', rows: 6 })
    expect(d.stEdit.before.participants.map(p => p.name).sort()).toEqual(['Joko Driver', 'Pegawai 1', 'Pegawai 2'])
    expect(d.stEdit.after).toMatchObject({ letterNo: 'ED-1A/', rows: 9, catatan: 'Setelah koreksi' })
    expect(d.stEdit).toMatchObject({ removed: 2, kept: 4, added: 5 })
  })
  test('koreksi membuka kembali konfirmasi kelengkapan ST seluruh KPPU, sama seperti menambah ST', async () => {
    const { groupId } = await create({ letterNo: 'ED-2/', employeeIds: ['1'], startDate: '2026-08-03', endDate: '2026-08-03' })
    const hostId = await declare('2026-08', 'complete')
    expect((await put(groupId, { startDate: '2026-08-03', endDate: '2026-08-04', letterNo: 'ED-2/', reason: 'Tambah hari' })).status).toBe(200)
    const s = await state()
    const declarations = s.files.find(f => f.id === hostId)!.coverageDeclarations!
    // Sumber bulan itu sendiri (host) kehilangan deklarasi yang menimpa bulan; sumber ST lain dibuka kembali.
    expect(declarations.every(d => d.status !== 'complete')).toBe(true)
    const [event] = (await connection.db.select().from(auditEvents)).filter(e => e.action === 'rekap-st.edit').slice(-1)
    expect((event.details as { stEdit: { reopenedMonths: string[]; calcChanged: boolean } }).stEdit.calcChanged).toBe(true)
  })
  test('konfirmasi pada sumber ST kantor lain dibuka kembali (partial) dengan keterangan koreksi', async () => {
    const { groupId } = await create({ letterNo: 'ED-3/', employeeIds: ['1'], startDate: '2026-09-07', endDate: '2026-09-07' })
    await create({ letterNo: 'ED-3K/', registerOffice: 'Kanwil I', employeeIds: ['4'], startDate: '2026-09-08', endDate: '2026-09-08' })
    const s = await state()
    const kanwil = s.files.find(f => f.id.startsWith('manual-st:') && f.office === 'Kanwil I' && f.period?.start.startsWith('2026-09'))!
    kanwil.coverageDeclarations = [{ start: '2026-09-01', end: '2026-09-30', status: 'nil', basis: 'Tidak ada ST pada bulan ini', actorId: 'x', at: '2026-10-01T00:00:00Z' }]
    await connection.db.update(workspaces).set({ state: s, revision: (await revision()) + 1 }).where(eq(workspaces.id, 'default'))
    expect((await put(groupId, { startDate: '2026-09-07', endDate: '2026-09-07', letterNo: 'ED-3/', destination: 'Jakarta' })).status).toBe(200)
    const after = (await state()).files.find(f => f.id === kanwil.id)!.coverageDeclarations!
    expect(after.map(d => d.status)).toEqual(['partial'])
    expect(after[0].basis).toContain('dibuka kembali setelah koreksi ST ED-3/ (Pusat)')
  })
  test('koreksi yang memindahkan tanggal ke bulan lain memengaruhi kedua bulan', async () => {
    const { groupId } = await create({ letterNo: 'ED-4/', employeeIds: ['1'], startDate: '2026-10-05', endDate: '2026-10-05' })
    await declare('2026-10', 'complete')
    expect((await put(groupId, { letterNo: 'ED-4/', startDate: '2026-11-02', endDate: '2026-11-02' })).status).toBe(200)
    const s = await state()
    const october = s.files.find(f => f.id.startsWith('manual-st:') && f.office === 'Pusat' && f.period?.start.startsWith('2026-10'))!
    expect(october.coverageDeclarations!.every(d => d.status !== 'complete')).toBe(true)
    expect((await rowsOf(groupId)).map(r => r.start)).toEqual(['2026-11-02'])
  })
  test('hanya catatan berubah: tidak membuka konfirmasi; tanpa perubahan: tidak menaikkan revisi', async () => {
    const { groupId } = await create({ letterNo: 'ED-5/', employeeIds: ['1'], startDate: '2026-12-07', endDate: '2026-12-07' })
    const hostId = await declare('2026-12', 'complete')
    const same = await put(groupId, { letterNo: 'ED-5/', startDate: '2026-12-07', endDate: '2026-12-07' })
    expect(await same.json()).toMatchObject({ unchanged: true })
    const rev = await revision()
    expect((await put(groupId, { letterNo: 'ED-5/', startDate: '2026-12-07', endDate: '2026-12-07', catatan: 'Hanya catatan' })).status).toBe(200)
    expect((await state()).files.find(f => f.id === hostId)!.coverageDeclarations!.map(d => d.status)).toEqual(['complete'])
    expect(await revision()).toBe(rev + 1)
    const view = await list('2026-12')
    expect(view.records.find(r => r.groupId === groupId)!.catatan).toBe('Hanya catatan')
  })
  test('otorisasi: operator kantor lain 403, register tidak bisa diganti, ST batal tidak bisa diedit, duplikat 409, revisi basi 409', async () => {
    const { groupId } = await create({ letterNo: 'ED-6/', employeeIds: ['1'], startDate: '2027-01-04', endDate: '2027-01-04' }, 'op')
    expect((await put(groupId, { letterNo: 'ED-6/', startDate: '2027-01-04', endDate: '2027-01-04', catatan: 'x' }, 'opk')).status).toBe(403)
    expect((await put(groupId, { letterNo: 'ED-6/', registerOffice: 'Kanwil I', startDate: '2027-01-04', endDate: '2027-01-04', catatan: 'x' })).status).toBe(400)
    expect((await put('tidak-ada', { startDate: '2027-01-04', endDate: '2027-01-04' })).status).toBe(404)
    const other = (await create({ letterNo: 'ED-7/', employeeIds: ['2'], startDate: '2027-01-04', endDate: '2027-01-04' }, 'op')).groupId
    expect((await put(other, { letterNo: 'ED-6/', employeeIds: ['1'], startDate: '2027-01-04', endDate: '2027-01-04' }, 'op')).status).toBe(409)
    const stale = await request(`/rekap-st/groups/${groupId}`, 'PUT', { expectedRevision: 1, letterNo: 'ED-6/', letterDate: '2026-04-01', destination: 'Bogor, Jawa Barat', startDate: '2027-01-04', endDate: '2027-01-04', employeeIds: ['1'], catatan: 'baru' }, 'op')
    expect(stale.status).toBe(409)
    expect((await request(`/rekap-st/groups/${groupId}/void`, 'POST', { expectedRevision: await revision(), reason: 'Batal' }, 'op')).status).toBe(200)
    expect((await put(groupId, { letterNo: 'ED-6/', startDate: '2027-01-04', endDate: '2027-01-04', catatan: 'y' }, 'op')).status).toBe(409)
  })
})

describe('GET /api/rekap-st/groups/:id (ST lintas bulan)', () => {
  test('memuat seluruh baris semua bulan, termasuk lampiran; dibatasi kantor', async () => {
    const { groupId } = await create({ letterNo: 'GRP-1/', employeeIds: ['1'], startDate: '2027-04-29', endDate: '2027-05-02' }, 'op')
    await upload(groupId, PDF, 'grp.pdf', 'op')
    const response = await request(`/rekap-st/groups/${groupId}`, 'GET', undefined, 'op')
    expect(response.status).toBe(200)
    const body = await response.json() as { records: { activityDate: string }[]; attachments: { fileName: string }[] }
    expect(body.records.map(r => r.activityDate)).toEqual(['2027-04-29', '2027-04-30', '2027-05-01', '2027-05-02'])
    expect(body.attachments.map(a => a.fileName)).toEqual(['grp.pdf'])
    expect((await request(`/rekap-st/groups/${groupId}`, 'GET', undefined, 'opk')).status).toBe(403)
    expect((await request(`/rekap-st/groups/${groupId}`, 'GET', undefined, 'admin')).status).toBe(200)
    expect((await request('/rekap-st/groups/nope', 'GET', undefined, 'op')).status).toBe(404)
  })
  test('koreksi ST lintas bulan menjaga baris bulan lain', async () => {
    const { groupId } = await create({ letterNo: 'GRP-2/', employeeIds: ['1'], startDate: '2027-06-30', endDate: '2027-07-01' })
    expect((await put(groupId, { letterNo: 'GRP-2/', startDate: '2027-06-30', endDate: '2027-07-01', catatan: 'lintas bulan' })).status).toBe(200)
    expect((await rowsOf(groupId)).map(r => r.start)).toEqual(['2027-06-30', '2027-07-01'])
  })
})

describe('batalkan ST', () => {
  test('alasan minimal 3 karakter; seluruh baris dibatalkan dengan alasan; tampil sebagai Dibatalkan', async () => {
    const { groupId } = await create({ letterNo: 'VD-1/', employeeIds: ['1', '2'], externalParticipants: [{ name: 'Joko Driver' }], startDate: '2027-02-01', endDate: '2027-02-02' }, 'op')
    const short = await request(`/rekap-st/groups/${groupId}/void`, 'POST', { expectedRevision: await revision(), reason: 'ab' }, 'op')
    expect(short.status).toBe(400)
    expect((await request(`/rekap-st/groups/${groupId}/void`, 'POST', { expectedRevision: await revision(), reason: 'Salah' }, 'opk')).status).toBe(403)
    const done = await request(`/rekap-st/groups/${groupId}/void`, 'POST', { expectedRevision: await revision(), reason: 'ST dibatalkan pimpinan' }, 'op')
    expect(done.status).toBe(200)
    const rows = (await list('2027-02', 'op')).records.filter(r => r.groupId === groupId)
    expect(rows).toHaveLength(6)
    expect(rows.every(r => r.status === 'excluded' && r.cancelReason === 'ST dibatalkan pimpinan')).toBe(true)
    expect((await request(`/rekap-st/groups/${groupId}/void`, 'POST', { expectedRevision: await revision(), reason: 'Sekali lagi' }, 'op')).status).toBe(409)
    // Pembatalan keluar dari perhitungan.
    const s = await state()
    const roster = buildRoster(s.files, s.master, s.overrides, s.decisions)
    expect(rows.every(r => !roster.assignmentLink.has(r.id))).toBe(true)
    const events = (await connection.db.select().from(auditEvents)).filter(e => e.action === 'rekap-st.void-group')
    expect(events.at(-1)!.reason).toBe('ST dibatalkan pimpinan')
  })
  test('batalkan satu baris: operator kantor sendiri boleh, kantor lain 403', async () => {
    const { records } = await create({ letterNo: 'VD-2/', employeeIds: ['1'], startDate: '2027-03-01', endDate: '2027-03-01' }, 'op')
    const id = records[0].id
    expect((await request(`/rekap-st/${id}/void`, 'POST', { expectedRevision: await revision(), reason: 'Ok' }, 'opk')).status).toBe(400)
    expect((await request(`/rekap-st/${id}/void`, 'POST', { expectedRevision: await revision(), reason: 'Bukan kantor saya' }, 'opk')).status).toBe(403)
    expect((await request(`/rekap-st/${id}/void`, 'POST', { expectedRevision: await revision(), reason: 'Salah orang' }, 'op')).status).toBe(200)
  })
  test('data lama tanpa groupId tetap dikelompokkan, dibatalkan, dan dikoreksi lewat ID turunan', async () => {
    const s = await state()
    const legacy = s.files.find(f => f.id.startsWith('manual-st:') && f.office === 'Pusat' && f.period?.start.startsWith('2026-04'))!
    const row = legacy.assignments.find(a => a.groupId)!
    delete row.groupId; delete row.version
    await connection.db.update(workspaces).set({ state: s, revision: (await revision()) + 1 }).where(eq(workspaces.id, 'default'))
    const view = await list('2026-04')
    const record = view.records.find(r => r.id === row.id)!
    expect(record.groupId.startsWith('legacy-')).toBe(true)
    expect(record.version).toBe(1)
    // Koreksi tetap memakai ID turunan, sehingga lampiran dan pengelompokan tidak putus.
    const siblings = view.records.filter(r => r.groupId === record.groupId)
    const edit = await request(`/rekap-st/groups/${record.groupId}`, 'PUT', { expectedRevision: await revision(), letterNo: row.letterNo, letterDate: row.letterDate, destination: row.destination, startDate: '2026-04-06', endDate: '2026-04-06', employeeIds: [row.employeeId], catatan: 'Dikoreksi' })
    expect(edit.status).toBe(200)
    const after = (await list('2026-04')).records.filter(r => r.groupId === record.groupId && r.status === 'active')
    expect(after.length).toBeGreaterThan(0)
    expect(siblings.length).toBeGreaterThan(0)
    expect(after.every(r => r.catatan === 'Dikoreksi')).toBe(true)
  })
})
