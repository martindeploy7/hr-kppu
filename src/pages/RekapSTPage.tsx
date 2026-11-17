import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ListSkeleton } from '../components/Skeleton.tsx'
import { FileText, LogOut, ShieldCheck } from 'lucide-react'
import { ROLE_LABEL, type User } from '../../shared/workspace.ts'
import { eachDay, monthBounds, monthLabel } from '../engine/dates.ts'
import { sourceRecordState } from '../engine/recordReviews.ts'
import { inspectSourceCoverage } from '../engine/monthlyFlow.ts'
import { OFFICES } from '../engine/ids.ts'
import { api } from '../lib/api.ts'
import { useAuth } from '../state/Auth.tsx'
import { useHr } from '../state/HrData.tsx'
import { Note, PageHeader, Panel } from '../components/ui.tsx'
import { useDialog } from '../components/Dialog.tsx'
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
  const [loadFailed, setLoadFailed] = useState(false)
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
  const [coverageError, setCoverageError] = useState('')
  const dialog = useDialog()
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
    setData(response); setRecordsLoaded(true); setLoadFailed(false)
  }, [period, officeForQuery])

  useEffect(() => {
    let active = true
    loadRecords().catch(e => { if (active) { setError((e as Error).message); setRecordsLoaded(true); setLoadFailed(true) } })
    return () => { active = false }
  }, [loadRecords])

  // Revisi ruang kerja berubah (mis. setelah konfirmasi kelengkapan): muat ulang agar expectedRevision tidak basi dan ST berikutnya tidak ditolak.
  const workspaceRevision = hr?.revision
  useEffect(() => {
    if (workspaceRevision === undefined || !recordsLoaded || workspaceRevision === data.revision) return
    loadRecords().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRevision])

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
  const bounds = monthBounds(period)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const canConfirmCoverage = !!hr && user.role === 'superadmin' && bounds.end <= today
  // Konfirmasi kelengkapan ST berlaku untuk seluruh KPPU (Pusat dan Kanwil I sampai VII), bukan per kantor.
  const stFiles = (hr?.files ?? []).filter(file => file.kind === 'surat-tugas' && file.active !== false && file.period?.start.slice(0, 7) === period)
  const manualActive = stFiles.filter(file => file.id.startsWith('manual-st:') && file.assignments.some(row => sourceRecordState(file, 'assignment', row.id) === 'active'))
  const hasManualSt = manualActive.length > 0
  const hostSource = manualActive.find(file => file.office === 'Pusat') ?? manualActive[0]
  const hasOtherSt = (hr?.files ?? []).some(file => file.kind === 'surat-tugas' && file.active !== false && !file.id.startsWith('manual-st:') && file.assignments.some(item => item.start.slice(0, 7) === period))
  const coverageState = hr ? inspectSourceCoverage(hr.files, bounds.start, bounds.end).find(item => item.source === 'surat-tugas')?.state ?? 'missing' : 'missing'
  /** Server menghapus deklarasi pada register kantor-bulan yang sama saat ST ditambahkan; bulan yang terdampak diperiksa di sini sebelum menyimpan. */
  const reopenedMonths = (months: string[]) => months.filter(month => {
    const range = monthBounds(month)
    const declarations = hr
      ? hr.files.find(file => file.kind === 'surat-tugas' && file.active !== false && file.id.startsWith('manual-st:') && file.office === registerOffice && file.period?.start.slice(0, 7) === month)?.coverageDeclarations
      : month === period ? data.sourceIds.find(source => source.office === registerOffice)?.coverage : undefined
    return !!declarations?.some(item => item.status === 'complete' && item.start <= range.end && item.end >= range.start)
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!employeeIds.length) { setError('Pilih minimal satu pegawai dari daftar master.'); return }
    if (dateError) { setError(dateError); return }
    const reopen = reopenedMonths([...new Set(dayList.map(day => day.slice(0, 7)))])
    const reopenLabel = reopen.map(monthLabel).join(' dan ')
    if (reopen.length && !await dialog.confirm({
      title: 'Konfirmasi kelengkapan ST akan dibuka kembali',
      message: `Menambah ST akan membuka kembali konfirmasi kelengkapan ST ${reopenLabel} (seluruh KPPU). UM final bulan ini ditahan sampai dikonfirmasi ulang.`,
      confirmLabel: 'Tambah ST dan buka kembali', cancelLabel: 'Jangan tambah',
    })) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api<{ created: number; skipped: number; revision: number }>('/rekap-st', { method: 'POST', body: JSON.stringify({
        expectedRevision: data.revision, registerOffice, letterNo, letterDate, employeeIds,
        startDate, endDate: effectiveEnd, destination,
      }) })
      setData(current => ({ ...current, revision: result.revision }))
      const reopenNote = reopen.length ? ` Konfirmasi kelengkapan ST ${reopenLabel} (seluruh KPPU) dibuka kembali; konfirmasi ulang agar UM final.` : ''
      setMessage(`Rekap ST ${letterNo} tersimpan: ${result.created} baris dibuat${result.skipped ? `, ${result.skipped} baris sudah ada dan dilewati` : ''}.${reopenNote}`)
      toast?.(`Rekap ST ${letterNo} tersimpan.${reopenNote}`)
      setLetterNo(''); setLetterDate(''); setEmployeeQuery(''); setEmployeeIds([]); setEndDate(''); setDestination('')
      void hr?.reload() // status cakupan dan tombol konfirmasi mengikuti data server tanpa menunggu polling
      try { await loadRecords() }
      catch (e) { setError(`Rekap tersimpan, tetapi daftar gagal dimuat ulang: ${(e as Error).message}`) }
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const voidRecord = async (record: RekapRecord) => {
    const reason = await dialog.prompt({ title: `Batalkan ST ${record.letterNo}?`, message: `Peserta: ${record.name}, ${idDate(record.activityDate)}. Pembatalan tercatat sebagai jejak audit.`, label: 'Alasan pembatalan', minLength: 10, placeholder: 'Mis. ST dibatalkan karena tugas dialihkan, lihat memo tertanggal ...', confirmLabel: 'Batalkan ST', cancelLabel: 'Jangan batalkan', tone: 'danger' })
    if (!reason) return
    setBusy(true); setError('')
    try {
      await api(`/rekap-st/${record.id}/void`, { method: 'POST', body: JSON.stringify({ expectedRevision: data.revision, reason }) })
      await loadRecords()
      setMessage(`Rekap ST ${record.letterNo} dibatalkan dengan jejak audit.`)
      toast?.(`Rekap ST ${record.letterNo} dibatalkan`)
      void hr?.reload()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const confirmCoverage = async () => {
    if (!hr || !canConfirmCoverage) return
    setCoverageError('')
    if (hasManualSt && !hostSource) { setCoverageError('Sumber rekap ST belum terbaca ulang. Muat ulang halaman lalu coba lagi.'); return }
    if (!hasManualSt && hasOtherSt) { setCoverageError('Ada ST lama dari Excel pada periode ini. Konfirmasi cakupannya melalui halaman Setoran & Review.'); return }
    const complete = hasManualSt
    const basis = await dialog.prompt({
      title: complete ? `Konfirmasi rekap ST ${monthLabel(period)} lengkap` : `Konfirmasi tidak ada ST pada ${monthLabel(period)}`,
      message: complete ? 'Pastikan seluruh ST bulan ini, dari Pusat dan Kanwil I sampai VII, sudah dimasukkan. Konfirmasi berlaku untuk seluruh KPPU.' : 'Tidak ada ST di seluruh KPPU (Pusat dan Kanwil I sampai VII) pada bulan ini.',
      label: 'Dasar konfirmasi', minLength: 10, placeholder: 'Mis. daftar ST Pusat dan seluruh Kanwil sudah dicocokkan dengan buku register.',
      confirmLabel: complete ? 'Konfirmasi lengkap' : 'Konfirmasi nihil',
    })
    if (!basis) return
    try {
      if (complete) await hr.declareFileCoverage(hostSource!.id, bounds.start, bounds.end, 'complete', basis)
      else await hr.declareNilSt('Pusat', bounds.start, bounds.end, basis)
      const done = complete ? `Kelengkapan rekap ST ${monthLabel(period)} (seluruh KPPU) dikonfirmasi.` : `Rekap ST nihil ${monthLabel(period)} (seluruh KPPU) dicatat.`
      setMessage(done); toast?.(done)
    } catch (e) { setCoverageError((e as Error).message) }
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
    <PageHeader title="Rekap ST" actions={<label className="select-label">Periode<input type="month" lang="id" value={period} onChange={e => e.target.value && setPeriod(e.target.value)} aria-label="Bulan rekap ST" /></label>}>
      {operator ? 'Masukkan surat tugas untuk pegawai di kantor cakupan Anda.' : 'Catat satu surat tugas untuk beberapa pegawai dan rentang tanggal. Rekap ini langsung menjadi bukti rekonsiliasi bulan terkait.'}
    </PageHeader>

    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role={toast ? undefined : 'status'} className="st-success">{message}</p>}

    {canAdd && <Panel title="Tambah rekap surat tugas" sub="Satu ST: satu nomor, satu rentang tanggal, beberapa pegawai.">
      {!employees.length && <Note tone="warn">Belum ada pegawai di master untuk kantor ini. Minta Superadmin melengkapi master pegawai sebelum mengisi ST.</Note>}
      <form onSubmit={submit}>
        <div className="st-entry-grid">
          {user.role === 'superadmin' && <label>Kantor register ST<select required aria-describedby="st-office-hint" value={registerOffice} onChange={e => { setRegisterOffice(e.target.value); setEmployeeIds([]); setEmployeeQuery('') }}>{OFFICES.map(office => <option key={office}>{office}</option>)}</select></label>}
          <label>No. ST<input required maxLength={100} value={letterNo} onChange={e => setLetterNo(e.target.value)} placeholder="256/" /></label>
          <label>Tanggal ST<input type="date" lang="id" required value={letterDate} onChange={e => setLetterDate(e.target.value)} /></label>
          <label>Tanggal tugas mulai<input type="date" lang="id" required value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
          <label>Tanggal tugas selesai<input type="date" lang="id" required min={startDate} value={effectiveEnd} onChange={e => setEndDate(e.target.value)} /></label>
          <label className="st-destination-field">Tujuan<input required maxLength={250} value={destination} onChange={e => setDestination(e.target.value)} placeholder="Kota, Provinsi" /></label>
        </div>
        {user.role === 'superadmin' && <p id="st-office-hint" className="muted small">Kantor register ST hanya label asal surat. Konfirmasi kelengkapan ST berlaku untuk seluruh KPPU.</p>}
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
        <div className="st-form-actions"><span className="muted small">Identitas pegawai diambil dari master. Baris yang sudah ada dilewati.</span><button className="btn primary" disabled={busy || !employeeIds.length || !!dateError}>{busy ? 'Menyimpan…' : 'Simpan rekap ST'}</button></div>
      </form>
    </Panel>}

    {canConfirmCoverage && <Panel title="Kelengkapan ST bulanan (seluruh KPPU)" sub="Satu konfirmasi untuk Pusat dan Kanwil I sampai VII, setelah seluruh rekap ST dicocokkan.">
      <details className="st-how"><summary>Cara kerja</summary><p>Menambah ST tidak otomatis menyatakan rekap lengkap. Tanpa konfirmasi, bulan ini tetap berstatus belum dikonfirmasi di rekonsiliasi. Menambah ST pada register yang sudah dikonfirmasi membuka kembali konfirmasinya.</p></details>
      <div className="st-coverage-row"><div><span>Status cakupan {monthLabel(period)}</span><strong>{coverageState === 'complete' ? 'Lengkap' : coverageState === 'nil' ? 'Nihil' : coverageState === 'partial' ? 'Parsial' : coverageState === 'unconfirmed' ? 'Data ada, belum dikonfirmasi' : 'Belum dikonfirmasi'}</strong></div><button className="btn secondary" disabled={busy || ['complete', 'nil'].includes(coverageState)} onClick={() => void confirmCoverage()}>{['complete', 'nil'].includes(coverageState) ? 'Sudah dikonfirmasi' : hasManualSt ? 'Konfirmasi rekap lengkap' : 'Konfirmasi nihil ST'}</button></div>
      {coverageError && <p role="alert" className="form-error">{coverageError}</p>}
      {hasOtherSt && <p className="muted small">Register ST dari Excel lama terdeteksi; konfirmasikan cakupan file tersebut di halaman Setoran &amp; Review.</p>}
    </Panel>}

    <Panel title={`Daftar rekap · ${period}`} sub={operator ? `Kantor cakupan: ${user.offices?.join(', ') || 'belum ditetapkan'}` : 'Catatan aktif masuk ke rekonsiliasi. Pembatalan tercatat sebagai jejak audit.'}>
      <div className="toolbar">
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
              {user.role === 'superadmin' && record.status === 'active' && <button className="link danger" disabled={busy} aria-label={`Batalkan ST ${record.letterNo} untuk ${record.name}`} onClick={() => void voidRecord(record)}>Batalkan</button>}
            </li>)}</ul>
          </td></tr>]
        })}</tbody>
      </table></div> : loadFailed ? <p className="muted">Daftar rekap gagal dimuat. Periksa koneksi, lalu pilih Muat ulang.</p> : <p className="muted">Belum ada rekap ST untuk kantor dan bulan ini.{canAdd ? ' Tambahkan lewat formulir di atas.' : ''}</p>}
    </Panel>

    {operator && <Panel title="Akun operator" sub="Keluar setelah selesai bila memakai perangkat bersama.">
      <details open={passwordOpen} onToggle={e => setPasswordOpen(e.currentTarget.open)}><summary>Ganti password</summary>
        <form onSubmit={changePassword} className="st-password-form"><label>Password saat ini<input type="password" required autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label><label>Password baru<input type="password" required minLength={14} maxLength={256} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label><button className="btn secondary" disabled={busy}>Simpan password</button></form>
      </details>
    </Panel>}
  </div>
}
