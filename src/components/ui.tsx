import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Info, OctagonAlert, X, type LucideIcon } from 'lucide-react'
import type { DayStatus, Severity, SourceKind } from '../engine/types.ts'
import { STATUS_LABEL } from '../engine/reconcile.ts'

export const STATUS_SHORT: Record<DayStatus, string> = {
  hadir: 'H', 'hadir-wfa': 'W', 'dinas-lokal': 'DL', 'dinas-luar': 'PD', diklat: 'DK', cuti: 'C', sakit: 'S', izin: 'I',
  'tanpa-keterangan': 'TK', 'tidak-lengkap': '½', libur: '', 'belum-berlangsung': '·', 'tidak-ada-data': '·',
}

export const SOURCE_SHORT: Record<SourceKind, string> = {
  mesin: 'Mesin', daring: 'HP', 'matriks-kanwil': 'Mesin Kanwil', 'jadwal-kanwil': 'Rekap manual', 'laporan-kanwil': 'Laporan kode', 'surat-tugas': 'Surat tugas',
}

export function PageHeader({ kicker, title, children, actions }: { kicker?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return <header className="page-head">
    <div>
      {kicker && <span className="page-kicker">{kicker}</span>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>
}

export function Kpi({ label, value, note, tone, icon: Icon }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'navy' | 'red' | 'gold' | 'green' | 'muted'; icon?: LucideIcon }) {
  return <div className={`kpi ${tone ?? ''}`}>
    <div className="kpi-top"><span>{label}</span>{Icon && <Icon size={16} />}</div>
    <strong>{value}</strong>
    {note && <small>{note}</small>}
  </div>
}

export function StatusChip({ status, compact }: { status: DayStatus; compact?: boolean }) {
  return <span className={`status-chip st-${status}`}>{compact ? STATUS_SHORT[status] || '—' : STATUS_LABEL[status]}</span>
}

const SEV_ICON: Record<Severity, LucideIcon> = { tinggi: OctagonAlert, sedang: AlertTriangle, rendah: Info }
export function SeverityPill({ severity }: { severity: Severity }) {
  const Icon = SEV_ICON[severity]
  return <span className={`sev sev-${severity}`}><Icon size={12} /> {severity[0].toUpperCase() + severity.slice(1)}</span>
}

export function SourceChip({ kind }: { kind: SourceKind }) {
  return <span className={`src-chip src-${kind}`}>{SOURCE_SHORT[kind]}</span>
}

export function Drawer({ onClose, children, wide, label }: { onClose: () => void; children: ReactNode; wide?: boolean; label: string }) {
  return <>
    <motion.div className="drawer-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
    <motion.aside role="dialog" aria-label={label} className={`side-drawer ${wide ? 'wide' : ''}`} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }}>
      <button className="drawer-x" aria-label="Tutup" onClick={onClose}><X size={18} /></button>
      {children}
    </motion.aside>
  </>
}

export function Empty({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-block">
    <div className="empty-icon"><Icon size={22} /></div>
    <strong>{title}</strong>
    {children && <p>{children}</p>}
    {action}
  </div>
}

export function Panel({ title, sub, aside, children, className }: { title?: string; sub?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className ?? ''}`}>
    {(title || aside) && <div className="panel-head"><div>{title && <h3>{title}</h3>}{sub && <p>{sub}</p>}</div>{aside}</div>}
    {children}
  </section>
}

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const Icon = tone === 'warn' ? AlertTriangle : Info
  return <div className={`note note-${tone}`}><Icon size={15} /><div>{children}</div></div>
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return <div className="seg" role="group" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>
}
