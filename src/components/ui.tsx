import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { AlertTriangle, Info, OctagonAlert, X, type LucideIcon } from 'lucide-react'
import type { DayStatus, Severity, SourceKind } from '../engine/types.ts'
import { STATUS_LABEL } from '../engine/reconcile.ts'

export const STATUS_SHORT: Record<DayStatus, string> = {
  hadir: 'H', 'hadir-wfa': 'W', 'dinas-lokal': 'DL', 'dinas-luar': 'PD', diklat: 'DK', cuti: 'C', sakit: 'S', izin: 'I',
  'tanpa-keterangan': 'TK', 'tidak-lengkap': '½', libur: '', 'belum-berlangsung': '·', 'tidak-ada-data': '·',
}

export const SOURCE_SHORT: Record<SourceKind, string> = {
  mesin: 'Mesin Offline', daring: 'Mesin Online', 'matriks-kanwil': 'Mesin Kanwil', 'jadwal-kanwil': 'Rekap manual', 'laporan-kanwil': 'Laporan kode', 'surat-tugas': 'ST',
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

// Nilai sama dengan --ease-drawer, --dur-drawer, --dur-drawer-exit, --dur-base di theme.css (framer-motion butuh nilai JS, bukan var CSS).
const EASE_DRAWER = [0.32, 0.72, 0, 1] as const
const EASE_OUT = [0.23, 1, 0.32, 1] as const
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])'

export function Drawer({ onClose, children, wide, label }: { onClose: () => void; children: ReactNode; wide?: boolean; label: string }) {
  const panel = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Captured during the first render, before any child effect can move focus into the drawer.
  const [opener] = useState(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null)
  const returnTo = useRef<HTMLElement | null>(opener)
  const isPresent = useIsPresent()
  const reduce = useReducedMotion()

  // Fokus masuk ke drawer saat dibuka; Escape menutup; Tab berputar di dalam drawer.
  useEffect(() => {
    const el = panel.current
    ;(el?.querySelector<HTMLElement>('.drawer-x') ?? el)?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !el) return
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return }
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(n => n.getClientRects().length > 0)
      if (!items.length) { e.preventDefault(); el.focus(); return }
      const first = items[0], last = items[items.length - 1], active = document.activeElement
      if (e.shiftKey && (active === first || active === el || !el.contains(active))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Saat mulai menutup, kembalikan fokus ke pemicu (kecuali pemanggil sudah memindahkannya sendiri).
  useEffect(() => {
    if (isPresent) return
    const active = document.activeElement
    const stranded = !active || active === document.body || !!panel.current?.contains(active)
    let target = returnTo.current
    // A list/grid may re-render its rows while the drawer is open; fall back to the twin with the same accessible name.
    if (target && !target.isConnected) {
      const name = target.getAttribute('aria-label')
      target = name ? [...document.querySelectorAll<HTMLElement>(`${target.tagName}[aria-label]`)].find(n => n.getAttribute('aria-label') === name) ?? null : null
    }
    if (stranded && target) target.focus({ preventScroll: true })
  }, [isPresent])

  return <>
    <motion.div className="drawer-scrim" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: .22, ease: EASE_OUT } }} exit={{ opacity: 0, transition: { duration: .24, ease: EASE_OUT } }} onClick={onClose} />
    <motion.aside ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`side-drawer ${wide ? 'wide' : ''}`}
      initial={reduce ? { opacity: 0 } : { x: '100%' }}
      animate={reduce ? { opacity: 1, transition: { duration: .16 } } : { x: 0, transition: { duration: .38, ease: EASE_DRAWER } }}
      exit={reduce ? { opacity: 0, transition: { duration: .12 } } : { x: '100%', transition: { duration: .24, ease: EASE_DRAWER } }}>
      <button type="button" className="drawer-x" aria-label="Tutup" onClick={onClose}><X size={18} aria-hidden="true" /></button>
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
