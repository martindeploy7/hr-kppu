import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, isNull, or, sql as dsql } from 'drizzle-orm'
import type { Sql } from 'postgres'
import type { Database } from './db.ts'
import { auditEvents, waAutomationRules, waAutomationSettings, waCampaigns, waEmployeeSnapshots, waHolidays, waOutbox, workspaces } from './schema.ts'
import { WhatsAppNotReadyError, WhatsAppRecipientError, type WhatsAppConnector } from './whatsapp.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { addDays } from '../src/engine/dates.ts'
import type { Employee, SourceFile } from '../src/engine/types.ts'
import {
  DEFAULT_AUTOMATION_SETTINGS, DEFAULT_HOLIDAYS, RULE_DEFS, isHHMM, normalizePhone,
  type AutomationCounts, type AutomationOverview, type AutomationRule, type AutomationRuleId, type AutomationRuleOptions, type AutomationSettings,
  type Campaign, type CampaignAudience, type OutboxItem, type OutboxStatus, type ReligiousHoliday, type RulePreview, type SchedulerState,
} from '../shared/automation.ts'
import {
  audienceOf, campaignOccurrence, hhmmToMinutes, planCampaign, planRule, roleFingerprint, shortHash, wib, wibInstant, displayName,
  type Draft, type PlanInput,
} from './automationPlanner.ts'

/** Kesalahan input yang aman ditampilkan ke pengguna (dipetakan ke HTTP 400 oleh API). */
export class AutomationInputError extends Error {}

export type AutomationOptions = {
  now?: () => Date
  /** Koneksi Postgres khusus (max 1) untuk advisory lock; tanpa ini instance selalu dianggap pemimpin. */
  lockSql?: Sql
  tickMs?: number
  log?: (message: string) => void
  random?: () => number
}

type Actor = { id: string }
type WorkspaceData = { revision: number; employees: Employee[]; files: SourceFile[]; evidenceLink: Map<string, string>; publicHolidays: string[] }

const LOCK_KEY = 72026111 // kunci advisory "kppu-wa-automation"
const RETRY_BACKOFF_MIN = [1, 5, 15, 60, 180]
const ROLE_CHANGE_BULK_LIMIT = 20
const ruleDef = new Map(RULE_DEFS.map(r => [r.id, r]))
const WRITE_ROLES = new Set(['superadmin'])
const READ_ROLES = new Set(['superadmin', 'admin'])
export const canReadAutomation = (role: string) => READ_ROLES.has(role)
export const canWriteAutomation = (role: string) => WRITE_ROLES.has(role)

export const maskPhone = (p: string) => p.length > 7 ? `${p.slice(0, 5)}•••${p.slice(-4)}` : p

function toItem(r: typeof waOutbox.$inferSelect): OutboxItem {
  return {
    id: r.id, dedupeKey: r.dedupeKey, ruleId: r.ruleId, campaignId: r.campaignId ?? undefined, employeeId: r.employeeId ?? undefined, recipientName: r.recipientName,
    phone: r.phone, deliverTo: r.deliverTo, test: r.test, message: r.message, scheduledFor: r.scheduledFor.toISOString(), expiresAt: r.expiresAt.toISOString(),
    status: r.status, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt?.toISOString(), lastError: r.lastError ?? undefined, sentAt: r.sentAt?.toISOString(), createdAt: r.createdAt.toISOString(),
  }
}
function toCampaign(r: typeof waCampaigns.$inferSelect): Campaign {
  return {
    id: r.id, ruleId: r.ruleId, title: r.title, template: r.template, variables: r.variables, audience: r.audience, sendAt: r.sendAt.toISOString(), repeatMonthly: r.repeatMonthly,
    status: r.status, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), lastRunOn: r.lastRunOn ?? undefined, recipients: r.recipients ?? undefined,
  }
}

export function validateSettings(patch: Partial<AutomationSettings>): Partial<AutomationSettings> {
  const out: Partial<AutomationSettings> = {}
  const bool = (k: 'testMode' | 'dryRun' | 'paused') => { if (patch[k] !== undefined) { if (typeof patch[k] !== 'boolean') throw new AutomationInputError(`${k} harus boolean`); out[k] = patch[k] } }
  const int = (k: 'testDailyLimit' | 'minIntervalSec' | 'jitterSec' | 'dailyLimit' | 'maxAttempts', min: number, max: number) => {
    if (patch[k] === undefined) return
    const v = Number(patch[k])
    if (!Number.isInteger(v) || v < min || v > max) throw new AutomationInputError(`${k} harus bilangan bulat ${min}–${max}`)
    out[k] = v
  }
  bool('testMode'); bool('dryRun'); bool('paused')
  int('testDailyLimit', 1, 500); int('minIntervalSec', 2, 600); int('jitterSec', 0, 600); int('dailyLimit', 1, 5000); int('maxAttempts', 1, 10)
  for (const k of ['windowStart', 'windowEnd'] as const) if (patch[k] !== undefined) { if (!isHHMM(String(patch[k]))) throw new AutomationInputError(`${k} harus HH:MM`); out[k] = patch[k] }
  if (out.windowStart && out.windowEnd && out.windowStart >= out.windowEnd) throw new AutomationInputError('Jam mulai kirim harus sebelum jam selesai')
  if (patch.testNumbers !== undefined) {
    if (!Array.isArray(patch.testNumbers) || patch.testNumbers.length > 10) throw new AutomationInputError('Nomor uji maksimal 10')
    out.testNumbers = [...new Set(patch.testNumbers.map(n => { const p = normalizePhone(String(n)); if (!p) throw new AutomationInputError(`Nomor uji tidak valid: ${n}`); return p }))]
  }
  if (patch.portalUrl !== undefined) {
    try { if (!/^https?:$/.test(new URL(String(patch.portalUrl)).protocol)) throw new Error() } catch { throw new AutomationInputError('Tautan portal harus URL http/https') }
    out.portalUrl = String(patch.portalUrl)
  }
  if (patch.signature !== undefined) { const s = String(patch.signature).trim(); if (!s || s.length > 120) throw new AutomationInputError('Nama pengirim 1–120 karakter'); out.signature = s }
  return out
}

