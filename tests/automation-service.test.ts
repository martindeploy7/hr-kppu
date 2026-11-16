import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { connect, connectLock } from '../server/db.ts'
import { migrateDatabase } from '../server/migrate.ts'
import { createUser } from '../server/create-user.ts'
import { AutomationService } from '../server/automation.ts'
import { WhatsAppNotReadyError, WhatsAppRecipientError, type WhatsAppConnector } from '../server/whatsapp.ts'
import { users, waOutbox, workspaces } from '../server/schema.ts'
import { emptyWorkspace } from '../shared/workspace.ts'
import { blankEmployee } from '../src/engine/roster.ts'
import type { Employee } from '../src/engine/types.ts'
import type { WhatsAppStatus } from '../shared/whatsapp.ts'

const URL = process.env.AUTOMATION_TEST_DATABASE_URL ?? 'postgres://kppu:kppu-local@127.0.0.1:5544/kppu_automation_test'
const parsed = new globalThis.URL(URL)
if (!parsed.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('Integration tests require a local database ending in _test')
const connection = connect(URL)
const db = connection.db

class FakeWhatsApp implements WhatsAppConnector {
  ready = true
  sent: { to: string; text: string }[] = []
  failNext: Error[] = []
  status(): WhatsAppStatus { return { configured: true, status: this.ready ? 'connected' : 'reconnecting' } }
  async connect() {}
  async disconnect() {}
  async close() {}
  async ensureConnected() {}
  isReady() { return this.ready }
  async sendText(to: string, text: string) {
    const e = this.failNext.shift()
    if (e) throw e
    if (!this.ready) throw new WhatsAppNotReadyError('WhatsApp belum terhubung')
    this.sent.push({ to, text })
    return { id: `msg-${this.sent.length}` }
  }
}

let clock = new Date('2026-12-25T01:30:00Z') // 08:30 WIB, Natal
const emp = (id: string, change: Partial<Employee>): Employee => ({ ...blankEmployee(id), nama: `Pegawai ${id}`, kantor: 'Pusat', jabatan: 'Analis', golongan: 'III/a', unit: 'Biro SDM', nomorWhatsApp: `08120000${id.padStart(4, '0')}`, ...change })
let master: Employee[] = []
let actor = { id: '' }
const setWorkspace = async (employees: Employee[]) => {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, 'default'))
  const state = { ...emptyWorkspace(), master: employees }
  if (!w) await db.insert(workspaces).values({ id: 'default', state, revision: 1 })
  else await db.update(workspaces).set({ state, revision: w.revision + 1 }).where(eq(workspaces.id, 'default'))
}
const service = (wa: WhatsAppConnector | undefined = new FakeWhatsApp(), extra = {}) => new AutomationService(db, wa, { now: () => clock, log: () => undefined, random: () => 0, ...extra })
const outbox = async () => db.select().from(waOutbox)
const drain = async (s: AutomationService) => { const results = []; for (let i = 0; i < 50; i++) { const r = await s.sendNext(); results.push(r); if (r.result === 'idle' || r.result === 'waiting') break } return results }

beforeAll(async () => {
  const base = postgres('postgres://kppu:kppu-local@127.0.0.1:5544/postgres')
  try { if (!(await base`select 1 from pg_database where datname='kppu_automation_test'`).length) await base.unsafe('create database kppu_automation_test') } finally { await base.end() }
  await migrateDatabase(URL)
})
beforeEach(async () => {
  await connection.sql.unsafe('TRUNCATE hr_internal.wa_outbox, hr_internal.wa_campaigns, hr_internal.wa_automation_rules, hr_internal.wa_automation_settings, hr_internal.wa_holidays, hr_internal.wa_employee_snapshots, hr_internal.workspaces, hr_internal.audit_events, hr_internal.sessions, hr_internal.users CASCADE')
  const u = await createUser(db, 'super@kppu.test', 'Super', 'password-panjang-sekali-123', 'superadmin')
  actor = { id: (u as { id?: string })?.id ?? (await db.select().from(users))[0].id }
  clock = new Date('2026-12-25T01:30:00Z')
  master = [
    emp('1', { nama: 'BUDI SANTOSO', jenisKelamin: 'Laki-laki', agama: 'Kristen', tanggalLahir: '1990-12-25' }),
    emp('2', { agama: 'Katolik', jenisKelamin: 'Perempuan' }),
    emp('3', { agama: 'Islam', tanggalMulaiKerja: '2016-12-25' }),
    emp('4', { agama: 'Kristen', nomorWhatsApp: '' }),
  ]
  await setWorkspace(master)
})
afterAll(async () => { await connection.sql.end() })

