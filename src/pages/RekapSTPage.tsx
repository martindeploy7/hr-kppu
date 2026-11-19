import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ListSkeleton } from '../components/Skeleton.tsx'
import { LogOut, Pencil, Trash2 } from 'lucide-react'
import { ROLE_LABEL, type User } from '../../shared/workspace.ts'
import { ST_CATATAN_MAX, ST_MAX_PARTICIPANTS, type StAttachmentMeta, type StRecord } from '../../shared/rekapSt.ts'
import { eachDay, monthBounds, monthLabel, overlapsMonth } from '../engine/dates.ts'
import { sourceRecordState } from '../engine/recordReviews.ts'
import { inspectSourceCoverage } from '../engine/monthlyFlow.ts'
import { OFFICES } from '../engine/ids.ts'
import { api } from '../lib/api.ts'
import { useAuth } from '../state/Auth.tsx'
import { useHr } from '../state/HrData.tsx'
import { Note, PageHeader, Panel } from '../components/ui.tsx'
import { useDialog } from '../components/Dialog.tsx'
import { DestinationPicker } from '../components/DestinationPicker.tsx'
import { editAffectedMonths, reopenedConfirmationMonths, type StShape } from './rekapst/reopen.ts'
import { ParticipantPicker, type EmployeeOption, type ExternalEntry } from './rekapst/ParticipantPicker.tsx'
import { AttachmentField, AttachmentLinks } from './rekapst/Attachments.tsx'
import './rekapst/rekapst.css'

type RekapRecord = StRecord
type SourceInfo = { office: string; id: string; coverage: { start: string; end: string; status: string; basis: string; at: string }[] }
type RekapResponse = { revision: number; records: RekapRecord[]; sourceIds: SourceInfo[]; attachments: StAttachmentMeta[] }
type GroupResponse = { revision: number; records: RekapRecord[]; attachments: StAttachmentMeta[] }
type HrActions = ReturnType<typeof useHr>
type Editing = { groupId: string; registerOffice: string; original: StShape; originalRows: number }

const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7)
const idDate = (value: string) => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Belum diisi'
const MAX_DAYS = 31
const shortDate = (value: string) => new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
const dateRange = (start: string, end: string) => start === end ? idDate(start) : `${idDate(start)} – ${idDate(end)}`
const personKey = (record: Pick<RekapRecord, 'external' | 'employeeId' | 'nip' | 'name'>) => record.external ? `ext:${record.name.trim().toLocaleLowerCase('id-ID')}` : `emp:${record.employeeId || record.nip || record.name}`
type StPerson = { key: string; name: string; nip: string; external: boolean; note: string; rows: number; active: number }
type StGroup = { key: string; letterNo: string; letterDate: string; registerOffice: string; destination: string; catatan: string; cancelReason: string; records: RekapRecord[]; people: StPerson[]; start: string; end: string; active: number; attachments: StAttachmentMeta[] }
const groupRecords = (records: RekapRecord[], attachments: StAttachmentMeta[]): StGroup[] => {
  const map = new Map<string, StGroup>()
  for (const record of records) {
    let group = map.get(record.groupId)
    if (!group) { group = { key: record.groupId, letterNo: record.letterNo, letterDate: record.letterDate, registerOffice: record.registerOffice, destination: record.destination, catatan: record.catatan, cancelReason: '', records: [], people: [], start: record.activityDate, end: record.activityDate, active: 0, attachments: attachments.filter(item => item.groupId === record.groupId) }; map.set(record.groupId, group) }
    group.records.push(record)
    if (record.activityDate < group.start) group.start = record.activityDate
    if (record.activityDate > group.end) group.end = record.activityDate
    if (record.status === 'active') group.active++
    else if (record.status === 'excluded' && !group.cancelReason) group.cancelReason = record.cancelReason
    const key = personKey(record)
    let person = group.people.find(item => item.key === key)
    if (!person) { person = { key, name: record.name, nip: record.nip, external: record.external, note: record.note, rows: 0, active: 0 }; group.people.push(person) }
    person.rows++
    if (record.status === 'active') person.active++
  }
  return [...map.values()].sort((a, b) => b.start.localeCompare(a.start) || a.letterNo.localeCompare(b.letterNo, 'id'))
}
const stateLabel: Record<string, string> = { active: 'Aktif', excluded: 'Dibatalkan', superseded: 'Digantikan', 'not-selected': 'Tidak dipilih' }
const uploadAttachments = async (groupId: string, files: File[]) => {
  const failed: string[] = []
  for (const file of files) {
    try { const form = new FormData(); form.append('file', file); await api(`/rekap-st/groups/${encodeURIComponent(groupId)}/attachments`, { method: 'POST', body: form }) }
    catch (e) { failed.push(`${file.name} (${(e as Error).message})`) }
  }
  return failed
}

