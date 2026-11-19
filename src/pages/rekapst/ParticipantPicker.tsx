import { useMemo, useState } from 'react'
import { OFFICES } from '../../engine/ids.ts'
import { BulkPaste } from './BulkPaste.tsx'

export type EmployeeOption = { id: string; nama: string; nip: string; kantor: string; unit: string; jabatan?: string }
export type ExternalEntry = { name: string; note?: string }
const norm = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('id-ID')

/**
 * Peserta ST: pegawai master dari kantor mana pun (cari nama/NIP/jabatan, saring kantor), peserta "Lainnya" tanpa NIP
 * (nama + keterangan), dan tempel daftar untuk ST besar.
 */
export function ParticipantPicker({ employees, employeeIds, onEmployeeIds, externals, onExternals, max, onError }: {
  employees: EmployeeOption[]; employeeIds: string[]; onEmployeeIds: (ids: string[]) => void
  externals: ExternalEntry[]; onExternals: (items: ExternalEntry[]) => void; max: number; onError: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  const [officeFilter, setOfficeFilter] = useState('Semua')
  const [externalOpen, setExternalOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [externalName, setExternalName] = useState('')
  const [externalNote, setExternalNote] = useState('')
  const total = employeeIds.length + externals.length
  const byId = useMemo(() => new Map(employees.map(employee => [employee.id, employee])), [employees])
  const selected = useMemo(() => employeeIds.flatMap(id => byId.get(id) ?? []), [employeeIds, byId])
  const options = useMemo(() => {
    const text = norm(query.trim())
    if (!text && officeFilter === 'Semua') return []
    const picked = new Set(employeeIds)
    return employees.filter(employee => !picked.has(employee.id) && (officeFilter === 'Semua' || employee.kantor === officeFilter)
      && (!text || norm(`${employee.nama} ${employee.nip} ${employee.jabatan ?? ''} ${employee.unit} ${employee.kantor}`).includes(text))).slice(0, 30)
  }, [employees, query, officeFilter, employeeIds])
  const addEmployee = (id: string) => {
    if (total >= max) { onError(`Maksimal ${max} peserta per ST.`); return }
    onError(''); onEmployeeIds(employeeIds.includes(id) ? employeeIds : [...employeeIds, id]); setQuery('')
  }
  const addExternal = () => {
    const name = externalName.trim().replace(/\s+/g, ' ')
    if (name.length < 2) { onError('Isi nama peserta Lainnya (minimal 2 huruf).'); return }
    if (total >= max) { onError(`Maksimal ${max} peserta per ST.`); return }
    if (externals.some(item => norm(item.name) === norm(name))) { onError(`${name} sudah ada di daftar Lainnya.`); return }
    onError(''); onExternals([...externals, { name, note: externalNote.trim() || undefined }]); setExternalName(''); setExternalNote('')
  }

  return <div className="st-multi">
    <span className="st-multi-label">Peserta yang ditugaskan ({total}/{max})</span>
    <div className="st-picker">
      <div className="st-picker-search">
        <input aria-label="Cari pegawai" autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nama, NIP / NI PPPK, atau jabatan"
          // Enter di kolom cari memilih hasil teratas; tidak pernah mengirim ST yang belum lengkap.
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (options[0]) addEmployee(options[0].id) } else if (e.key === 'Escape') setQuery('') }} />
        <select aria-label="Saring menurut kantor" value={officeFilter} onChange={e => setOfficeFilter(e.target.value)}>
          <option value="Semua">Semua kantor</option>{OFFICES.map(office => <option key={office}>{office}</option>)}
        </select>
      </div>
      {options.length > 0 && <ul className="st-picker-list">{options.map(employee => <li key={employee.id}><button type="button" onClick={() => addEmployee(employee.id)}><strong>{employee.nama}</strong><small>{employee.kantor} · {employee.jabatan || 'Jabatan -'} · {employee.unit || 'Unit -'}</small><small className="mono">{employee.nip || 'tanpa NIP / NI PPPK'}</small></button></li>)}</ul>}
      {(query.trim() || officeFilter !== 'Semua') && !options.length && <small className="muted">Tidak ada pegawai yang cocok{officeFilter !== 'Semua' ? ` di ${officeFilter}` : ''}.</small>}
    </div>
    <div className="st-tools">
      <button type="button" className="btn secondary" aria-expanded={bulkOpen} onClick={() => setBulkOpen(open => !open)}>Tempel daftar peserta</button>
      <button type="button" className="btn secondary" aria-expanded={externalOpen} onClick={() => setExternalOpen(open => !open)}>Tambah peserta Lainnya (tanpa NIP)</button>
      {total > 5 && <button type="button" className="btn ghost" onClick={() => { onEmployeeIds([]); onExternals([]) }}>Kosongkan daftar</button>}
    </div>
    {externalOpen && <div className="st-external-form" role="group" aria-label="Peserta Lainnya">
      <p className="muted small">Untuk orang yang tidak ada di master dan tidak punya NIP, mis. pengemudi. Tidak dicocokkan dengan pegawai mana pun dan tidak memengaruhi uang makan siapa pun.</p>
      <label className="st-field">Nama<input value={externalName} maxLength={120} onChange={e => setExternalName(e.target.value)} placeholder="Mis. Eko Yulianto" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExternal() } }} /></label>
      <label className="st-field">Keterangan (peran)<input value={externalNote} maxLength={200} onChange={e => setExternalNote(e.target.value)} placeholder="Mis. Driver Komisi" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExternal() } }} /></label>
      <button type="button" className="btn secondary" onClick={addExternal}>Tambahkan</button>
    </div>}
    {bulkOpen && <BulkPaste employees={employees} selectedIds={employeeIds} remaining={Math.max(0, max - total)} onClose={() => setBulkOpen(false)}
      onApply={result => {
        onEmployeeIds([...employeeIds, ...result.employeeIds]); onExternals([...externals, ...result.externals.filter(item => !externals.some(old => norm(old.name) === norm(item.name)))])
        onError(''); setBulkOpen(false)
      }} />}
    {total > 0 && <ul className="st-chips scroll">{selected.map(employee => <li key={employee.id} className="st-chip"><span><strong>{employee.nama}</strong><small className="mono">{employee.nip || 'NI PPPK tidak tercatat'}</small><small>{employee.kantor} · {employee.jabatan || 'Jabatan -'}</small></span><button type="button" aria-label={`Hapus ${employee.nama}`} onClick={() => onEmployeeIds(employeeIds.filter(id => id !== employee.id))}>×</button></li>)}
      {employeeIds.filter(id => !byId.has(id)).map(id => <li key={id} className="st-chip"><span><strong>Pegawai {id}</strong><small>Tidak ada di master saat ini</small></span><button type="button" aria-label={`Hapus pegawai ${id}`} onClick={() => onEmployeeIds(employeeIds.filter(item => item !== id))}>×</button></li>)}
      {externals.map(item => <li key={`ext:${item.name}`} className="st-chip external"><span><strong>{item.name}</strong><small><span className="st-badge">Lainnya</span> {item.note || 'tanpa keterangan'}</small></span><button type="button" aria-label={`Hapus ${item.name}`} onClick={() => onExternals(externals.filter(other => other !== item))}>×</button></li>)}
    </ul>}
  </div>
}