function validateTemplate(template: string, tokens: string[]) {
  if (!template.trim() || template.length > 2000) throw new AutomationInputError('Template wajib diisi (maksimal 2000 karakter)')
  const unknown = [...template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m => m[1]).filter(t => !tokens.includes(t))
  if (unknown.length) throw new AutomationInputError(`Token tidak dikenal: ${[...new Set(unknown)].map(t => `{{${t}}}`).join(', ')}`)
}

export class AutomationService {
  readonly state: SchedulerState = { role: 'stopped', lastPlanned: {} }
  private running = false
  private tickTimer: ReturnType<typeof setTimeout> | undefined
  private senderWake: (() => void) | undefined
  private senderDone: Promise<void> | undefined
  private ticking: Promise<void> | undefined
  private cache: WorkspaceData | undefined
  private lockHeld = false
  private readonly now: () => Date
  private readonly log: (m: string) => void
  private readonly random: () => number

  constructor(private readonly db: Database, private readonly whatsapp?: WhatsAppConnector, private readonly opts: AutomationOptions = {}) {
    this.now = opts.now ?? (() => new Date())
    this.log = opts.log ?? (m => console.log(`[automation] ${m}`))
    this.random = opts.random ?? Math.random
  }

  // ---------- Konfigurasi ----------
  async settings(): Promise<AutomationSettings> {
    const [row] = await this.db.select().from(waAutomationSettings).where(eq(waAutomationSettings.id, 'default'))
    return { ...DEFAULT_AUTOMATION_SETTINGS, ...(row?.settings ?? {}) }
  }

  async rules(): Promise<AutomationRule[]> {
    const rows = new Map((await this.db.select().from(waAutomationRules)).map(r => [r.id, r]))
    return RULE_DEFS.map(def => {
      const row = rows.get(def.id)
      return {
        ...def, enabled: row?.enabled ?? def.defaultEnabled, sendTime: row?.sendTime ?? def.defaultSendTime, template: row?.template ?? def.defaultTemplate,
        options: { ...(def.defaultOptions ?? {}), ...(row?.options ?? {}) }, updatedAt: row?.updatedAt.toISOString(), updatedBy: row?.updatedBy ?? undefined,
      }
    })
  }

  async holidays(): Promise<ReligiousHoliday[]> {
    let rows = await this.db.select().from(waHolidays).orderBy(asc(waHolidays.date))
    if (!rows.length) {
      await this.db.insert(waHolidays).values(DEFAULT_HOLIDAYS).onConflictDoNothing()
      rows = await this.db.select().from(waHolidays).orderBy(asc(waHolidays.date))
    }
    return rows
  }

