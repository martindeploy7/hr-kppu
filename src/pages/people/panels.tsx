import type { ReactNode } from 'react'
import type { Employee } from '../../engine/types.ts'
import { fmt, pct } from '../../lib/format.ts'
import { formatID } from '../../engine/dates.ts'
import { MonthStrip } from './charts.tsx'
import { share, WINDOWS, type EmployeeEvent, type EmployeeGroup, type MonthBucket, type WindowMonths } from './data.ts'

export function Panel({ title, sub, aside, className = '', children }: {
  title: string; sub?: ReactNode; aside?: ReactNode; className?: string; children: ReactNode
}) {
  return <section className={`pd-panel ${className}`}>
    <header className="pd-panel-head">
      <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
      {aside && <span className="pd-badge">{aside}</span>}
    </header>
    {children}
  </section>
}

export function Segmented<T extends string | number>({ label, value, options, render, onChange }: {
  label: string; value: T; options: T[]; render: (option: T) => string; onChange: (option: T) => void
}) {
  return <div className="pd-seg" role="group" aria-label={label}>
    {options.map(option => <button type="button" key={option} aria-pressed={option === value} onClick={() => onChange(option)}>{render(option)}</button>)}
  </div>
}

export function WindowPicker({ value, onChange }: { value: WindowMonths; onChange: (value: WindowMonths) => void }) {
  return <Segmented label="Jendela waktu perubahan pegawai" value={value} options={WINDOWS} render={months => `${months} bulan`} onChange={onChange} />
}

/* ---------- pendidikan: ordered table with inline bars ---------- */

export function EducationTable({ groups, total, onSelect }: {
  groups: EmployeeGroup[]; total: number; onSelect: (group: EmployeeGroup) => void
}) {
  const max = Math.max(1, ...groups.map(group => group.employees.length))
  if (!groups.length) return <p className="pd-empty">Belum ada data pendidikan.</p>
  return <div className="pd-table-wrap">
    <table className="pd-table pd-edu">
      <thead><tr><th scope="col">Jenjang</th><th scope="col" className="num">Pegawai</th><th scope="col" className="share">Porsi</th></tr></thead>
      <tbody>{groups.map(group => {
        const count = group.employees.length
        return <tr key={group.name} className={group.missing ? 'is-missing' : ''}>
          <th scope="row"><button type="button" className="pd-row-link" disabled={!count} onClick={() => onSelect(group)}
            aria-label={`Lihat ${count} pegawai dengan pendidikan ${group.name}, ${share(count, total)}`}>{group.name}</button></th>
          <td className="num"><strong>{fmt.format(count)}</strong></td>
          <td className="share"><span className="pd-inline"><span className="pd-inline-track" aria-hidden="true"><span style={{ width: `${count ? Math.max(2, (count / max) * 100) : 0}%` }} /></span><small>{share(count, total)}</small></span></td>
        </tr>
      })}</tbody>
    </table>
  </div>
}

/* ---------- perubahan pegawai: timeline + list ---------- */

export type EventNote = { text: string; action: string; count: number; onOpen: () => void }

export function EventPanel({ title, range, items, buckets, nowKey, emptyText, notes, onBucket, onPerson, onAll }: {
  title: string; range: string; items: EmployeeEvent[]; buckets: MonthBucket[]; nowKey: string; emptyText: string
  notes: EventNote[]
  onBucket: (bucket: MonthBucket) => void; onPerson: (employee: Employee) => void; onAll: () => void
}) {
  return <section className="pd-panel pd-event">
    <header className="pd-panel-head">
      <div><h3>{title}</h3><p>{range}</p></div>
      <strong className="pd-event-count">{fmt.format(items.length)}<small> pegawai</small></strong>
    </header>
    <MonthStrip title={title} buckets={buckets} nowKey={nowKey} onSelect={onBucket} />
    {items.length ? <ul className="pd-event-list">{items.slice(0, 4).map(({ employee, date }) => <li key={employee.id}>
      <button type="button" className="pd-event-row" onClick={() => onPerson(employee)}>
        <span><strong>{employee.nama}</strong><small>{[employee.kantor, employee.unit || 'Unit belum diisi'].filter(Boolean).join(' · ')}</small></span>
        <time dateTime={date}>{formatID(date, { short: true })}</time>
      </button>
    </li>)}</ul> : <p className="pd-empty">{emptyText}</p>}
    {items.length > 4 && <button type="button" className="pd-more" onClick={onAll}>Lihat semua {fmt.format(items.length)} pegawai</button>}
    {notes.filter(note => note.count > 0).map(note => <div className="pd-note" key={note.text}>
      <p>{note.text}</p>
      <button type="button" className="pd-more" onClick={note.onOpen}>{note.action}</button>
    </div>)}
  </section>
}

/* ---------- kelengkapan data ---------- */

export function CompletenessPanel({ fields, employeeCount, onMissing }: {
  fields: { key: keyof Employee; label: string; why: string; filled: number }[]
  employeeCount: number
  onMissing: (field: { key: keyof Employee; label: string; why: string }) => void
}) {
  const filledTotal = fields.reduce((sum, field) => sum + field.filled, 0)
  const total = fields.length * employeeCount
  const overall = pct(filledTotal, total)
  const sorted = [...fields].sort((a, b) => a.filled - b.filled || a.label.localeCompare(b.label, 'id'))
  return <Panel title="Kelengkapan data" sub={`${fields.length} isian penting untuk profil, pengelompokan, dan tindak lanjut. Terendah di atas; pilih jumlah untuk melihat siapa yang belum terisi.`} aside={`${overall}% terisi`} className="pd-complete">
    <div className="pd-complete-overview">
      <div><strong>{fmt.format(filledTotal)} <small>dari {fmt.format(total)} isian</small></strong><span>rata-rata cakupan seluruh master pegawai</span></div>
      <div className="pd-meter" role="meter" aria-label="Kelengkapan seluruh isian" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall}><span style={{ width: `${overall}%` }} /></div>
    </div>
    <div className="pd-table-wrap">
      <table className="pd-table pd-complete-table">
        <thead><tr><th scope="col">Data yang dicek</th><th scope="col" className="share">Cakupan</th><th scope="col" className="num">Belum terisi</th></tr></thead>
        <tbody>{sorted.map(field => {
          const coverage = pct(field.filled, employeeCount)
          const missing = employeeCount - field.filled
          return <tr key={field.key}>
            <th scope="row"><span>{field.label}</span><small>{field.why}</small></th>
            <td className="share"><span className="pd-inline" role="meter" aria-label={`${field.label}: ${coverage}% terisi`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage}>
              <span className="pd-inline-track"><span style={{ width: `${coverage}%` }} /></span><small>{fmt.format(field.filled)}/{fmt.format(employeeCount)} · {coverage}%</small>
            </span></td>
            <td className="num">{missing > 0
              ? <button type="button" className="pd-count-link" aria-label={`Lihat ${missing} pegawai yang ${field.label} belum terisi`} onClick={() => onMissing(field)}>{fmt.format(missing)}</button>
              : <span className="pd-ok">Lengkap</span>}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
  </Panel>
}
