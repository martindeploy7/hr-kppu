import { createHash } from 'node:crypto'
import { addDays, formatID, isWeekend, weekStartForDate } from '../src/engine/dates.ts'
import type { Employee, SourceFile } from '../src/engine/types.ts'
import type { AutomationRule, AutomationRuleId, AutomationSettings, Campaign, CampaignAudience, ReligiousHoliday } from '../shared/automation.ts'
import { normalizePhone } from '../shared/automation.ts'

/**
 * Planner automation: fungsi murni (tanpa DB/WhatsApp) yang menentukan siapa menerima pesan apa pada tanggal WIB
 * tertentu. Hasilnya draf dengan kunci dedupe; penyimpanan menyisipkannya ke outbox dengan ON CONFLICT DO NOTHING,
 * sehingga planner aman dijalankan berulang kali setiap menit.
 */
export type Draft = {
  dedupeKey: string
  ruleId: AutomationRuleId
  campaignId?: string
  employeeId?: string
  recipientName: string
  /** Nomor ternormalisasi 62…; kosong bila tidak ada/tidak valid. */
  phone: string
  message: string
  scheduledFor: Date
  expiresAt: Date
  /** Template masih memuat token yang tidak terisi. */
  unresolved?: string[]
}

export type PlanInput = {
  date: string
  employees: Employee[]
  rules: Map<AutomationRuleId, AutomationRule>
  settings: AutomationSettings
  holidays: ReligiousHoliday[]
  files: SourceFile[]
  evidenceLink: Map<string, string>
  /** Libur nasional dari kebijakan UM, untuk hari kerja pertama. */
  publicHolidays: string[]
}

const WIB_OFFSET_MIN = 7 * 60
const pad = (n: number) => String(n).padStart(2, '0')

/** Tanggal dan menit-sejak-tengah-malam di WIB (UTC+7, tanpa DST). */
export function wib(now: Date): { date: string; minutes: number; hhmm: string } {
  const t = new Date(now.getTime() + WIB_OFFSET_MIN * 60_000)
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes()
  return { date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`, minutes, hhmm: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` }
}
/** Instan UTC untuk tanggal + jam WIB. */
export function wibInstant(date: string, hhmm: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, h, min) - WIB_OFFSET_MIN * 60_000)
}
export const hhmmToMinutes = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + m }

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
/** Tanggal peringatan tahunan (ulang tahun/masa kerja) di tahun `year`; 29 Feb → 28 Feb di tahun bukan kabisat. */
export function anniversaryOn(source: string, year: number): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source ?? '')
  if (!m) return undefined
  let md = `${m[2]}-${m[3]}`
  if (md === '02-29' && !isLeap(year)) md = '02-28'
  return `${year}-${md}`
}
const yearOf = (iso: string) => Number(iso.slice(0, 4))

export function isActive(e: Employee, date: string): boolean {
  if (!e.nama?.trim() || e.statusPegawai === 'Nonaktif') return false
  if (e.tanggalPensiun && e.tanggalPensiun <= date) return false
  if (e.tanggalPengunduranDiri && e.tanggalPengunduranDiri <= date) return false
  return true
}

export const sapaan = (e: Employee) => e.jenisKelamin === 'Laki-laki' ? 'Bapak' : e.jenisKelamin === 'Perempuan' ? 'Ibu' : 'Bapak/Ibu'
/** Nama dari sumber absensi sering huruf kapital semua; ubah ke huruf judul agar sapaan terasa personal. */
export function displayName(nama: string): string {
  const trimmed = nama.trim().replace(/\s+/g, ' ')
  if (trimmed !== trimmed.toUpperCase() || !/[A-Z]/.test(trimmed)) return trimmed
  return trimmed.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

export function render(template: string, tokens: Record<string, string | undefined>): { text: string; unresolved: string[] } {
  const unresolved: string[] = []
  const text = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) => {
    const value = tokens[key]
    if (value === undefined || value === '') { unresolved.push(key); return whole }
    return value
  })
  return { text: text.trim(), unresolved: [...new Set(unresolved)] }
}

export function employeeTokens(e: Employee, settings: AutomationSettings): Record<string, string> {
  const name = displayName(e.nama)
  return { nama: name, nama_depan: name.split(' ')[0] ?? name, sapaan: sapaan(e), pengirim: settings.signature, tautan_portal: settings.portalUrl }
}