  async updateSettings(patch: Partial<AutomationSettings>, actor: Actor) {
    const clean = validateSettings(patch)
    const current = await this.settings()
    const next = { ...current, ...clean }
    if (next.windowStart >= next.windowEnd) throw new AutomationInputError('Jam mulai kirim harus sebelum jam selesai')
    await this.db.transaction(async tx => {
      await tx.insert(waAutomationSettings).values({ id: 'default', settings: next, updatedBy: actor.id }).onConflictDoUpdate({ target: waAutomationSettings.id, set: { settings: next, updatedAt: new Date(), updatedBy: actor.id } })
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'automation.settings', revision: 0, reason: 'Pengaturan automation WhatsApp diubah', details: { changed: clean } })
    })
    this.wake()
  }

  async updateRule(id: string, patch: { enabled?: boolean; sendTime?: string; template?: string; options?: AutomationRuleOptions }, actor: Actor) {
    const def = ruleDef.get(id as AutomationRuleId)
    if (!def) throw new AutomationInputError('Aturan tidak dikenal')
    const current = (await this.rules()).find(r => r.id === id)!
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new AutomationInputError('enabled harus boolean')
    if (patch.sendTime !== undefined && !isHHMM(patch.sendTime)) throw new AutomationInputError('Jam kirim harus HH:MM')
    if (patch.template !== undefined) validateTemplate(patch.template, def.tokens)
    const options = { ...current.options }
    if (patch.options?.milestones !== undefined) {
      const m = patch.options.milestones
      if (!Array.isArray(m) || m.some(x => !Number.isInteger(x) || x < 1 || x > 50)) throw new AutomationInputError('Milestone masa kerja harus tahun 1–50')
      options.milestones = [...new Set(m)].sort((a, b) => a - b)
    }
    if (patch.options?.lookbackDays !== undefined) {
      const v = patch.options.lookbackDays
      if (!Number.isInteger(v) || v < 1 || v > 60) throw new AutomationInputError('Rentang hari harus 1–60')
      options.lookbackDays = v
    }
    if (patch.options?.months !== undefined) {
      const m = patch.options.months
      if (!Array.isArray(m) || m.some(x => !Number.isInteger(x) || x < 1 || x > 12)) throw new AutomationInputError('Bulan harus 1–12')
      options.months = [...new Set(m)].sort((a, b) => a - b)
    }
    const row = { id, enabled: patch.enabled ?? current.enabled, sendTime: patch.sendTime ?? current.sendTime, template: patch.template ?? current.template, options, updatedAt: new Date(), updatedBy: actor.id }
    await this.db.transaction(async tx => {
      await tx.insert(waAutomationRules).values(row).onConflictDoUpdate({ target: waAutomationRules.id, set: row })
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'automation.rule', revision: 0, reason: `Aturan "${def.title}" diubah`, details: { ruleId: id, patch } })
    })
    this.wake()
  }

  async setHolidays(list: ReligiousHoliday[], actor: Actor) {
    if (!Array.isArray(list) || list.length > 500) throw new AutomationInputError('Daftar hari raya tidak valid')
    const religions = new Set(['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu', 'Lainnya'])
    const clean = list.map(h => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date ?? '') || Number.isNaN(Date.parse(h.date))) throw new AutomationInputError(`Tanggal tidak valid: ${h.date}`)
      if (!h.name?.trim() || !h.greeting?.trim()) throw new AutomationInputError(`Nama dan ucapan hari raya ${h.date} wajib diisi`)
      if (!Array.isArray(h.religions) || !h.religions.length || h.religions.some(r => !religions.has(r))) throw new AutomationInputError(`Agama untuk ${h.name} tidak valid`)
      return { id: h.id?.trim() || `${h.date}:${randomUUID().slice(0, 8)}`, date: h.date, name: h.name.trim(), religions: [...new Set(h.religions)], greeting: h.greeting.trim(), confirmed: !!h.confirmed, enabled: h.enabled !== false }
    })
    if (new Set(clean.map(h => h.id)).size !== clean.length) throw new AutomationInputError('ID hari raya ganda')
    await this.db.transaction(async tx => {
      await tx.delete(waHolidays)
      if (clean.length) await tx.insert(waHolidays).values(clean)
      await tx.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'automation.holidays', revision: 0, reason: 'Kalender hari raya diperbarui', details: { count: clean.length } })
    })
    this.wake()
  }

  // ---------- Data pegawai ----------
  private async workspace(): Promise<WorkspaceData> {
    const [meta] = await this.db.select({ revision: workspaces.revision }).from(workspaces).where(eq(workspaces.id, 'default'))
    if (!meta) return { revision: -1, employees: [], files: [], evidenceLink: new Map(), publicHolidays: [] }
    if (this.cache?.revision === meta.revision) return this.cache
    const [w] = await this.db.select().from(workspaces).where(eq(workspaces.id, 'default'))
    const roster = buildRoster(w.state.files, w.state.master, w.state.overrides, w.state.decisions)
    this.cache = { revision: w.revision, employees: roster.employees, files: w.state.files, evidenceLink: roster.evidenceLink, publicHolidays: w.state.policy?.holidays ?? [] }
    return this.cache
  }

  private async planInput(date: string): Promise<PlanInput> {
    const [data, rules, settings, holidays] = await Promise.all([this.workspace(), this.rules(), this.settings(), this.holidays()])
    return { date, employees: data.employees, rules: new Map(rules.map(r => [r.id, r])), settings, holidays, files: data.files, evidenceLink: data.evidenceLink, publicHolidays: data.publicHolidays }
  }

  // ---------- Antrean ----------
  /** Sisipkan draf baru (yang belum pernah diantrikan). Mode uji dan nomor kosong diputuskan di sini, saat item lahir. */
  async enqueue(drafts: Draft[], settings: AutomationSettings): Promise<number> {
    if (!drafts.length) return 0
    const keyOf = (d: Draft) => settings.testMode ? `uji:${d.dedupeKey}` : d.dedupeKey
    const existing = new Set<string>()
    for (let i = 0; i < drafts.length; i += 500) {
      const keys = drafts.slice(i, i + 500).map(keyOf)
      for (const r of await this.db.select({ k: waOutbox.dedupeKey }).from(waOutbox).where(inArray(waOutbox.dedupeKey, keys))) existing.add(r.k)
    }
    const fresh = drafts.filter(d => !existing.has(keyOf(d)))
    if (!fresh.length) return 0
    const today = wib(this.now()).date
    let testUsed = settings.testMode ? await this.countSince(and(eq(waOutbox.test, true), inArray(waOutbox.status, ['pending', 'sending', 'sent'])), today, 'created') : 0
    const rows = fresh.map((d, i) => {
      const base = {
        id: randomUUID(), dedupeKey: keyOf(d), ruleId: d.ruleId, campaignId: d.campaignId ?? null, employeeId: d.employeeId ?? null, recipientName: d.recipientName,
        phone: d.phone, deliverTo: d.phone, test: settings.testMode, message: d.message, scheduledFor: d.scheduledFor, expiresAt: d.expiresAt,
        status: 'pending' as OutboxStatus, lastError: null as string | null, createdAt: this.now(), updatedAt: this.now(),
      }
      if (d.unresolved?.length) return { ...base, status: 'skipped' as const, lastError: `Token belum terisi: ${d.unresolved.map(t => `{{${t}}}`).join(', ')}` }
      if (settings.testMode) {
        if (!settings.testNumbers.length) return { ...base, deliverTo: '', status: 'skipped' as const, lastError: 'Mode uji aktif tetapi nomor uji belum diisi' }
        if (testUsed >= settings.testDailyLimit) return { ...base, deliverTo: '', status: 'skipped' as const, lastError: `Batas harian mode uji (${settings.testDailyLimit}) tercapai` }
        testUsed++
        const target = settings.testNumbers[i % settings.testNumbers.length]
        return { ...base, deliverTo: target, message: `[UJI · untuk ${d.recipientName} · ${d.phone ? maskPhone(d.phone) : 'tanpa nomor'}]\n\n${d.message}` }
      }
      if (!d.phone) return { ...base, status: 'skipped' as const, lastError: 'Nomor WhatsApp pegawai kosong atau tidak valid' }
      return base
    })
    let inserted = 0
    for (let i = 0; i < rows.length; i += 200) inserted += (await this.db.insert(waOutbox).values(rows.slice(i, i + 200)).onConflictDoNothing().returning({ id: waOutbox.id })).length
    if (inserted) this.wake()
    return inserted
  }

  private async countSince(where: ReturnType<typeof and>, date: string, column: 'created' | 'sent'): Promise<number> {
    const col = column === 'created' ? waOutbox.createdAt : waOutbox.sentAt
    const [r] = await this.db.select({ n: count() }).from(waOutbox).where(and(where, gte(col, wibInstant(date, '00:00'))))
    return r.n
  }

  // ---------- Perencanaan per detak ----------
  async plan(): Promise<void> {
    const now = this.now()
    const { date, minutes } = wib(now)
    const input = await this.planInput(date)
    const settings = input.settings
    // Item yang lewat tenggat (mis. ucapan ulang tahun kemarin) tidak dikirim terlambat.
    await this.db.update(waOutbox).set({ status: 'expired', updatedAt: now, lastError: 'Lewat batas waktu kirim' }).where(and(eq(waOutbox.status, 'pending'), lte(waOutbox.expiresAt, now)))
    for (const rule of input.rules.values()) {
      if (!rule.enabled || rule.kind === 'campaign' || rule.id === 'rolechange') continue
      if (minutes < hhmmToMinutes(rule.sendTime)) continue
      const { drafts } = planRule(rule, input)
      const queued = await this.enqueue(drafts, settings)
      if (queued) this.log(`${rule.id}: ${queued} pesan diantrikan untuk ${date}`)
      this.state.lastPlanned[rule.id] = { at: now.toISOString(), queued: drafts.length }
    }
    await this.planRoleChanges(input, now)
    await this.planCampaigns(input, now)
  }

  /** Bandingkan sidik jabatan dengan snapshot; snapshot selalu diperbarui agar mengaktifkan aturan tidak membanjiri pesan lama. */
  private async planRoleChanges(input: PlanInput, now: Date) {
    const rule = input.rules.get('rolechange')!
    const snaps = new Map((await this.db.select().from(waEmployeeSnapshots)).map(s => [s.employeeId, s.fingerprint]))
    const firstRun = snaps.size === 0
    const changed: Employee[] = []
    const upserts: { employeeId: string; fingerprint: string }[] = []
    for (const e of input.employees) {
      const fp = roleFingerprint(e)
      const prev = snaps.get(e.id)
      if (prev === fp) continue
      upserts.push({ employeeId: e.id, fingerprint: fp })
      if (prev !== undefined) changed.push(e)
    }
    if (!upserts.length) return
    let queued = 0
    if (!firstRun && rule.enabled && changed.length) {
      if (changed.length > ROLE_CHANGE_BULK_LIMIT) {
        this.log(`rolechange: ${changed.length} pegawai berubah sekaligus (impor massal) — tidak dikirim otomatis`)
        this.state.lastError = `Perubahan jabatan massal (${changed.length} pegawai) tidak dikirim otomatis; kirim lewat kampanye bila perlu.`
        this.state.lastErrorAt = now.toISOString()
      } else {
        const at = new Date(Math.max(now.getTime(), wibInstant(input.date, rule.sendTime).getTime()))
        const drafts = changed.flatMap(e => planCampaign({ id: 'rolechange', ruleId: 'rolechange', template: rule.template, variables: {}, audience: { kind: 'pegawai', values: [e.id] } }, rule, input, input.date, at)
          .map(d => ({ ...d, campaignId: undefined, dedupeKey: `rolechange:${e.id}:${shortHash(roleFingerprint(e))}`, expiresAt: new Date(at.getTime() + 3 * 86400_000) })))
        queued = await this.enqueue(drafts, input.settings)
        this.state.lastPlanned.rolechange = { at: now.toISOString(), queued: drafts.length }
      }
    }
    for (let i = 0; i < upserts.length; i += 500) {
      await this.db.insert(waEmployeeSnapshots).values(upserts.slice(i, i + 500)).onConflictDoUpdate({ target: waEmployeeSnapshots.employeeId, set: { fingerprint: dsql`excluded.fingerprint`, updatedAt: now } })
    }
    if (queued) this.log(`rolechange: ${queued} pesan diantrikan`)
  }

  private async planCampaigns(input: PlanInput, now: Date) {
    const due = await this.db.select().from(waCampaigns).where(and(eq(waCampaigns.status, 'scheduled'), lte(waCampaigns.sendAt, now)))
    for (const c of due) {
      const rule = input.rules.get(c.ruleId)
      if (!rule?.enabled) continue
      const campaign = toCampaign(c)
      let date = input.date
      let at = campaignOccurrence(campaign, date)
      if (!c.repeatMonthly && !c.lastRunOn) { at = c.sendAt; date = wib(c.sendAt).date } // kampanye sekali: kejar walau server sempat mati
      if (!at || at > now || c.lastRunOn === date) continue
      const drafts = planCampaign(campaign, rule, input, date, at)
      const queued = await this.enqueue(drafts, input.settings)
      await this.db.update(waCampaigns).set({ lastRunOn: date, recipients: drafts.length, status: c.repeatMonthly ? 'scheduled' : 'done' }).where(eq(waCampaigns.id, c.id))
      this.state.lastPlanned[c.ruleId] = { at: now.toISOString(), queued: drafts.length }
      this.log(`kampanye "${c.title}": ${queued} pesan diantrikan`)
    }
  }

  // ---------- Pengiriman ----------
  /** Kirim satu item yang jatuh tempo. Mengembalikan alasan menunggu bila tidak ada yang dikirim. */
  async sendNext(): Promise<{ result: 'sent' | 'failed' | 'idle' | 'waiting'; waiting?: string }> {
    const now = this.now()
    const settings = await this.settings()
    const { date, minutes } = wib(now)
    const dueWhere = and(eq(waOutbox.status, 'pending'), lte(waOutbox.scheduledFor, now), gt(waOutbox.expiresAt, now), or(isNull(waOutbox.nextAttemptAt), lte(waOutbox.nextAttemptAt, now)))
    const [{ n: due }] = await this.db.select({ n: count() }).from(waOutbox).where(dueWhere)
    if (!due) return { result: 'idle' }
    if (settings.paused) return { result: 'waiting', waiting: `Automation dijeda admin · ${due} pesan menunggu` }
    if (minutes < hhmmToMinutes(settings.windowStart) || minutes >= hhmmToMinutes(settings.windowEnd)) return { result: 'waiting', waiting: `Di luar jam kirim ${settings.windowStart}–${settings.windowEnd} WIB · ${due} pesan menunggu` }
    const sentToday = await this.countSince(eq(waOutbox.status, 'sent'), date, 'sent')
    if (sentToday >= settings.dailyLimit) return { result: 'waiting', waiting: `Batas harian ${settings.dailyLimit} pesan tercapai · ${due} pesan dilanjutkan besok` }
    if (!settings.dryRun && !this.whatsapp?.isReady()) return { result: 'waiting', waiting: `WhatsApp belum terhubung · ${due} pesan menunggu` }

    const item = await this.db.transaction(async tx => {
      const [next] = await tx.select().from(waOutbox).where(dueWhere).orderBy(asc(waOutbox.scheduledFor), asc(waOutbox.createdAt)).limit(1).for('update', { skipLocked: true })
      if (!next) return undefined
      await tx.update(waOutbox).set({ status: 'sending', updatedAt: now }).where(eq(waOutbox.id, next.id))
      return next
    })
    if (!item) return { result: 'idle' }
    try {
      const sent = settings.dryRun ? { id: `simulasi-${item.id.slice(0, 8)}` } : await this.whatsapp!.sendText(item.deliverTo, item.message)
      await this.db.update(waOutbox).set({ status: 'sent', sentAt: this.now(), updatedAt: this.now(), attempts: item.attempts + 1, waMessageId: sent.id ?? null, lastError: settings.dryRun ? 'Simulasi: tidak benar-benar dikirim' : null }).where(eq(waOutbox.id, item.id))
      this.state.lastSentAt = this.now().toISOString()
      return { result: 'sent' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof WhatsAppNotReadyError) {
        await this.db.update(waOutbox).set({ status: 'pending', updatedAt: this.now() }).where(eq(waOutbox.id, item.id))
        return { result: 'waiting', waiting: 'WhatsApp terputus saat mengirim' }
      }
      if (error instanceof WhatsAppRecipientError) {
        await this.db.update(waOutbox).set({ status: 'skipped', attempts: item.attempts + 1, lastError: message, updatedAt: this.now() }).where(eq(waOutbox.id, item.id))
        return { result: 'failed' }
      }
      const attempts = item.attempts + 1
      const final = attempts >= settings.maxAttempts
      const nextAttemptAt = final ? null : new Date(this.now().getTime() + RETRY_BACKOFF_MIN[Math.min(attempts - 1, RETRY_BACKOFF_MIN.length - 1)] * 60_000)
      await this.db.update(waOutbox).set({ status: final ? 'failed' : 'pending', attempts, nextAttemptAt, lastError: message, updatedAt: this.now() }).where(eq(waOutbox.id, item.id))
      this.log(`gagal kirim ${item.id} (percobaan ${attempts}): ${message}`)
      return { result: 'failed' }
    }
  }

  // ---------- Siklus hidup ----------
  start() {
    if (this.running) return
    this.running = true
    this.state.startedAt = this.now().toISOString()
    this.state.role = 'standby'
    const loop = async () => {
      if (!this.running) return
      await this.tick()
      if (this.running) this.tickTimer = setTimeout(() => void loop(), this.opts.tickMs ?? 30_000)
    }
    void loop()
    this.senderDone = this.senderLoop()
  }

  async stop() {
    this.running = false
    if (this.tickTimer) clearTimeout(this.tickTimer)
    this.senderWake?.()
    await Promise.allSettled([this.ticking, this.senderDone])
    if (this.lockHeld && this.opts.lockSql) await this.opts.lockSql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined)
    this.lockHeld = false
    this.state.role = 'stopped'
  }

  /** Satu detak: ambil/periksa kunci pemimpin, pulihkan koneksi WA, rencanakan pesan. Tidak pernah melempar. */
  tick(): Promise<void> {
    if (this.ticking) return this.ticking
    this.ticking = (async () => {
      const started = Date.now()
      try {
        const wasLeader = this.state.role === 'leader'
        const leader = await this.ensureLeader()
        this.state.role = leader ? 'leader' : 'standby'
        if (!leader) return
        if (!wasLeader) await this.recoverInterrupted()
        await this.whatsapp?.ensureConnected().catch(() => undefined)
        await this.plan()
        if (this.state.lastErrorAt && Date.now() - Date.parse(this.state.lastErrorAt) > 10 * 60_000) this.state.lastError = undefined
      } catch (error) {
        this.state.lastError = error instanceof Error ? error.message : String(error)
        this.state.lastErrorAt = this.now().toISOString()
        this.log(`detak gagal: ${this.state.lastError}`)
      } finally {
        this.state.lastTickAt = this.now().toISOString()
        this.state.lastTickMs = Date.now() - started
        this.ticking = undefined
      }
    })()
    return this.ticking
  }

  private async ensureLeader(): Promise<boolean> {
    const lock = this.opts.lockSql
    if (!lock) return true
    try {
      const [held] = await lock<{ held: boolean }[]>`select exists(select 1 from pg_locks where locktype = 'advisory' and objid = ${LOCK_KEY} and pid = pg_backend_pid() and granted) as held`
      if (held.held) { this.lockHeld = true; return true }
      const [got] = await lock<{ ok: boolean }[]>`select pg_try_advisory_lock(${LOCK_KEY}) as ok`
      this.lockHeld = got.ok
      if (got.ok) this.log('instance ini menjadi pemimpin scheduler')
      return got.ok
    } catch (error) {
      this.lockHeld = false
      throw error
    }
  }

  /** Item "sending" milik proses yang mati: status kirim tidak pasti, jadi ditandai gagal agar tidak terkirim dua kali. */
  private async recoverInterrupted() {
    const stale = new Date(this.now().getTime() - 2 * 60_000)
    const rows = await this.db.update(waOutbox).set({ status: 'failed', lastError: 'Server berhenti saat mengirim; status tidak pasti. Kirim ulang bila penerima belum menerima.', updatedAt: this.now() })
      .where(and(eq(waOutbox.status, 'sending'), lt(waOutbox.updatedAt, stale))).returning({ id: waOutbox.id })
    if (rows.length) this.log(`${rows.length} item terputus saat mengirim ditandai gagal`)
  }

  private wake() { this.senderWake?.() }

  private async senderLoop() {
    while (this.running) {
      let waitMs = 5000
      try {
        if (this.state.role === 'leader') {
          const { result, waiting } = await this.sendNext()
          this.state.waiting = waiting
          if (result === 'sent' || result === 'failed') {
            const s = await this.settings()
            waitMs = (s.dryRun ? 300 : s.minIntervalSec * 1000) + Math.floor(this.random() * (s.dryRun ? 0 : s.jitterSec * 1000))
          } else if (result === 'waiting') waitMs = 15_000
        }
      } catch (error) {
        this.state.lastError = `Pengirim: ${error instanceof Error ? error.message : String(error)}`
        this.state.lastErrorAt = this.now().toISOString()
        waitMs = 15_000
      }
      if (!this.running) break
      await new Promise<void>(resolve => {
        const t = setTimeout(() => { this.senderWake = undefined; resolve() }, waitMs)
        this.senderWake = () => { clearTimeout(t); this.senderWake = undefined; resolve() }
      })
    }
  }

  // ---------- Untuk API ----------
  async counts(): Promise<AutomationCounts> {
    const today = wib(this.now()).date
    const [[pending], [failed], [sentTotal]] = await Promise.all([
      this.db.select({ n: count() }).from(waOutbox).where(inArray(waOutbox.status, ['pending', 'sending'])),
      this.db.select({ n: count() }).from(waOutbox).where(and(eq(waOutbox.status, 'failed'), gte(waOutbox.updatedAt, wibInstant(addDays(today, -7), '00:00')))),
      this.db.select({ n: count() }).from(waOutbox).where(eq(waOutbox.status, 'sent')),
    ])
    return {
      pending: pending.n, failed: failed.n, sentTotal: sentTotal.n,
      sentToday: await this.countSince(eq(waOutbox.status, 'sent'), today, 'sent'),
      skippedToday: await this.countSince(eq(waOutbox.status, 'skipped'), today, 'created'),
    }
  }

  async overview(): Promise<AutomationOverview> {
    const now = this.now()
    const today = wib(now).date
    const [input, counts, campaigns] = await Promise.all([this.planInput(today), this.counts(), this.db.select().from(waCampaigns).where(eq(waCampaigns.status, 'scheduled'))])
    const upcoming: AutomationOverview['upcoming'] = []
    for (let i = 0; i <= 30; i++) {
      const date = addDays(today, i)
      const dayInput = { ...input, date }
      for (const id of ['birthday', 'religion', 'anniversary', 'datarefresh'] as const) {
        const rule = input.rules.get(id)!
        if (id === 'datarefresh' && !rule.enabled) continue
        if (id === 'religion') {
          for (const h of input.holidays.filter(h => h.date === date && h.enabled)) {
            const n = input.employees.filter(e => e.agama && h.religions.includes(e.agama) && (e.statusPegawai !== 'Nonaktif')).length
            upcoming.push({ date, ruleId: id, label: `${h.name}${h.confirmed ? '' : ' (belum dikonfirmasi)'}${rule.enabled ? '' : ' · aturan nonaktif'}`, recipients: n })
          }
          continue
        }
        const drafts = planRule(rule, dayInput).drafts
        const n = drafts.length
        const names = id === 'datarefresh' ? '' : `: ${drafts.slice(0, 3).map(d => d.recipientName).join(', ')}${n > 3 ? ` +${n - 3} lainnya` : ''}`
        const label = id === 'birthday' ? 'Ulang tahun' : id === 'anniversary' ? 'Masa kerja' : rule.title
        if (n) upcoming.push({ date, ruleId: id, label: `${label}${names}${rule.enabled ? '' : ' · aturan nonaktif'}`, recipients: n })
      }
      for (const c of campaigns) if (campaignOccurrence(toCampaign(c), date)) upcoming.push({ date, ruleId: c.ruleId, label: `Kampanye: ${c.title}`, recipients: audienceOf(c.audience, input.employees, date).length })
    }
    const warnings: string[] = []
    const s = input.settings
    if (s.paused) warnings.push('Automation dijeda: tidak ada pesan yang dikirim sampai jeda dicabut.')
    if (s.dryRun) warnings.push('Mode simulasi aktif: pesan ditandai terkirim tanpa benar-benar dikirim ke WhatsApp.')
    if (s.testMode && !s.testNumbers.length) warnings.push('Mode uji aktif tetapi nomor uji belum diisi: pesan otomatis akan dilewati.')
    else if (s.testMode) warnings.push(`Mode uji aktif: semua pesan dialihkan ke ${s.testNumbers.length} nomor uji (maks. ${s.testDailyLimit}/hari).`)
    const status = this.whatsapp?.status()
    if (!s.dryRun && !status) warnings.push('Layanan WhatsApp tidak aktif di server ini.')
    else if (!s.dryRun && status && status.status !== 'connected') warnings.push(`WhatsApp ${status.status === 'not_configured' ? 'belum dikonfigurasi (WHATSAPP_SESSION_ENCRYPTION_KEY)' : 'belum terhubung'}: ${counts.pending} pesan akan menunggu.`)
    const soon = input.holidays.filter(h => h.enabled && !h.confirmed && h.date >= today && h.date <= addDays(today, 60))
    if (soon.length) warnings.push(`${soon.length} hari raya dalam 60 hari belum dikonfirmasi: ${soon.map(h => `${h.name} (${h.date})`).join(', ')}.`)
    const active = input.employees.filter(e => e.statusPegawai !== 'Nonaktif')
    const noPhone = active.filter(e => !normalizePhone(e.nomorWhatsApp)).length
    if (noPhone) warnings.push(`${noPhone} dari ${active.length} pegawai aktif belum punya nomor WhatsApp yang valid.`)
    const noReligion = active.filter(e => !e.agama).length
    if (noReligion) warnings.push(`${noReligion} pegawai belum punya data agama sehingga tidak menerima ucapan hari raya.`)
    if (this.state.role === 'leader' && this.state.lastTickAt && now.getTime() - Date.parse(this.state.lastTickAt) > 3 * 60_000) warnings.push('Scheduler tidak berdetak lebih dari 3 menit.')
    if (this.state.lastError) warnings.push(`Kesalahan terakhir: ${this.state.lastError}`)
    return {
      now: now.toISOString(), today, settings: s, rules: [...input.rules.values()], holidays: input.holidays, scheduler: { ...this.state, lastPlanned: { ...this.state.lastPlanned } },
      counts, whatsappReady: !!this.whatsapp?.isReady(), upcoming, warnings,
    }
  }

  async outbox(filter: { status?: string; ruleId?: string; limit?: number }): Promise<OutboxItem[]> {
    const where = and(filter.status ? eq(waOutbox.status, filter.status as OutboxStatus) : undefined, filter.ruleId ? eq(waOutbox.ruleId, filter.ruleId as AutomationRuleId) : undefined)
    const rows = await this.db.select().from(waOutbox).where(where).orderBy(desc(waOutbox.createdAt)).limit(Math.min(Math.max(filter.limit ?? 100, 1), 500))
    return rows.map(toItem)
  }

  async retry(id: string, actor: Actor): Promise<OutboxItem> {
    const now = this.now()
    const [row] = await this.db.update(waOutbox).set({ status: 'pending', attempts: 0, nextAttemptAt: null, lastError: null, scheduledFor: now, expiresAt: new Date(now.getTime() + 86400_000), updatedAt: now })
      .where(and(eq(waOutbox.id, id), inArray(waOutbox.status, ['failed', 'expired', 'cancelled', 'skipped']))).returning()
    if (!row) throw new AutomationInputError('Hanya pesan gagal, kedaluwarsa, dilewati, atau dibatalkan yang dapat dikirim ulang')
    if (!row.deliverTo) {
      await this.db.update(waOutbox).set({ status: 'skipped', lastError: 'Tidak ada nomor tujuan' }).where(eq(waOutbox.id, id))
      throw new AutomationInputError('Pesan ini tidak punya nomor tujuan')
    }
    await this.db.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'automation.retry', revision: 0, reason: 'Pesan WhatsApp dikirim ulang', details: { outboxId: id } })
    this.wake()
    return toItem(row)
  }

  async cancel(id: string, actor: Actor): Promise<OutboxItem> {
    const [row] = await this.db.update(waOutbox).set({ status: 'cancelled', updatedAt: this.now(), lastError: 'Dibatalkan admin' }).where(and(eq(waOutbox.id, id), eq(waOutbox.status, 'pending'))).returning()
    if (!row) throw new AutomationInputError('Hanya pesan yang masih menunggu yang dapat dibatalkan')
    await this.db.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'automation.cancel', revision: 0, reason: 'Pesan WhatsApp dibatalkan', details: { outboxId: id } })
    return toItem(row)
  }

  private toPreview(ruleId: AutomationRuleId, date: string, drafts: Draft[], note?: string): RulePreview {
    return {
      ruleId, date, note,
      recipients: drafts.filter(d => d.phone).map(d => ({ employeeId: d.employeeId ?? '', name: d.recipientName, phone: maskPhone(d.phone), message: d.message, note: d.unresolved?.length ? `Token belum terisi: ${d.unresolved.join(', ')}` : undefined })),
      missingPhone: drafts.filter(d => !d.phone).map(d => ({ employeeId: d.employeeId ?? '', name: d.recipientName })),
    }
  }

  async preview(ruleId: string, date: string): Promise<RulePreview> {
    const def = ruleDef.get(ruleId as AutomationRuleId)
    if (!def) throw new AutomationInputError('Aturan tidak dikenal')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AutomationInputError('Tanggal harus YYYY-MM-DD')
    const input = await this.planInput(date)
    const rule = input.rules.get(def.id)!
    if (def.kind === 'campaign') return { ruleId: def.id, date, recipients: [], missingPhone: [], note: 'Aturan kampanye: gunakan pratinjau kampanye untuk melihat penerima.' }
    if (def.id === 'rolechange') {
      const snaps = new Map((await this.db.select().from(waEmployeeSnapshots)).map(s => [s.employeeId, s.fingerprint]))
      const changed = input.employees.filter(e => snaps.has(e.id) && snaps.get(e.id) !== roleFingerprint(e))
      const at = wibInstant(date, rule.sendTime)
      const drafts = changed.flatMap(e => planCampaign({ id: 'rolechange', ruleId: 'rolechange', template: rule.template, variables: {}, audience: { kind: 'pegawai', values: [e.id] } }, rule, input, date, at))
      return this.toPreview(def.id, date, drafts, drafts.length ? undefined : snaps.size ? 'Belum ada perubahan jabatan/golongan/unit/kantor sejak pemeriksaan terakhir.' : 'Snapshot data jabatan dibuat pada detak scheduler pertama.')
    }
    const { drafts, note } = planRule(rule, input)
    return this.toPreview(def.id, date, drafts, note)
  }

  private campaignInput(body: { ruleId?: string; title?: string; template?: string; variables?: Record<string, string>; audience?: CampaignAudience }) {
    const def = ruleDef.get(body.ruleId as AutomationRuleId)
    if (!def || def.kind !== 'campaign') throw new AutomationInputError('Pilih aturan kampanye yang valid')
    const template = body.template ?? def.defaultTemplate
    validateTemplate(template, def.tokens)
    const variables = Object.fromEntries(Object.entries(body.variables ?? {}).filter(([k, v]) => def.tokens.includes(k) && typeof v === 'string').map(([k, v]) => [k, v.trim().slice(0, 500)]))
    const a = body.audience
    if (!a || !['all', 'kantor', 'unit', 'agama', 'pegawai'].includes(a.kind)) throw new AutomationInputError('Audiens tidak valid')
    if (a.kind !== 'all' && (!Array.isArray(a.values) || !a.values.length)) throw new AutomationInputError('Pilih minimal satu nilai audiens')
    const audience: CampaignAudience = a.kind === 'all' ? { kind: 'all' } : { kind: a.kind, values: a.values.map(String).slice(0, 1000) }
    return { def, template, variables, audience }
  }

  async previewCampaign(body: Parameters<AutomationService['campaignInput']>[0]): Promise<RulePreview> {
    const { def, template, variables, audience } = this.campaignInput(body)
    const date = wib(this.now()).date
    const input = await this.planInput(date)
    const drafts = planCampaign({ id: 'pratinjau', ruleId: def.id, template, variables, audience }, input.rules.get(def.id)!, input, date, this.now())
    return this.toPreview(def.id, date, drafts, drafts.length ? undefined : 'Tidak ada pegawai aktif pada audiens ini.')
  }

  async createCampaign(body: Parameters<AutomationService['campaignInput']>[0] & { sendAt?: string; repeatMonthly?: boolean }, actor: Actor): Promise<Campaign> {
    const { def, template, variables, audience } = this.campaignInput(body)
    const title = body.title?.trim()
    if (!title || title.length > 120) throw new AutomationInputError('Judul kampanye 1–120 karakter')
    const sendAt = new Date(body.sendAt ?? '')
    if (Number.isNaN(sendAt.getTime())) throw new AutomationInputError('Waktu kirim tidak valid')
    if (sendAt.getTime() < this.now().getTime() - 5 * 60_000) throw new AutomationInputError('Waktu kirim sudah lewat')
    const missing = def.tokens.filter(t => !['sapaan', 'nama', 'nama_depan', 'pengirim', 'tautan_portal'].includes(t) && template.includes(`{{${t}}}`) && !variables[t])
    if (missing.length) throw new AutomationInputError(`Isi nilai untuk ${missing.map(t => `{{${t}}}`).join(', ')}`)
    const [row] = await this.db.insert(waCampaigns).values({ id: randomUUID(), ruleId: def.id, title, template, variables, audience, sendAt, repeatMonthly: !!body.repeatMonthly, status: 'scheduled', createdBy: actor.id }).returning()
    await this.db.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'automation.campaign', revision: 0, reason: `Kampanye "${title}" dijadwalkan`, details: { campaignId: row.id, ruleId: def.id, audience, sendAt: sendAt.toISOString(), repeatMonthly: !!body.repeatMonthly } })
    this.wake()
    void this.tick()
    return toCampaign(row)
  }

  async campaigns(): Promise<Campaign[]> {
    return (await this.db.select().from(waCampaigns).orderBy(desc(waCampaigns.createdAt)).limit(200)).map(toCampaign)
  }

  async cancelCampaign(id: string, actor: Actor): Promise<Campaign> {
    const [row] = await this.db.update(waCampaigns).set({ status: 'cancelled' }).where(and(eq(waCampaigns.id, id), eq(waCampaigns.status, 'scheduled'))).returning()
    if (!row) throw new AutomationInputError('Kampanye tidak ditemukan atau sudah selesai')
    await this.db.update(waOutbox).set({ status: 'cancelled', lastError: 'Kampanye dibatalkan', updatedAt: this.now() }).where(and(eq(waOutbox.campaignId, id), eq(waOutbox.status, 'pending')))
    await this.db.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'automation.campaign-cancel', revision: 0, reason: `Kampanye "${row.title}" dibatalkan`, details: { campaignId: id } })
    return toCampaign(row)
  }

  /** Kirim contoh pesan aturan ke nomor uji sekarang juga (tidak bergantung mode uji). */
  async sendTest(ruleId: string, employeeId: string | undefined, actor: Actor): Promise<OutboxItem> {
    const def = ruleDef.get(ruleId as AutomationRuleId)
    if (!def) throw new AutomationInputError('Aturan tidak dikenal')
    const settings = await this.settings()
    if (!settings.testNumbers.length) throw new AutomationInputError('Isi nomor uji di pengaturan terlebih dahulu')
    const now = this.now()
    const input = await this.planInput(wib(now).date)
    const e = (employeeId ? input.employees.find(x => x.id === employeeId) : undefined) ?? input.employees.find(x => x.nama && x.statusPegawai !== 'Nonaktif')
    if (!e) throw new AutomationInputError('Belum ada data pegawai untuk contoh')
    const rule = input.rules.get(def.id)!
    const sample: Record<string, string> = { usia: '30', masa_kerja: '5', hari_raya: 'Hari Raya (contoh)', ucapan: 'Selamat hari raya', tanggal: 'Senin, 6 April 2026' }
    for (const t of def.tokens) sample[t] ??= `[${t.replace(/_/g, ' ')}]`
    const [d] = planCampaign({ id: 'tes', ruleId: def.id, template: rule.template, variables: sample, audience: { kind: 'pegawai', values: [e.id] } }, rule, { ...input, employees: [{ ...e, statusPegawai: 'Aktif' }] }, input.date, now)
    const [row] = await this.db.insert(waOutbox).values({
      id: randomUUID(), dedupeKey: `tes:${randomUUID()}`, ruleId: def.id, employeeId: e.id, recipientName: displayName(e.nama), phone: d.phone, deliverTo: settings.testNumbers[0], test: true,
      message: `[TES · contoh untuk ${displayName(e.nama)}]\n\n${d.message}`, scheduledFor: now, expiresAt: new Date(now.getTime() + 3600_000), status: 'pending', createdAt: now, updatedAt: now,
    }).returning()
    await this.db.insert(auditEvents).values({ id: randomUUID(), actorId: actor.id, action: 'automation.test', revision: 0, reason: `Tes pesan "${def.title}"`, details: { outboxId: row.id } })
    this.wake()
    return toItem(row)
  }
}