describe('scheduler automation', () => {
  test('mengantrikan ulang tahun, Natal, dan masa kerja sekali saja walau berdetak berulang', async () => {
    const s = service()
    await s.updateSettings({ testMode: false }, actor)
    await s.tick(); await s.tick()
    const rows = await outbox()
    const keys = rows.map(r => r.dedupeKey).sort()
    expect(keys).toEqual(['anniversary:2026:3', 'birthday:2026:1', 'religion:2026-12-25:natal:1', 'religion:2026-12-25:natal:2', 'religion:2026-12-25:natal:4'])
    expect(rows.find(r => r.employeeId === '4')).toMatchObject({ status: 'skipped', lastError: expect.stringContaining('Nomor WhatsApp') })
    expect(rows.find(r => r.dedupeKey === 'birthday:2026:1')?.message).toContain('Bapak Budi Santoso')
  })

  test('sebelum jam kirim tidak ada yang diantrikan; catch-up di hari yang sama setelah server hidup lagi', async () => {
    const s = service()
    await s.updateSettings({ testMode: false }, actor)
    clock = new Date('2026-12-24T23:00:00Z') // 06:00 WIB
    await s.tick()
    expect(await outbox()).toHaveLength(0)
    clock = new Date('2026-12-25T07:00:00Z') // 14:00 WIB: server baru hidup, ucapan pagi tetap terkirim
    await s.tick()
    expect((await outbox()).filter(r => r.status === 'pending')).toHaveLength(4)
  })

  test('mengirim dengan WhatsApp, retry saat gagal sementara, melewati nomor yang tidak terdaftar', async () => {
    const wa = new FakeWhatsApp()
    const s = service(wa)
    await s.updateSettings({ testMode: false, maxAttempts: 3 }, actor)
    await s.tick()
    wa.failNext = [new Error('timeout jaringan'), new WhatsAppRecipientError('Nomor tidak terdaftar di WhatsApp')]
    await drain(s)
    const rows = await outbox()
    expect(wa.sent).toHaveLength(2)
    expect(rows.filter(r => r.status === 'sent')).toHaveLength(2)
    const retrying = rows.find(r => r.lastError === 'timeout jaringan')!
    expect(retrying).toMatchObject({ status: 'pending', attempts: 1 })
    expect(retrying.nextAttemptAt!.getTime()).toBe(clock.getTime() + 60_000)
    expect(rows.find(r => r.lastError?.includes('tidak terdaftar'))?.status).toBe('skipped')
    clock = new Date(clock.getTime() + 61_000)
    await drain(s)
    expect((await outbox()).find(r => r.id === retrying.id)?.status).toBe('sent')
  })

  test('WhatsApp terputus: pesan menunggu tanpa menghabiskan percobaan', async () => {
    const wa = new FakeWhatsApp()
    wa.ready = false
    const s = service(wa)
    await s.updateSettings({ testMode: false }, actor)
    await s.tick()
    const r = await s.sendNext()
    expect(r).toMatchObject({ result: 'waiting', waiting: expect.stringContaining('WhatsApp belum terhubung') })
    expect((await outbox()).every(x => x.attempts === 0 && x.status !== 'sending')).toBe(true)
    wa.ready = true
    await drain(s)
    expect(wa.sent).toHaveLength(4)
  })

  test('di luar jam kirim pesan menunggu; ucapan yang lewat hari kedaluwarsa', async () => {
    const wa = new FakeWhatsApp()
    const s = service(wa)
    await s.updateSettings({ testMode: false }, actor)
    await s.tick()
    clock = new Date('2026-12-25T14:00:00Z') // 21:00 WIB
    expect((await s.sendNext()).waiting).toContain('Di luar jam kirim')
    clock = new Date('2026-12-26T01:00:00Z')
    await s.tick()
    expect((await outbox()).filter(r => r.status === 'expired')).toHaveLength(4)
    expect(wa.sent).toHaveLength(0)
  })

  test('mode uji: dialihkan ke nomor uji dengan label penerima asli, dedupe terpisah dari kiriman sungguhan', async () => {
    const wa = new FakeWhatsApp()
    const s = service(wa)
    await s.tick()
    expect((await outbox()).every(r => r.status === 'skipped' && r.lastError?.includes('nomor uji'))).toBe(true)
    await connection.sql.unsafe('TRUNCATE hr_internal.wa_outbox')
    await s.updateSettings({ testNumbers: ['0811-1111-2222'], testDailyLimit: 3 }, actor)
    await s.tick()
    const rows = await outbox()
    expect(rows.every(r => r.dedupeKey.startsWith('uji:') && r.test)).toBe(true)
    expect(rows.filter(r => r.status === 'pending').every(r => r.deliverTo === '6281111112222')).toBe(true)
    expect(rows.filter(r => r.status === 'skipped' && r.lastError?.includes('Batas harian mode uji'))).toHaveLength(2)
    await drain(s)
    expect(wa.sent.every(m => m.to === '6281111112222' && m.text.startsWith('[UJI · untuk '))).toBe(true)
    await s.updateSettings({ testMode: false }, actor)
    await s.tick()
    expect((await outbox()).filter(r => !r.test && r.status === 'pending')).toHaveLength(4)
  })

  test('simulasi: ditandai terkirim tanpa WhatsApp', async () => {
    const s = service(undefined)
    await s.updateSettings({ testMode: false, dryRun: true }, actor)
    await s.tick()
    await drain(s)
    expect((await outbox()).filter(r => r.status === 'sent' && r.waMessageId?.startsWith('simulasi'))).toHaveLength(4)
  })

  test('perubahan jabatan: snapshot awal tanpa pesan, perubahan berikutnya diberitahukan', async () => {
    const s = service()
    await s.updateSettings({ testMode: false }, actor)
    await s.updateRule('rolechange', { enabled: true }, actor)
    await s.tick()
    expect((await outbox()).filter(r => r.ruleId === 'rolechange')).toHaveLength(0)
    await setWorkspace(master.map(e => e.id === '2' ? { ...e, jabatan: 'Kepala Bagian' } : e))
    await s.tick(); await s.tick()
    const changes = (await outbox()).filter(r => r.ruleId === 'rolechange')
    expect(changes).toHaveLength(1)
    expect(changes[0].employeeId).toBe('2')
    expect(changes[0].message).not.toContain('Kepala Bagian') // isi perubahan hanya di portal
  })

  test('kampanye: audiens per agama, dijadwalkan lalu diantrikan saat jatuh tempo', async () => {
    const s = service()
    await s.updateSettings({ testMode: false }, actor)
    const campaign = await s.createCampaign({ ruleId: 'performance', title: 'SPT Tahunan', template: 'Yth. {{sapaan}} {{nama}}, pengingat {{jenis_pengingat}} sebelum {{batas_waktu}}: {{tautan_resmi}}', variables: { jenis_pengingat: 'SPT Tahunan', batas_waktu: '31 Maret 2027', tautan_resmi: 'https://djponline.pajak.go.id' }, audience: { kind: 'agama', values: ['Kristen', 'Katolik'] }, sendAt: '2026-12-25T03:00:00.000Z', repeatMonthly: false }, actor)
    await s.tick()
    expect((await outbox()).filter(r => r.campaignId === campaign.id)).toHaveLength(0)
    clock = new Date('2026-12-25T03:01:00Z')
    await s.tick(); await s.tick()
    const rows = (await outbox()).filter(r => r.campaignId === campaign.id)
    expect(rows.map(r => r.employeeId).sort()).toEqual(['1', '2', '4'])
    expect((await s.campaigns())[0]).toMatchObject({ status: 'done', recipients: 3 })
    await expect(s.createCampaign({ ruleId: 'performance', title: 'X', template: 'Halo {{nama}} {{batas_waktu}}', variables: {}, audience: { kind: 'all' }, sendAt: '2026-12-26T03:00:00.000Z' }, actor)).rejects.toThrow('batas_waktu')
  })

  test('hanya satu instance yang menjadi pemimpin scheduler', async () => {
    const lockA = connectLock(URL), lockB = connectLock(URL)
    const a = service(new FakeWhatsApp(), { lockSql: lockA }), b = service(new FakeWhatsApp(), { lockSql: lockB })
    try {
      await a.tick(); await b.tick()
      expect(a.state.role).toBe('leader')
      expect(b.state.role).toBe('standby')
      await lockA.end() // instance A mati → kunci lepas → B mengambil alih
      await b.tick()
      expect(b.state.role).toBe('leader')
    } finally { await lockB.end().catch(() => undefined); await lockA.end().catch(() => undefined) }
  })

  test('item yang terputus saat mengirim ditandai gagal, tidak dikirim ganda', async () => {
    const s = service()
    await s.updateSettings({ testMode: false }, actor)
    await s.tick()
    const [first] = await outbox()
    await db.update(waOutbox).set({ status: 'sending', updatedAt: new Date(clock.getTime() - 10 * 60_000) }).where(eq(waOutbox.id, first.id))
    const fresh = service()
    await fresh.tick()
    expect((await outbox()).find(r => r.id === first.id)).toMatchObject({ status: 'failed', lastError: expect.stringContaining('tidak pasti') })
  })

  test('ringkasan: agenda 30 hari, peringatan hari raya belum dikonfirmasi, pratinjau', async () => {
    clock = new Date('2026-12-20T03:00:00Z')
    const s = service()
    const o = await s.overview()
    expect(o.upcoming.some(u => u.ruleId === 'religion' && u.date === '2026-12-25' && u.recipients === 3)).toBe(true)
    expect(o.upcoming.some(u => u.ruleId === 'birthday' && u.date === '2026-12-25')).toBe(true)
    expect(o.warnings.some(w => w.includes('Mode uji aktif'))).toBe(true)
    expect(o.warnings.some(w => w.includes('belum dikonfirmasi'))).toBe(true) // Isra Mi'raj 2027-01-05 perkiraan
    const p = await s.preview('religion', '2026-12-25')
    expect(p.recipients).toHaveLength(2)
    expect(p.missingPhone.map(m => m.employeeId)).toEqual(['4'])
  })
})
