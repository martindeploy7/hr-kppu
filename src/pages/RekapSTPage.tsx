import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ListSkeleton } from '../components/Skeleton.tsx'
import { FileText, LogOut, ShieldCheck } from 'lucide-react'
import { ROLE_LABEL, type User } from '../../shared/workspace.ts'
import { monthBounds } from '../engine/dates.ts'
import { OFFICES } from '../engine/ids.ts'
import { api } from '../lib/api.ts'
import { useAuth } from '../state/Auth.tsx'
import { useHr } from '../state/HrData.tsx'
import { Note, PageHeader, Panel } from '../components/ui.tsx'

type EmployeeOption = { id: string; nama: string; nip: string; kantor: string; unit: string }
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
const monthEnd = (period: string) => {
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
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
  const [employeeId, setEmployeeId] = useState('')
  const [letterNo, setLetterNo] = useState('')
  const [letterDate, setLetterDate] = useState('')
  const [activityDate, setActivityDate] = useState(`${period}-01`)
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const canAdd = user.role === 'superadmin' || user.role === 'operator_st'
  const selectedEmployee = employees.find(employee => employee.id === employeeId)
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
    setActivityDate(initialDate?.slice(0, 7) === period ? initialDate : `${period}-01`)
  }, [period, initialDate])

  const employeeOptions = useMemo(() => employees
    .filter(employee => !employeeQuery || `${employee.nama} ${employee.nip} ${employee.unit}`.toLocaleLowerCase('id-ID').includes(employeeQuery.toLocaleLowerCase('id-ID')))
    .slice(0, 100), [employees, employeeQuery])
  const officeOptions = user.role === 'operator_st' ? user.offices ?? [] : OFFICES
  const currentSource = data.sourceIds.find(source => source.office === registerOffice)
  const hasOtherSt = !!hr?.files.some(file => file.kind === 'surat-tugas' && file.office === registerOffice && file.active !== false && !file.id.startsWith('manual-st:') && file.assignments.some(item => item.start.slice(0, 7) === period))
  const bounds = monthBounds(period)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const canConfirmCoverage = !!hr && user.role === 'superadmin' && bounds.end <= today
  const coverageState = hr?.monthlyPackage.coverage.find(item => item.office === registerOffice && item.source === 'surat-tugas')?.state ?? 'missing'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedEmployee) { setError('Pilih pegawai dari daftar master.'); return }
    if (activityDate.slice(0, 7) !== period) { setError('Tanggal kegiatan harus berada pada bulan yang sedang dipilih.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api<{ record: RekapRecord; revision: number }>('/rekap-st', { method: 'POST', body: JSON.stringify({
        expectedRevision: data.revision, registerOffice, letterNo, letterDate, employeeId,
        activityDate, destination,
      }) })
      setData(current => ({ ...current, revision: result.revision, records: [result.record, ...current.records] }))
      setLetterNo(''); setLetterDate(''); setEmployeeQuery(''); setEmployeeId(''); setActivityDate(`${period}-01`); setDestination('')
      setMessage(`Rekap ST ${result.record.letterNo} untuk ${result.record.name} tersimpan.`)
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
      {operator ? 'Masukkan surat tugas untuk pegawai di kantor cakupan Anda.' : 'Catat surat tugas per peserta dan tanggal kegiatan. Rekap manual ini langsung menjadi bukti pada rekonsiliasi bulan terkait.'}
    </PageHeader>

    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status" className="st-success">{message}</p>}

    {canAdd && <Panel title="Tambah rekap surat tugas" sub="Satu baris untuk satu pegawai pada satu tanggal kegiatan. Untuk ST beberapa hari, tambahkan satu baris per tanggal kegiatan.">
      {!employees.length && <Note tone="warn">Belum ada pegawai di master resmi untuk kantor ini. Minta Superadmin memperbarui master pegawai sebelum menginput ST.</Note>}
      <form onSubmit={submit}>
        <div className="st-entry-grid">
          {user.role === 'superadmin' && <label>Kantor register ST<select required value={registerOffice} onChange={e => { setRegisterOffice(e.target.value); setEmployeeId(''); setEmployeeQuery('') }}>{OFFICES.map(office => <option key={office}>{office}</option>)}</select></label>}
          <label>No. ST<input required maxLength={100} value={letterNo} onChange={e => setLetterNo(e.target.value)} /></label>
          <label>Tanggal ST<input type="date" required value={letterDate} onChange={e => setLetterDate(e.target.value)} /></label>
          <label className="st-employee-field">Nama Pegawai<input required list="rekap-st-employees" autoComplete="off" value={employeeQuery} onChange={e => {
            const value = e.target.value
            setEmployeeQuery(value)
            const selected = employees.find(employee => `${employee.nama} (${employee.nip || 'tanpa NI PPPK'}) · ${employee.kantor}` === value)
            setEmployeeId(selected?.id ?? '')
          }} placeholder="Cari nama pegawai" />
            <datalist id="rekap-st-employees">{employeeOptions.map(employee => <option key={employee.id} value={`${employee.nama} (${employee.nip || 'tanpa NI PPPK'}) · ${employee.kantor}`} />)}</datalist>
          </label>
          <label>NIP / NI PPPK<input readOnly value={selectedEmployee?.nip || (employeeId ? 'Tidak tercatat di master' : '')} placeholder="Terisi dari master pegawai" /></label>
          <label>Tanggal Kegiatan<input type="date" required min={`${period}-01`} max={monthEnd(period)} value={activityDate} onChange={e => setActivityDate(e.target.value)} /></label>
          <label className="st-destination-field">Tujuan<input required maxLength={250} value={destination} onChange={e => setDestination(e.target.value)} placeholder="Kota atau lokasi kegiatan" /></label>
        </div>
        <div className="st-form-actions"><span className="muted small">Identitas pegawai dikunci dari master agar rekap tidak salah pasangan.</span><button className="btn primary" disabled={busy || !employeeId}>{busy ? 'Menyimpan…' : 'Simpan rekap ST'}</button></div>
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
        <span className="count-line">{data.records.length} catatan</span>
        <button className="btn secondary" disabled={busy} onClick={() => void loadRecords().catch(e => setError((e as Error).message))}>Muat ulang</button>
      </div>
      {!recordsLoaded ? <ListSkeleton rows={5} cols={6} label="Memuat rekap ST…" /> : data.records.length ? <div className="table-wrap"><table className="data">
        <thead><tr><th>No. ST</th><th>Tanggal ST</th><th>Pegawai</th><th>Tanggal Kegiatan</th><th>Tujuan</th><th>Kantor</th><th>Status</th><th /></tr></thead>
        <tbody>{data.records.map(record => <tr key={record.id}>
          <td><strong>{record.letterNo}</strong><small>Diinput {idDate(record.createdAt.slice(0, 10))} oleh {record.createdBy}</small></td>
          <td>{idDate(record.letterDate)}</td>
          <td>{record.name}<small className="mono">{record.nip || 'NI PPPK tidak tersedia di master'}</small></td>
          <td>{idDate(record.activityDate)}</td><td>{record.destination}</td><td>{record.registerOffice}</td>
          <td><span className={`st-record-status ${record.status === 'active' ? 'active' : 'inactive'}`}>{stateLabel[record.status] ?? record.status}</span></td>
          <td>{user.role === 'superadmin' && record.status === 'active' && <button className="link" disabled={busy} onClick={() => void voidRecord(record)}>Batalkan</button>}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">Belum ada rekap ST untuk kantor dan bulan ini.</p>}
    </Panel>

    {operator && <Panel title="Akun operator" sub="Ganti password secara berkala dan keluar setelah selesai menggunakan perangkat bersama.">
      <details open={passwordOpen} onToggle={e => setPasswordOpen(e.currentTarget.open)}><summary>Ganti password</summary>
        <form onSubmit={changePassword} className="st-password-form"><label>Password saat ini<input type="password" required autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label><label>Password baru<input type="password" required minLength={14} maxLength={256} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label><button className="btn secondary" disabled={busy}>Simpan password</button></form>
      </details>
    </Panel>}
  </div>
}
