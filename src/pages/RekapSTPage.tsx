import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ListSkeleton } from '../components/Skeleton.tsx'
import { FileText, LogOut, ShieldCheck } from 'lucide-react'
import { ROLE_LABEL, type User } from '../../shared/workspace.ts'
import { eachDay, monthBounds } from '../engine/dates.ts'
import { OFFICES } from '../engine/ids.ts'
import { api } from '../lib/api.ts'
import { useAuth } from '../state/Auth.tsx'
import { useHr } from '../state/HrData.tsx'
import { Note, PageHeader, Panel } from '../components/ui.tsx'
import './rekapst/rekapst.css'

type EmployeeOption = { id: string; nama: string; nip: string; kantor: string; unit: string; jabatan?: string }
type RekapRecord = {
  id: string; sourceId: string; registerOffice: string; letterNo: string; letterDate: string
  employeeId: string; name: string; nip: string; activityDate: string; destination: string
  status: string; createdAt: string; createdBy: string
}
type SourceInfo = { office: string; id: string; coverage: { start: string; end: string; status: string; basis: string; at: string }[] }
type RekapResponse = { revision: number; records: RekapRecord[]; sourceIds: SourceInfo[] }
type HrActions = ReturnType<typeof useHr>

const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7)
const idDate = (value: string) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Belum diisi'
const MAX_DAYS = 31, MAX_EMPLOYEES = 50
const shortDate = (value: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
const dateRange = (start: string, end: string) => start === end ? idDate(start) : `${idDate(start)} – ${idDate(end)}`
type StGroup = { key: string; letterNo: string; letterDate: string; registerOffice: string; destination: string; records: RekapRecord[]; people: { employeeId: string; name: string; nip: string }[]; start: string; end: string; active: number }
const groupRecords = (records: RekapRecord[]): StGroup[] => {
  const map = new Map<string, StGroup>()
  for (const record of records) {
    const key = `${record.registerOffice}|${record.letterNo}|${record.letterDate}`
    let group = map.get(key)
    if (!group) { group = { key, letterNo: record.letterNo, letterDate: record.letterDate, registerOffice: record.registerOffice, destination: record.destination, records: [], people: [], start: record.activityDate, end: record.activityDate, active: 0 }; map.set(key, group) }
    group.records.push(record)
    if (record.activityDate < group.start) group.start = record.activityDate
    if (record.activityDate > group.end) group.end = record.activityDate
    if (record.status === 'active') group.active++
    const personKey = record.employeeId || record.nip || record.name
    if (!group.people.some(person => (person.employeeId || person.nip || person.name) === personKey)) group.people.push({ employeeId: record.employeeId, name: record.name, nip: record.nip })
  }
  return [...map.values()].sort((a, b) => b.start.localeCompare(a.start) || a.letterNo.localeCompare(b.letterNo, 'id'))
}
const stateLabel: Record<string, string> = { active: 'Aktif', excluded: 'Dibatalkan', superseded: 'Digantikan', 'not-selected': 'Tidak dipilih' }

export function RekapSTPage({ toast, office }: { toast: (message: string) => void; office?: string }) {
  const hr = useHr(), { user } = useAuth()
  return <RekapSTContent user={user} hr={hr} toast={toast} initialOffice={office && OFFICES.includes(office) ? office : undefined} initialDate={hr.weekRecon.period.start.slice(0, 7) === hr.activePeriod ? hr.weekRecon.period.start : `${hr.activePeriod}-01`} />
}

export function RekapSTOperator() {
  const { user, logout } = useAuth()
  return <RekapSTContent user={user} operator logout={logout} />
}

function RekapSTContent({ user, hr, operator = false, logout, toast, initialOffice, initialDate }: { user: User; hr?: HrActions; operator?: boolean; logout?: () => Promise<void>; toast?: (message: string) => void; initialOffice?: string; initialDate?: string }) {
  const [period, setPeriod] = useState(hr?.activePeriod || currentMonth())
  const [filterOffice, setFilterOffice] = useState(user.role === 'operator_st' ? user.offices?.[0] ?? 'Pusat' : initialOffice ?? 'Semua')
  const [registerOffice, setRegisterOffice] = useState(user.role === 'operator_st' ? user.offices?.[0] ?? 'Pusat' : initialOffice ?? 'Pusat')
  const [recordsLoaded, setRecordsLoaded] = useState(false)
  const [data, setData] = useState<RekapResponse>({ revision: hr?.revision ?? 0, records: [], sourceIds: [] })
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [employeeIds, setEmployeeIds] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [letterNo, setLetterNo] = useState('')
  const [letterDate, setLetterDate] = useState('')
  const [startDate, setStartDate] = useState(`${period}-01`)
  const [endDate, setEndDate] = useState('')
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const canAdd = user.role === 'superadmin' || user.role === 'operator_st'
  const selectedEmployees = useMemo(() => employeeIds.flatMap(id => employees.find(employee => employee.id === id) ?? []), [employeeIds, employees])
  const effectiveEnd = endDate || startDate
  const dateError = !startDate ? '' : effectiveEnd < startDate ? 'Tanggal tugas selesai tidak boleh sebelum tanggal mulai.' : eachDay(startDate, effectiveEnd).length > MAX_DAYS ? `Rentang tanggal tugas maksimal ${MAX_DAYS} hari.` : ''
  const dayList = useMemo(() => startDate && !dateError ? eachDay(startDate, effectiveEnd) : [], [startDate, effectiveEnd, dateError])
  const groups = useMemo(() => groupRecords(data.records), [data.records])
  const officeForQuery = user.role === 'operator_st' ? user.offices?.[0] : filterOffice

  const loadRecords = useCallback(async () => {
    const query = new URLSearchParams({ period })
    if (officeForQuery && officeForQuery !== 'Semua') query.set('office', officeForQuery)
    const response = await api<RekapResponse>(`/rekap-st?${query}`)
    setData(response); setRecordsLoaded(true)
  }, [period, officeForQuery])

  useEffect(() => {
    let active = true
    loadRecords().catch(e => { if (active) { setError((e as Error).message); setRecordsLoaded(true) } })
    return () => { active = false }
  }, [loadRecords])

  useEffect(() => {
    if (!canAdd) return
    let active = true
    const query = new URLSearchParams()
    if (registerOffice) query.set('office', registerOffice)
    api<{ employees: EmployeeOption[] }>(`/rekap-st/employees${query.size ? `?${query}` : ''}`)
      .then(response => { if (active) setEmployees(response.employees) })
      .catch(e => { if (active) setError((e as Error).message) })
    return () => { active = false }
  }, [canAdd, registerOffice])

  useEffect(() => {
    if (hr) setPeriod(hr.activePeriod)
  }, [hr?.activePeriod])

  useEffect(() => {
    setStartDate(initialDate?.slice(0, 7) === period ? initialDate : `${period}-01`); setEndDate('')
  }, [period, initialDate])

  const employeeOptions = useMemo(() => employeeQuery.trim() ? employees
    .filter(employee => !employeeIds.includes(employee.id) && `${employee.nama} ${employee.nip}`.toLocaleLowerCase('id-ID').includes(employeeQuery.trim().toLocaleLowerCase('id-ID')))
    .slice(0, 8) : [], [employees, employeeQuery, employeeIds])
  const addEmployee = (id: string) => {
    if (employeeIds.length >= MAX_EMPLOYEES) { setError(`Maksimal ${MAX_EMPLOYEES} pegawai per ST.`); return }
    setError(''); setEmployeeIds(current => current.includes(id) ? current : [...current, id]); setEmployeeQuery('')
  }
  const officeOptions = user.role === 'operator_st' ? user.offices ?? [] : OFFICES
  const currentSource = data.sourceIds.find(source => source.office === registerOffice)
  const hasOtherSt = !!hr?.files.some(file => file.kind === 'surat-tugas' && file.office === registerOffice && file.active !== false && !file.id.startsWith('manual-st:') && file.assignments.some(item => item.start.slice(0, 7) === period))
  const bounds = monthBounds(period)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const canConfirmCoverage = !!hr && user.role === 'superadmin' && bounds.end <= today
  const coverageState = hr?.monthlyPackage.coverage.find(item => item.office === registerOffice && item.source === 'surat-tugas')?.state ?? 'missing'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!employeeIds.length) { setError('Pilih minimal satu pegawai dari daftar master.'); return }
    if (dateError) { setError(dateError); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api<{ created: number; skipped: number; revision: number }>('/rekap-st', { method: 'POST', body: JSON.stringify({
        expectedRevision: data.revision, registerOffice, letterNo, letterDate, employeeIds,
        startDate, endDate: effectiveEnd, destination,
      }) })
      setData(current => ({ ...current, revision: result.revision }))
      setMessage(`Rekap ST ${letterNo} tersimpan: ${result.created} baris dibuat${result.skipped ? `, ${result.skipped} baris sudah ada dan dilewati` : ''}.`)
      setLetterNo(''); setLetterDate(''); setEmployeeQuery(''); setEmployeeIds([]); setEndDate(''); setDestination('')
      toast?.('Rekap ST tersimpan')
      try { await loadRecords() }
      catch (e) { setError(`Rekap tersimpan, tetapi daftar gagal dimuat ulang: ${(e as Error).message}`) }
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const voidRecord = async (record: RekapRecord) => {
    const reason = window.prompt(`Jelaskan alasan membatalkan ST ${record.letterNo} untuk ${record.name} (minimal 10 karakter):`)
    if (!reason || reason.trim().length < 10) return
    setBusy(true); setError('')
    try {
      await api(`/rekap-st/${record.id}/void`, { method: 'POST', body: JSON.stringify({ expectedRevision: data.revision, reason: reason.trim() }) })
      await loadRecords()
      setMessage(`Rekap ST ${record.letterNo} dibatalkan dengan jejak audit.`)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const confirmCoverage = async () => {
    if (!hr || !canConfirmCoverage) return
    const basis = window.prompt(`Jelaskan dasar konfirmasi kelengkapan Rekap ST ${registerOffice} untuk ${period} (minimal 10 karakter):`)
    if (!basis || basis.trim().length < 10) return
    if (data.records.some(record => record.registerOffice === registerOffice && record.status === 'active')) {
      if (!currentSource) { setError('Sumber rekap ST belum terbaca ulang. Muat ulang halaman lalu coba lagi.'); return }
      if (!window.confirm(`Konfirmasi seluruh rekap ST ${registerOffice} untuk bulan ${period} sudah dimasukkan?`)) return
      try { await hr.declareFileCoverage(currentSource.id, bounds.start, bounds.end, 'complete', basis.trim()); setMessage(`Kelengkapan Rekap ST ${registerOffice} untuk ${period} dikonfirmasi.`) }
      catch (e) { setError((e as Error).message) }
      return
    }
    if (hasOtherSt) { setError('Ada ST lama dari Excel pada kantor dan periode ini. Konfirmasi cakupannya melalui halaman Impor Sumber.'); return }
    if (!window.confirm(`Konfirmasi tidak ada ST untuk ${registerOffice} pada seluruh bulan ${period}?`)) return
    try { await hr.declareNilSt(registerOffice, bounds.start, bounds.end, basis.trim()); setMessage(`Rekap ST nihil ${registerOffice} untuk ${period} dicatat.`) }
    catch (e) { setError((e as Error).message) }
  }

  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      await api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
      setCurrentPassword(''); setNewPassword(''); setMessage('Password diperbarui. Sesi lain telah dicabut.')
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const brand = <div className="st-operator-head">
    <div className="brand-logo"><img src="/kppu-logo.png" alt="Lambang KPPU" /></div>
    <div><strong>KPPU HR</strong><span>Rekap Surat Tugas</span></div>
    <div className="st-operator-account"><span>{user.name} · {ROLE_LABEL[user.role]}</span>{user.offices?.[0] && <small>{user.offices[0]}</small>}</div>
    {operator && <button className="btn secondary" onClick={() => void logout?.()}><LogOut size={15} /> Keluar</button>}
  </div>

  return <div className={operator ? 'st-operator-shell' : 'page'}>
    {operator && <header>{brand}</header>}
    <PageHeader title="Rekap ST" actions={<label className="select-label">Periode<input type="month" value={period} onChange={e => e.target.value && setPeriod(e.target.value)} aria-label="Bulan rekap ST" /></label>}>
      {operator ? 'Masukkan surat tugas untuk pegawai di kantor cakupan Anda.' : 'Catat satu surat tugas dengan beberapa pegawai dan rentang tanggal tugas. Rekap manual ini langsung menjadi bukti pada rekonsiliasi bulan terkait.'}
    </PageHeader>

    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status" className="st-success">{message}</p>}

    {canAdd && <Panel title="Tambah rekap surat tugas" sub="Satu pengajuan untuk satu Surat Tugas: satu nomor ST, rentang tanggal tugas, dan beberapa pegawai, sesuai rekap Excel.">
      {!employees.length && <Note tone="warn">Belum ada pegawai di master resmi untuk kantor ini. Minta Superadmin memperbarui master pegawai sebelum menginput ST.</Note>}
      <form onSubmit={submit}>
        <div className="st-entry-grid">
          {user.role === 'superadmin' && <label>Kantor register ST<select required value={registerOffice} onChange={e => { setRegisterOffice(e.target.value); setEmployeeIds([]); setEmployeeQuery('') }}>{OFFICES.map(office => <option key={office}>{office}</option>)}</select></label>}
          <label>No. ST<input required maxLength={100} value={letterNo} onChange={e => setLetterNo(e.target.value)} placeholder="256/" /></label>
          <label>Tanggal ST<input type="date" required value={letterDate} onChange={e => setLetterDate(e.target.value)} /></label>
          <label>Tanggal tugas mulai<input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
          <label>Tanggal tugas selesai<input type="date" required min={startDate} value={effectiveEnd} onChange={e => setEndDate(e.target.value)} /></label>
          <label className="st-destination-field">Tujuan<input required maxLength={250} value={destination} onChange={e => setDestination(e.target.value)} placeholder="Kota, Provinsi" /></label>
        </div>
        {dateError && <p role="alert" className="form-error">{dateError}</p>}
        <div className="st-multi">
          <span className="st-multi-label">Pegawai yang ditugaskan ({employeeIds.length}/{MAX_EMPLOYEES})</span>
          <div className="st-picker">
            <input aria-label="Cari pegawai" autoComplete="off" value={employeeQuery} onChange={e => setEmployeeQuery(e.target.value)} placeholder="Cari nama atau NIP / NI PPPK lalu pilih"
              // Enter in the search box picks the top match; it must never submit a half-filled ST.
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (employeeOptions[0]) addEmployee(employeeOptions[0].id) } else if (e.key === 'Escape') setEmployeeQuery('') }} />
            {employeeOptions.length > 0 && <ul className="st-picker-list">{employeeOptions.map(employee => <li key={employee.id}><button type="button" onClick={() => addEmployee(employee.id)}><strong>{employee.nama}</strong><small>{employee.nip || 'tanpa NIP / NI PPPK'} · {employee.jabatan || 'Jabatan -'} · {employee.unit || 'Unit -'}</small></button></li>)}</ul>}
            {employeeQuery.trim() && !employeeOptions.length && <small className="muted">Tidak ada pegawai yang cocok.</small>}
          </div>
          {selectedEmployees.length > 0 && <ul className="st-chips">{selectedEmployees.map(employee => <li key={employee.id} className="st-chip"><span><strong>{employee.nama}</strong><small className="mono">{employee.nip || 'NI PPPK tidak tercatat'}</small><small>{employee.jabatan || 'Jabatan -'} · {employee.unit || 'Unit -'}</small></span><button type="button" aria-label={`Hapus ${employee.nama}`} onClick={() => setEmployeeIds(current => current.filter(id => id !== employee.id))}>×</button></li>)}</ul>}
        </div>
        {employeeIds.length > 0 && dayList.length > 0 && <div className="st-summary" role="status">
          <p><strong>{employeeIds.length} pegawai × {dayList.length} hari = {employeeIds.length * dayList.length} baris</strong></p>
          <p className="muted small">{dayList.map(shortDate).join(', ')}</p>
        </div>}
        <div className="st-form-actions"><span className="muted small">Identitas pegawai dikunci dari master agar rekap tidak salah pasangan. Baris yang sudah ada dilewati.</span><button className="btn primary" disabled={busy || !employeeIds.length || !!dateError}>{busy ? 'Menyimpan…' : 'Simpan rekap ST'}</button></div>
      </form>
    </Panel>}

    {canConfirmCoverage && <Panel title="Kelengkapan ST bulanan" sub="Penambahan ST tidak otomatis menyatakan register lengkap. Superadmin mengonfirmasi kelengkapan setelah mencocokkan seluruh rekap kantor.">
      <div className="st-coverage-row"><label>Kantor register<select value={registerOffice} onChange={e => setRegisterOffice(e.target.value)}>{officeOptions.map(office => <option key={office}>{office}</option>)}</select></label><div><span>Status cakupan</span><strong>{coverageState === 'complete' ? 'Lengkap' : coverageState === 'nil' ? 'Nihil' : coverageState === 'partial' ? 'Parsial' : coverageState === 'unconfirmed' ? 'Data ada, belum dikonfirmasi' : 'Belum dikonfirmasi'}</strong></div><button className="btn secondary" disabled={busy || ['complete', 'nil'].includes(coverageState)} onClick={() => void confirmCoverage()}>{data.records.some(record => record.registerOffice === registerOffice && record.status === 'active') ? 'Konfirmasi rekap lengkap' : 'Konfirmasi nihil ST'}</button></div>
      {hasOtherSt && <p className="muted small">Register ST dari Excel lama terdeteksi; konfirmasikan cakupan file tersebut di halaman Impor Sumber.</p>}
    </Panel>}

    <Panel title={`Daftar rekap · ${period}`} sub={operator ? `Kantor cakupan: ${user.offices?.join(', ') || 'belum ditetapkan'}` : 'Catatan aktif masuk ke rekonsiliasi. Pembatalan oleh Superadmin tetap tercatat sebagai jejak audit.'}>
      <div className="toolbar">
        <label className="select-label">Periode<input type="month" value={period} onChange={e => e.target.value && setPeriod(e.target.value)} aria-label="Filter bulan rekap" /></label>
        {!operator && <label className="select-label">Kantor<select value={filterOffice} onChange={e => setFilterOffice(e.target.value)}><option>Semua</option>{OFFICES.map(office => <option key={office}>{office}</option>)}</select></label>}
        <span className="count-line">{groups.length} ST · {data.records.length} baris</span>
        <button className="btn secondary" disabled={busy} onClick={() => void loadRecords().catch(e => setError((e as Error).message))}>Muat ulang</button>
      </div>
      {!recordsLoaded ? <ListSkeleton rows={5} cols={6} label="Memuat rekap ST…" /> : groups.length ? <div className="table-wrap"><table className="data">
        <thead><tr><th>No. ST</th><th>Tanggal ST</th><th>Pegawai</th><th>Tanggal Tugas</th><th>Tujuan</th><th>Kantor</th><th>Status</th></tr></thead>
        <tbody>{groups.map(group => {
          const open = expanded.has(group.key), first = group.records[0]
          return [<tr key={group.key}>
            <td><button type="button" className="st-group-toggle" aria-expanded={open} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next })}>{open ? '▾' : '▸'} <strong>{group.letterNo}</strong></button><small>Diinput {idDate(first.createdAt.slice(0, 10))} oleh {first.createdBy}</small></td>
            <td>{idDate(group.letterDate)}</td>
            <td>{group.people.length} pegawai<small>{group.people.slice(0, 2).map(person => person.name).join(', ')}{group.people.length > 2 ? `, +${group.people.length - 2} lainnya` : ''}</small></td>
            <td>{dateRange(group.start, group.end)}<small>{group.records.length} baris</small></td><td>{group.destination}</td><td>{group.registerOffice}</td>
            <td><span className={`st-record-status ${group.active ? 'active' : 'inactive'}`}>{group.active === group.records.length ? 'Aktif' : group.active ? `${group.active}/${group.records.length} aktif` : 'Dibatalkan'}</span></td>
          </tr>,
          open && <tr key={`${group.key}:detail`} className="st-group-detail"><td colSpan={7}>
            <ul className="st-group-people">{[...group.records].sort((a, b) => a.name.localeCompare(b.name, 'id') || a.activityDate.localeCompare(b.activityDate)).map(record => <li key={record.id}>
              <span>{record.name}</span><span className="mono">{record.nip || 'NI PPPK tidak tersedia di master'}</span><span>{idDate(record.activityDate)}</span>
              <span className={`st-record-status ${record.status === 'active' ? 'active' : 'inactive'}`}>{stateLabel[record.status] ?? record.status}</span>
              {user.role === 'superadmin' && record.status === 'active' && <button className="link" disabled={busy} onClick={() => void voidRecord(record)}>Batalkan</button>}
            </li>)}</ul>
          </td></tr>]
        })}</tbody>
      </table></div> : <p className="muted">Belum ada rekap ST untuk kantor dan bulan ini.</p>}
    </Panel>

    {operator && <Panel title="Akun operator" sub="Ganti password secara berkala dan keluar setelah selesai menggunakan perangkat bersama.">
      <details open={passwordOpen} onToggle={e => setPasswordOpen(e.currentTarget.open)}><summary>Ganti password</summary>
        <form onSubmit={changePassword} className="st-password-form"><label>Password saat ini<input type="password" required autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label><label>Password baru<input type="password" required minLength={14} maxLength={256} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label><button className="btn secondary" disabled={busy}>Simpan password</button></form>
      </details>
    </Panel>}
  </div>
}
