import { useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import type { Employee } from '../../engine/types.ts'
import { fmt, initials } from '../../lib/format.ts'

export type SelectedGroup = {
  title: string
  name: string
  description: string
  employees: Employee[]
  meta: (employee: Employee) => string
}

const PAGE = 50

export function PeopleGroupDrawer({ group, onSelect }: { group: SelectedGroup; onSelect: (employee: Employee) => void }) {
  const [limit, setLimit] = useState(PAGE)
  const [query, setQuery] = useState('')
  const sorted = useMemo(() => [...group.employees].sort((a, b) => a.nama.localeCompare(b.nama, 'id')), [group.employees])
  const employees = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id-ID')
    if (!needle) return sorted
    return sorted.filter(e => [e.nama, e.nip, e.jabatan, e.unit, e.kantor].some(value => (value ?? '').toLocaleLowerCase('id-ID').includes(needle)))
  }, [sorted, query])
  return <div className="pd-drawer">
    <p className="pd-drawer-kicker">{group.title}</p>
    <h2>{group.name}</h2>
    <p className="pd-drawer-desc">{group.description}</p>
    <div className="pd-drawer-bar">
      <p className="pd-drawer-count" aria-live="polite">{query.trim() ? `${fmt.format(employees.length)} dari ${fmt.format(sorted.length)} pegawai` : `${fmt.format(sorted.length)} pegawai`}</p>
      {sorted.length > 8 && <label className="pd-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(PAGE) }} placeholder="Cari nama, NIP, jabatan…" aria-label="Cari pegawai dalam daftar ini" />
      </label>}
    </div>
    {employees.length ? <ul className="pd-detail-list">{employees.slice(0, limit).map(employee => <li key={employee.id}>
      <button type="button" className="pd-detail-row" onClick={() => onSelect(employee)}>
        <span className="pd-detail-avatar" aria-hidden="true">{initials(employee.nama)}</span>
        <span className="pd-detail-copy"><strong>{employee.nama}</strong><small>{group.meta(employee) || employee.statusKepegawaian}</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </li>)}</ul> : <p className="pd-empty">Tidak ada pegawai yang cocok.</p>}
    {employees.length > limit && <button type="button" className="pd-more" onClick={() => setLimit(value => value + PAGE)}>Tampilkan {Math.min(PAGE, employees.length - limit)} pegawai berikutnya</button>}
  </div>
}