export function RekapSTPage({ toast, office }: { toast: (message: string) => void; office?: string }) {
  const hr = useHr(), { user } = useAuth()
  return <RekapSTContent user={user} hr={hr} toast={toast} initialOffice={office && OFFICES.includes(office) ? office : undefined} initialDate={hr.weekSlice.displayStart} />
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
  const [data, setData] = useState<RekapResponse>({ revision: hr?.revision ?? 0, records: [], sourceIds: [], attachments: [] })
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [employeeIds, setEmployeeIds] = useState<string[]>([])
  const [externals, setExternals] = useState<ExternalEntry[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [letterNo, setLetterNo] = useState('')
  const [letterDate, setLetterDate] = useState('')
  const [startDate, setStartDate] = useState(`${period}-01`)
  const [endDate, setEndDate] = useState('')
  const [destination, setDestination] = useState('')
  const [catatan, setCatatan] = useState('')
  const [reason, setReason] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [existingFiles, setExistingFiles] = useState<StAttachmentMeta[]>([])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [formEpoch, setFormEpoch] = useState(0) // naik setiap formulir direset agar keadaan lokal pemilih dan lampiran ikut bersih
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [coverageError, setCoverageError] = useState('')
  const dialog = useDialog()
  const formRef = useRef<HTMLDivElement>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const canAdd = user.role === 'superadmin' || user.role === 'operator_st'
  const effectiveEnd = endDate || startDate
  const dateError = !startDate ? '' : effectiveEnd < startDate ? 'Tanggal tugas selesai tidak boleh sebelum tanggal mulai.' : eachDay(startDate, effectiveEnd).length > MAX_DAYS ? `Rentang tanggal tugas maksimal ${MAX_DAYS} hari.` : ''
  const dayList = useMemo(() => startDate && !dateError ? eachDay(startDate, effectiveEnd) : [], [startDate, effectiveEnd, dateError])
  const groups = useMemo(() => groupRecords(data.records, data.attachments), [data.records, data.attachments])
  const officeForQuery = user.role === 'operator_st' ? user.offices?.[0] : filterOffice
  const participantTotal = employeeIds.length + externals.length

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

  // Peserta boleh dari kantor mana pun: seluruh master dimuat sekali, penyaringan kantor dilakukan di pemilih.
  useEffect(() => {
    if (!canAdd) return
    let active = true
    api<{ employees: EmployeeOption[] }>('/rekap-st/employees')
      .then(response => { if (active) setEmployees(response.employees) })
      .catch(e => { if (active) setError((e as Error).message) })
    return () => { active = false }
  }, [canAdd])

  useEffect(() => {
    if (hr) setPeriod(hr.activePeriod)
  }, [hr?.activePeriod])

  useEffect(() => {
    if (editing) return
    setStartDate(initialDate?.slice(0, 7) === period ? initialDate : `${period}-01`); setEndDate('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, initialDate])

  const bounds = monthBounds(period)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const canConfirmCoverage = !!hr && user.role === 'superadmin' && bounds.end <= today
  // Konfirmasi kelengkapan ST berlaku untuk seluruh KPPU (Pusat dan Kanwil I sampai VII), bukan per kantor.
  const stFiles = (hr?.files ?? []).filter(file => file.kind === 'surat-tugas' && file.active !== false && file.period?.start.slice(0, 7) === period)
  const manualActive = stFiles.filter(file => file.id.startsWith('manual-st:') && file.assignments.some(row => sourceRecordState(file, 'assignment', row.id) === 'active'))
  const hasManualSt = manualActive.length > 0
  const hostSource = manualActive.find(file => file.office === 'Pusat') ?? manualActive[0]
  const hasOtherSt = (hr?.files ?? []).some(file => file.kind === 'surat-tugas' && file.active !== false && !file.id.startsWith('manual-st:') && file.assignments.some(item => overlapsMonth(item.start, item.end, period)))
  const coverageState = hr ? inspectSourceCoverage(hr.files, bounds.start, bounds.end).find(item => item.source === 'surat-tugas')?.state ?? 'missing' : 'missing'
  /** Server membuka kembali konfirmasi (lengkap atau nihil) bulan itu untuk seluruh KPPU saat ST dari kantor mana pun ditambahkan atau dikoreksi, jadi peringatan memakai syarat yang sama. */
  const reopenedMonths = (months: string[]) => reopenedConfirmationMonths(hr
    ? hr.files
    : data.sourceIds.map(source => ({ kind: 'surat-tugas', coverageDeclarations: source.coverage })), hr ? months : months.filter(month => month === period))

  const currentShape = (): StShape => ({ letterNo, letterDate, destination, keys: [...employeeIds.map(id => `emp:${id}`), ...externals.map(item => `ext:${item.name.trim().toLocaleLowerCase('id-ID')}`)], dates: dayList })
  const resetForm = () => {
    setLetterNo(''); setLetterDate(''); setEmployeeIds([]); setExternals([]); setEndDate(''); setDestination(''); setCatatan(''); setReason('')
    setPendingFiles([]); setExistingFiles([]); setEditing(null); setFormEpoch(epoch => epoch + 1)
    setStartDate(initialDate?.slice(0, 7) === period ? initialDate : `${period}-01`)
  }

  const startEdit = async (group: StGroup) => {
    setBusy(true); setError(''); setMessage('')
    try {
      // Muat seluruh baris ST (semua bulan) agar ST lintas bulan tidak terpotong saat dikoreksi.
      const full = await api<GroupResponse>(`/rekap-st/groups/${encodeURIComponent(group.key)}`)
      const active = full.records.filter(record => record.status === 'active')
      if (!active.length) { setError('ST ini sudah dibatalkan dan tidak dapat diubah.'); return }
      const first = active[0], dates = active.map(record => record.activityDate).sort()
      const ids = [...new Set(active.filter(record => !record.external).map(record => record.employeeId))]
      const externalPeople = [...new Map(active.filter(record => record.external).map(record => [record.name.trim().toLocaleLowerCase('id-ID'), { name: record.name, note: record.note || undefined } as ExternalEntry])).values()]
      // Pegawai yang tidak lagi ada di master tetap tampil agar bisa dilepas, bukan hilang diam-diam.
      setEmployees(current => [...current, ...active.filter(record => !record.external && record.employeeId && !current.some(item => item.id === record.employeeId)).map(record => ({ id: record.employeeId, nama: record.name, nip: record.nip, kantor: 'Kantor -', unit: '' }))])
      setLetterNo(first.letterNo); setLetterDate(first.letterDate); setStartDate(dates[0]); setEndDate(dates[dates.length - 1]); setDestination(first.destination)
      setCatatan(first.catatan); setReason(''); setEmployeeIds(ids); setExternals(externalPeople); setPendingFiles([]); setExistingFiles(full.attachments)
      setRegisterOffice(first.registerOffice)
      setData(current => ({ ...current, revision: full.revision }))
      const original: StShape = { letterNo: first.letterNo, letterDate: first.letterDate, destination: first.destination, keys: [...ids.map(id => `emp:${id}`), ...externalPeople.map(item => `ext:${item.name.trim().toLocaleLowerCase('id-ID')}`)], dates: [...new Set(dates)] }
      setFormEpoch(epoch => epoch + 1)
      setEditing({ groupId: group.key, registerOffice: first.registerOffice, original, originalRows: active.length })
      requestAnimationFrame(() => { formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); formRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }) })
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!participantTotal) { setError('Pilih minimal satu peserta dari master, atau tambahkan peserta Lainnya.'); return }
    if (participantTotal > ST_MAX_PARTICIPANTS) { setError(`Maksimal ${ST_MAX_PARTICIPANTS} peserta per ST.`); return }
    if (dateError) { setError(dateError); return }
    const affected = editing ? editAffectedMonths(editing.original, currentShape()) : [...new Set(dayList.map(day => day.slice(0, 7)))]
    const reopen = reopenedMonths(affected)
    const reopenLabel = reopen.map(monthLabel).join(' dan ')
    if (reopen.length && !await dialog.confirm(editing ? {
      title: 'Konfirmasi kelengkapan ST akan dibuka kembali',
      message: `Mengubah ST ini akan membuka kembali konfirmasi kelengkapan ST ${reopenLabel} (seluruh KPPU). UM final bulan ini ditahan sampai dikonfirmasi ulang.`,
      confirmLabel: 'Simpan perubahan dan buka kembali', cancelLabel: 'Jangan simpan',
    } : {
      title: 'Konfirmasi kelengkapan ST akan dibuka kembali',
      message: `Menambah ST akan membuka kembali konfirmasi kelengkapan ST ${reopenLabel} (seluruh KPPU). UM final bulan ini ditahan sampai dikonfirmasi ulang.`,
      confirmLabel: 'Tambah ST dan buka kembali', cancelLabel: 'Jangan tambah',
    })) return
    setBusy(true); setError(''); setMessage('')
    const payload = { expectedRevision: data.revision, letterNo, letterDate, employeeIds, externalParticipants: externals.map(item => ({ name: item.name, ...(item.note ? { note: item.note } : {}) })), startDate, endDate: effectiveEnd, destination, catatan }
    try {
      let groupId: string, summary: string
      const reopenNote = reopen.length ? ` Konfirmasi kelengkapan ST ${reopenLabel} (seluruh KPPU) dibuka kembali; konfirmasi ulang agar UM final.` : ''
      if (editing) {
        const result = await api<{ unchanged: boolean; created: number; removed: number; kept: number; revision: number }>(`/rekap-st/groups/${encodeURIComponent(editing.groupId)}`, { method: 'PUT', body: JSON.stringify({ ...payload, ...(reason.trim() ? { reason: reason.trim() } : {}) }) })
        groupId = editing.groupId
        setData(current => ({ ...current, revision: result.revision }))
        summary = result.unchanged ? `ST ${letterNo} tidak berubah.` : `ST ${letterNo} dikoreksi: ${result.created} baris ditambah, ${result.removed} dihapus, ${result.kept} dipertahankan.${reopenNote}`
      } else {
        const result = await api<{ created: number; skipped: number; revision: number; groupId: string }>('/rekap-st', { method: 'POST', body: JSON.stringify({ ...payload, registerOffice }) })
        groupId = result.groupId
        setData(current => ({ ...current, revision: result.revision }))
        summary = `Rekap ST ${letterNo} tersimpan: ${result.created} baris dibuat${result.skipped ? `, ${result.skipped} baris sudah ada dan dilewati` : ''}.${reopenNote}`
      }
      const failed = pendingFiles.length ? await uploadAttachments(groupId, pendingFiles) : []
      if (failed.length) summary += ` Lampiran gagal diunggah: ${failed.join('; ')}. Buka Ubah pada ST ini untuk mencoba lagi.`
      else if (pendingFiles.length) summary += ` ${pendingFiles.length} lampiran terunggah.`
      setMessage(summary); toast?.(summary.slice(0, 140))
      resetForm()
      void hr?.reload() // status cakupan dan tombol konfirmasi mengikuti data server tanpa menunggu polling
      try { await loadRecords() }
      catch (e) { setError(`Data tersimpan, tetapi daftar gagal dimuat ulang: ${(e as Error).message}`) }
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const removeExisting = async (item: StAttachmentMeta) => {
    if (!await dialog.confirm({ title: 'Hapus lampiran?', message: `${item.fileName} akan dihapus dari ST ini. Penghapusan tercatat di jejak audit.`, confirmLabel: 'Hapus lampiran', cancelLabel: 'Jangan hapus', tone: 'danger' })) return
    setBusy(true); setError('')
    try {
      await api(`/rekap-st/attachments/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      setExistingFiles(current => current.filter(file => file.id !== item.id))
      setData(current => ({ ...current, attachments: current.attachments.filter(file => file.id !== item.id) }))
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }

  const cancelGroup = async (group: StGroup) => {
    const reasonText = await dialog.prompt({ title: `Batalkan ST ${group.letterNo}?`, message: `Seluruh baris ST ini (${group.people.length} peserta) dibatalkan dan keluar dari rekonsiliasi. Pembatalan tercatat sebagai jejak audit.`, label: 'Alasan pembatalan', minLength: 3, maxLength: 500, placeholder: 'Mis. tugas dialihkan, lihat memo tertanggal ...', confirmLabel: 'Batalkan ST', cancelLabel: 'Jangan batalkan', tone: 'danger' })
    if (!reasonText) return
    setBusy(true); setError('')
    try {
      const result = await api<{ revision: number }>(`/rekap-st/groups/${encodeURIComponent(group.key)}/void`, { method: 'POST', body: JSON.stringify({ expectedRevision: data.revision, reason: reasonText }) })
      setData(current => ({ ...current, revision: result.revision }))
      if (editing?.groupId === group.key) resetForm()
      await loadRecords()
      setMessage(`Rekap ST ${group.letterNo} dibatalkan dengan jejak audit.`)
      toast?.(`Rekap ST ${group.letterNo} dibatalkan`)
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
  const irregular = !!editing && participantTotal > 0 && dayList.length > 0 && editing.originalRows !== participantTotal * dayList.length
  const columns = canAdd ? 10 : 9

  return <div className={operator ? 'st-operator-shell' : 'page'}>
    {operator && <header>{brand}</header>}
    <PageHeader title="Rekap ST" actions={<label className="select-label">Periode<input type="month" lang="id" value={period} onChange={e => e.target.value && setPeriod(e.target.value)} aria-label="Bulan rekap ST" /></label>}>
      {operator ? 'Masukkan surat tugas dari kantor cakupan Anda. Pesertanya boleh pegawai dari kantor mana pun.' : 'Catat satu surat tugas untuk beberapa peserta dan rentang tanggal. Rekap ini langsung menjadi bukti rekonsiliasi bulan terkait.'}
    </PageHeader>

    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role={toast ? undefined : 'status'} className="st-success">{message}</p>}

    {canAdd && <div ref={formRef}><Panel title={editing ? `Ubah rekap surat tugas ${editing.original.letterNo}` : 'Tambah rekap surat tugas'} sub={editing ? 'Perubahan dicatat sebagai koreksi dengan jejak audit sebelum dan sesudah.' : 'Satu ST: satu nomor, satu rentang tanggal, beberapa peserta.'}>
      {!employees.length && <Note tone="warn">Belum ada pegawai di master. Minta Superadmin melengkapi master pegawai, atau tambahkan peserta Lainnya.</Note>}
      {editing && <Note>Peserta, tanggal, atau tujuan yang diubah akan memperbarui baris ST. Kantor register ({editing.registerOffice}) tidak dapat diubah; batalkan ST lalu buat baru bila register salah.</Note>}
      <form onSubmit={submit}>
        <div className="st-entry-grid">
          {user.role === 'superadmin' && <label>Kantor register ST<select required aria-describedby="st-office-hint" disabled={!!editing} value={registerOffice} onChange={e => setRegisterOffice(e.target.value)}>{OFFICES.map(office => <option key={office}>{office}</option>)}</select></label>}
          <label>No. ST<input required maxLength={100} value={letterNo} onChange={e => setLetterNo(e.target.value)} placeholder="256/" /></label>
          <label>Tanggal ST<input type="date" lang="id" required value={letterDate} onChange={e => setLetterDate(e.target.value)} /></label>
          <label>Tanggal tugas mulai<input type="date" lang="id" required value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
          <label>Tanggal tugas selesai<input type="date" lang="id" required min={startDate} value={effectiveEnd} onChange={e => setEndDate(e.target.value)} /></label>
          <div className="st-destination-field"><label htmlFor="st-destination">Tujuan</label><DestinationPicker id="st-destination" value={destination} onChange={setDestination} required /></div>
          <label className="st-catatan-field">Catatan (opsional)<textarea rows={2} maxLength={ST_CATATAN_MAX} value={catatan} onChange={e => setCatatan(e.target.value)} placeholder="Mis. ST susulan, daftar peserta pada lampiran" aria-describedby="st-catatan-count" /><small id="st-catatan-count" className="muted">{catatan.length}/{ST_CATATAN_MAX}</small></label>
        </div>
        {user.role === 'superadmin' && <p id="st-office-hint" className="muted small">Kantor register ST hanya label asal surat. Konfirmasi kelengkapan ST berlaku untuk seluruh KPPU.</p>}
        {dateError && <p role="alert" className="form-error">{dateError}</p>}
        <ParticipantPicker key={`picker-${formEpoch}`} employees={employees} employeeIds={employeeIds} onEmployeeIds={setEmployeeIds} externals={externals} onExternals={setExternals} max={ST_MAX_PARTICIPANTS} onError={setError} />
        {participantTotal > 0 && dayList.length > 0 && <div className="st-summary" role="status">
          <p><strong>{participantTotal} peserta × {dayList.length} hari = {participantTotal * dayList.length} baris</strong></p>
          <p className="muted small">{dayList.length > 8 ? `${dayList.slice(0, 8).map(shortDate).join(', ')}, dan ${dayList.length - 8} hari lain` : dayList.map(shortDate).join(', ')}</p>
          {irregular && <p className="small">Baris ST ini sebelumnya tidak merata. Menyimpan melengkapi setiap peserta untuk seluruh tanggal di atas.</p>}
        </div>}
        <AttachmentField key={`attach-${formEpoch}`} existing={existingFiles} pending={pendingFiles} onPending={setPendingFiles} onRemoveExisting={item => void removeExisting(item)} disabled={busy} />
        {editing && <label className="st-field">Alasan koreksi (opsional)<input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Mis. nomor ST salah ketik" /></label>}
        <div className="st-form-actions"><span className="muted small">Peserta master diambil dari master pegawai. Baris yang sudah ada dilewati.</span>
          <span className="st-tools">{editing && <button type="button" className="btn ghost" disabled={busy} onClick={resetForm}>Batal ubah</button>}
            <button className="btn primary" disabled={busy || !participantTotal || !!dateError}>{busy ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Simpan rekap ST'}</button></span></div>
      </form>
    </Panel></div>}

    {canConfirmCoverage && <Panel title="Kelengkapan ST bulanan (seluruh KPPU)" sub="Satu konfirmasi untuk Pusat dan Kanwil I sampai VII, setelah seluruh rekap ST dicocokkan.">
      <details className="st-how"><summary>Cara kerja</summary><p>Menambah ST tidak otomatis menyatakan rekap lengkap. Tanpa konfirmasi, bulan ini tetap berstatus belum dikonfirmasi di rekonsiliasi. Menambah atau mengubah ST pada register yang sudah dikonfirmasi membuka kembali konfirmasinya.</p></details>
      <div className="st-coverage-row"><div><span>Status cakupan {monthLabel(period)}</span><strong>{coverageState === 'complete' ? 'Lengkap' : coverageState === 'nil' ? 'Nihil' : coverageState === 'partial' ? 'Parsial' : coverageState === 'unconfirmed' ? 'Data ada, belum dikonfirmasi' : 'Belum dikonfirmasi'}</strong></div><button className="btn secondary" disabled={busy || ['complete', 'nil'].includes(coverageState)} onClick={() => void confirmCoverage()}>{['complete', 'nil'].includes(coverageState) ? 'Sudah dikonfirmasi' : hasManualSt ? 'Konfirmasi rekap lengkap' : 'Konfirmasi nihil ST'}</button></div>
      {coverageError && <p role="alert" className="form-error">{coverageError}</p>}
      {hasOtherSt && <p className="muted small">Register ST dari Excel lama terdeteksi; konfirmasikan cakupan file tersebut di halaman Setoran &amp; Review.</p>}
    </Panel>}

    <Panel title={`Daftar rekap · ${period}`} sub={operator ? `Kantor cakupan: ${user.offices?.join(', ') || 'belum ditetapkan'}` : 'Catatan aktif masuk ke rekonsiliasi. Pembatalan dan koreksi tercatat sebagai jejak audit.'}>
      <div className="toolbar">
        {!operator && <label className="select-label">Kantor<select value={filterOffice} onChange={e => setFilterOffice(e.target.value)}><option>Semua</option>{OFFICES.map(office => <option key={office}>{office}</option>)}</select></label>}
        <span className="count-line">{groups.length} ST · {data.records.length} baris</span>
        <button className="btn secondary" disabled={busy} onClick={() => void loadRecords().catch(e => setError((e as Error).message))}>Muat ulang</button>
      </div>
      {!recordsLoaded ? <ListSkeleton rows={5} cols={6} label="Memuat rekap ST…" /> : groups.length ? <div className="table-wrap"><table className="data st-history">
        <thead><tr><th>No. ST</th><th>Tanggal ST</th><th>Peserta</th><th>Tanggal Tugas</th><th>Tujuan</th><th>Catatan</th><th>Lampiran</th><th>Kantor</th><th>Status</th>{canAdd && <th>Aksi</th>}</tr></thead>
        <tbody>{groups.map(group => {
          const open = expanded.has(group.key), first = group.records[0], cancelled = group.active === 0
          const strike = cancelled ? 'st-strike' : undefined
          return [<tr key={group.key} className={cancelled ? 'st-cancelled' : undefined}>
            <td><button type="button" className="st-group-toggle" aria-expanded={open} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next })}>{open ? '▾' : '▸'} <strong className={strike}>{group.letterNo}</strong></button>
              {first.version > 1 && <small>Dikoreksi (versi {first.version})</small>}
              <small>Diinput {idDate(first.createdAt.slice(0, 10))} oleh {first.createdBy}</small>
              {cancelled && <small className="st-cancel-note">Dibatalkan: {group.cancelReason || 'tanpa alasan tercatat'}</small>}</td>
            <td><span className={strike}>{idDate(group.letterDate)}</span></td>
            <td><span className={strike}>{group.people.length} peserta</span><small className={strike}>{group.people.slice(0, 2).map(person => person.name).join(', ')}{group.people.length > 2 ? `, +${group.people.length - 2} lainnya` : ''}</small></td>
            <td><span className={strike}>{dateRange(group.start, group.end)}</span><small>{group.records.length} baris</small></td>
            <td><span className={strike}>{group.destination}</span></td>
            <td className="st-catatan-cell">{group.catatan ? <span className={strike} title={group.catatan}>{group.catatan}</span> : <span className="muted">-</span>}</td>
            <td><AttachmentLinks items={group.attachments} /></td>
            <td>{group.registerOffice}</td>
            <td><span className={`st-record-status ${group.active ? 'active' : 'inactive'}`}>{group.active === group.records.length ? 'Aktif' : group.active ? `${group.active}/${group.records.length} aktif` : 'Dibatalkan'}</span></td>
            {canAdd && <td className="st-actions">{!cancelled && <>
              <button type="button" className="st-icon-btn" disabled={busy} aria-label={`Ubah ST ${group.letterNo}`} title="Ubah ST" onClick={() => void startEdit(group)}><Pencil size={17} aria-hidden /></button>
              <button type="button" className="st-icon-btn danger" disabled={busy} aria-label={`Batalkan ST ${group.letterNo}`} title="Batalkan ST" onClick={() => void cancelGroup(group)}><Trash2 size={17} aria-hidden /></button></>}</td>}
          </tr>,
          open && <tr key={`${group.key}:detail`} className="st-group-detail"><td colSpan={columns}>
            <ul className="st-group-people">{[...group.people].sort((a, b) => a.name.localeCompare(b.name, 'id')).map(person => <li key={person.key}>
              <span>{person.name}</span>
              {person.external ? <span><span className="st-badge">Lainnya</span> {person.note || 'tanpa keterangan'}</span> : <span className="mono">{person.nip || 'NI PPPK tidak tersedia di master'}</span>}
              <span>{person.rows} hari</span>
              <span className={`st-record-status ${person.active ? 'active' : 'inactive'}`}>{person.active ? stateLabel.active : stateLabel.excluded}</span>
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