/** Daftar tanggal yang enak dibaca: "Senin, 6 April 2026 dan Selasa, 7 April 2026". */
export function dateList(dates: string[]): string {
  const labels = [...new Set(dates)].sort().map(d => formatID(d, { day: true }))
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} dan ${labels.at(-1)}`
}

export function firstWorkday(month: string, publicHolidays: string[]): string {
  let d = `${month}-01`
  while (isWeekend(d) || publicHolidays.includes(d)) d = addDays(d, 1)
  return d
}

export const roleFingerprint = (e: Employee) => JSON.stringify([e.jabatan ?? '', e.golongan ?? '', e.unit ?? '', e.kantor ?? ''])
export const shortHash = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 12)

const endOfDay = (date: string) => wibInstant(date, '23:59')

function draft(rule: AutomationRule, e: Employee, input: PlanInput, key: string, extra: Record<string, string>, scheduledFor: Date, expiresAt: Date, template = rule.template): Draft {
  const { text, unresolved } = render(template, { ...employeeTokens(e, input.settings), ...extra })
  return {
    dedupeKey: key, ruleId: rule.id, employeeId: e.id, recipientName: displayName(e.nama), phone: normalizePhone(e.nomorWhatsApp) ?? '',
    message: text, scheduledFor, expiresAt, ...(unresolved.length ? { unresolved } : {}),
  }
}

type DayFlags = { employeeId: string; date: string; in: boolean; out: boolean; rejected: boolean }
/** Gabungan bukti absensi per pegawai-hari, untuk aturan Reject dan scan pulang. Bukti yang dikecualikan admin diabaikan. */
export function attendanceFlags(files: SourceFile[], evidenceLink: Map<string, string>, from: string, to: string): Map<string, DayFlags> {
  const out = new Map<string, DayFlags>()
  for (const f of files) {
    if (f.kind === 'surat-tugas' || f.kind === 'jadwal-kanwil') continue
    if (f.period && (f.period.end < from || f.period.start > to)) continue
    const excluded = new Set((f.recordReviews ?? []).filter(r => r.kind === 'evidence' && r.disposition === 'excluded').map(r => r.recordId))
    for (const ev of f.evidence) {
      if (ev.date < from || ev.date > to || excluded.has(ev.id)) continue
      const employeeId = evidenceLink.get(ev.id)
      if (!employeeId) continue
      const key = `${employeeId}|${ev.date}`
      const day = out.get(key) ?? { employeeId, date: ev.date, in: false, out: false, rejected: false }
      if (ev.clockIn) day.in = true
      if (ev.clockOut || ev.code || ev.present) day.out = true // kode/hadir tanpa jam bukan "lupa scan pulang"
      if (f.kind === 'daring' && ev.approvalStatus === 'rejected') day.rejected = true
      out.set(key, day)
    }
  }
  return out
}

/** Draf untuk satu aturan pada `input.date`. Aturan kampanye dan perubahan jabatan ditangani terpisah. */
export function planRule(rule: AutomationRule, input: PlanInput): { drafts: Draft[]; note?: string } {
  const { date, settings } = input
  const year = yearOf(date)
  const at = wibInstant(date, rule.sendTime)
  const active = input.employees.filter(e => isActive(e, date))
  switch (rule.id) {
    case 'birthday': return {
      drafts: active.filter(e => anniversaryOn(e.tanggalLahir, year) === date).map(e =>
        draft(rule, e, input, `birthday:${year}:${e.id}`, { usia: String(year - yearOf(e.tanggalLahir)) }, at, endOfDay(date))),
    }
    case 'anniversary': {
      const milestones = rule.options.milestones ?? []
      return {
        drafts: active.flatMap(e => {
          if (anniversaryOn(e.tanggalMulaiKerja, year) !== date) return []
          const years = year - yearOf(e.tanggalMulaiKerja)
          if (years < 1 || (milestones.length && !milestones.includes(years))) return []
          return [draft(rule, e, input, `anniversary:${year}:${e.id}`, { masa_kerja: String(years) }, at, endOfDay(date))]
        }),
      }
    }
    case 'religion': {
      const today = input.holidays.filter(h => h.date === date && h.enabled)
      const pending = today.filter(h => !h.confirmed)
      const drafts = today.filter(h => h.confirmed).flatMap(h => active.filter(e => e.agama && h.religions.includes(e.agama)).map(e =>
        draft(rule, e, input, `religion:${h.id}:${e.id}`, { hari_raya: h.name, ucapan: h.greeting }, at, endOfDay(date))))
      return { drafts, note: pending.length ? `${pending.map(h => h.name).join(', ')} belum dikonfirmasi; ucapan tidak dikirim.` : today.length ? undefined : 'Tidak ada hari raya pada tanggal ini.' }
    }
    case 'datarefresh': {
      const month = date.slice(0, 7)
      const months = rule.options.months ?? []
      if (!months.includes(Number(date.slice(5, 7))) || firstWorkday(month, input.publicHolidays) !== date) return { drafts: [], note: `Dikirim pada hari kerja pertama bulan ${months.join(', ') || '—'}.` }
      return { drafts: active.map(e => draft(rule, e, input, `datarefresh:${month}:${e.id}`, {}, at, wibInstant(addDays(date, 5), '20:00'))) }
    }
    case 'rejected':
    case 'forgotout': {
      const lookback = Math.max(1, rule.options.lookbackDays ?? 14)
      const flags = attendanceFlags(input.files, input.evidenceLink, addDays(date, -lookback), date)
      const byEmployeeWeek = new Map<string, string[]>()
      for (const d of flags.values()) {
        const hit = rule.id === 'rejected' ? d.rejected : d.in && !d.out
        if (!hit) continue
        const key = `${d.employeeId}|${weekStartForDate(d.date)}`
        byEmployeeWeek.set(key, [...(byEmployeeWeek.get(key) ?? []), d.date])
      }
      const byId = new Map(active.map(e => [e.id, e]))
      const drafts = [...byEmployeeWeek].flatMap(([key, dates]) => {
        const [employeeId, week] = key.split('|')
        const e = byId.get(employeeId)
        return e ? [draft(rule, e, input, `${rule.id}:${week}:${e.id}`, { tanggal: dateList(dates) }, at, wibInstant(addDays(date, 3), '20:00'))] : []
      })
      return { drafts, note: drafts.length ? undefined : `Tidak ada data ${rule.id === 'rejected' ? 'presensi Reject' : 'scan masuk tanpa scan pulang'} dalam ${lookback} hari terakhir.` }
    }
    default: return { drafts: [], note: 'Aturan ini dijalankan lewat kampanye HR atau perubahan data.' }
  }
}

export function audienceOf(audience: CampaignAudience, employees: Employee[], date: string): Employee[] {
  const active = employees.filter(e => isActive(e, date))
  if (audience.kind === 'all') return active
  const values = new Set(audience.values)
  if (audience.kind === 'pegawai') return active.filter(e => values.has(e.id))
  const field = audience.kind as 'kantor' | 'unit' | 'agama'
  return active.filter(e => values.has(String(e[field] ?? '')))
}

export function lastDayOfMonth(month: string) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
/** Kejadian kampanye pada tanggal WIB: sekali (tanggal sendAt) atau bulanan (tanggal sama tiap bulan, mentok di akhir bulan). */
export function campaignOccurrence(c: Pick<Campaign, 'sendAt' | 'repeatMonthly'>, date: string): Date | undefined {
  const start = wib(new Date(c.sendAt))
  if (date < start.date) return undefined
  if (!c.repeatMonthly) return start.date === date ? new Date(c.sendAt) : undefined
  const day = Math.min(Number(start.date.slice(8, 10)), lastDayOfMonth(date.slice(0, 7)))
  return Number(date.slice(8, 10)) === day ? wibInstant(date, start.hhmm) : undefined
}

export function planCampaign(c: Pick<Campaign, 'id' | 'ruleId' | 'template' | 'variables' | 'audience'>, rule: AutomationRule, input: Pick<PlanInput, 'employees' | 'settings'>, date: string, at: Date): Draft[] {
  return audienceOf(c.audience, input.employees, date).map(e =>
    ({ ...draft(rule, e, { ...input } as PlanInput, `campaign:${c.id}:${date}:${e.id}`, c.variables, at, new Date(at.getTime() + 2 * 86400_000), c.template), campaignId: c.id }))
}
