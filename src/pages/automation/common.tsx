import type { ReactNode } from 'react'
import { Cake, CalendarDays, BookOpenCheck, Database, ShieldCheck, HeartHandshake, FileSpreadsheet, BriefcaseBusiness, Clock3, Activity, Megaphone, Wallet, UserCog } from 'lucide-react'
import type { AutomationRuleId, AutomationScope, OutboxStatus, RulePreview } from '../../../shared/automation.ts'

export type Notify = (message: string) => void

export const scopeLabels: Record<AutomationScope, string> = { public: 'Publik', segmented: 'Tersegmentasi', personal: 'Personal' }

export const statusMeta: Record<OutboxStatus, { label: string; tone: string }> = {
  pending: { label: 'Menunggu', tone: 'tone-warn' },
  sending: { label: 'Mengirim', tone: 'tone-info' },
  sent: { label: 'Terkirim', tone: 'tone-ok' },
  failed: { label: 'Gagal', tone: 'tone-danger' },
  skipped: { label: 'Dilewati', tone: 'tone-idle' },
  expired: { label: 'Kedaluwarsa', tone: 'tone-duty' },
  cancelled: { label: 'Dibatalkan', tone: 'tone-leave' },
}

const icons: Record<AutomationRuleId, ReactNode> = {
  birthday: <Cake />, religion: <CalendarDays />, anniversary: <BriefcaseBusiness />, rejected: <Clock3 />, forgotout: <Clock3 />,
  datarefresh: <Database />, rolechange: <UserCog />, training: <BookOpenCheck />, workday: <Megaphone />, safety: <ShieldCheck />,
  performance: <FileSpreadsheet />, childbirth: <HeartHandshake />, condolence: <HeartHandshake />, payslip: <Wallet />, medicalclaim: <ShieldCheck />,
}
export const ruleIcon = (id: AutomationRuleId) => icons[id] ?? <Activity />

/** Warna agenda: ulang tahun merah muda, hari raya hijau-teal, masa kerja indigo. */
export const ruleHue = (id: AutomationRuleId) => id === 'birthday' ? 'pink' : id === 'religion' ? 'teal' : id === 'anniversary' ? 'indigo' : 'slate'

export const maskPhone = (p: string) => p.length > 8 ? `${p.slice(0, 5)}•••${p.slice(-4)}` : p || '—'

const dayFmt = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' })
export const fmtDay = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00+07:00`))
const dtFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false })
export const fmtDateTime = (iso?: string) => iso ? `${dtFmt.format(new Date(iso))} WIB` : '—'
const timeFmt = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false })
export const fmtClock = (iso: string) => timeFmt.format(new Date(iso)).replace('.', ':')

export function ago(iso: string | undefined, nowMs: number): string {
  if (!iso) return 'belum pernah'
  const s = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s} detik lalu`
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`
  return `${Math.floor(s / 86400)} hari lalu`
}

export const todayWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())

export function Section({ id, title, subtitle, icon, aside, children }: { id?: string; title: string; subtitle?: string; icon?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return <section className="card ac-section" id={id}>
    <div className="card-head"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div><div className="ac-head-aside">{aside}{icon}</div></div>
    {children}
  </section>
}

export function ErrorLine({ message }: { message: string }) {
  return message ? <p className="ac-error" role="alert">{message}</p> : null
}

export function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} aria-pressed={on} aria-label={label} title={label} disabled={disabled} onClick={onClick}><span /></button>
}

export function Bubbles({ preview }: { preview: RulePreview }) {
  const shown = preview.recipients.slice(0, 4)
  return <div className="ac-preview">
    {preview.note && <p className="ac-note">{preview.note}</p>}
    <p className="ac-count"><strong>{preview.recipients.length}</strong> pesan akan dikirim{preview.recipients.length > shown.length ? ` · menampilkan ${shown.length} pertama` : ''}</p>
    {shown.map(r => <div className="ac-bubble-wrap" key={r.employeeId}>
      <div className="ac-bubble-to">Kepada {r.name} · {maskPhone(r.phone)}{r.note ? ` · ${r.note}` : ''}</div>
      <div className="ac-bubble">{r.message}</div>
    </div>)}
    {preview.missingPhone.length > 0 && <details className="ac-missing"><summary>{preview.missingPhone.length} pegawai tanpa nomor WA</summary>
      <ul>{preview.missingPhone.map(m => <li key={m.employeeId}>{m.name}</li>)}</ul></details>}
  </div>
}
