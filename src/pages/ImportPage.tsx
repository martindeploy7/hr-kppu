import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, FileSpreadsheet, Globe2, Loader2, Printer, ScrollText, Trash2, UploadCloud, XCircle } from 'lucide-react'
import { useAuth } from '../state/Auth.tsx'
import { useHr, type ImportResult } from '../state/HrData.tsx'
import type { SourceFile, SourceKind } from '../engine/types.ts'
import { OFFICES } from '../engine/ids.ts'
import { formatID, weekRange } from '../engine/dates.ts'
import { coverageSource, inspectSourceCoverage, type CoverageSource } from '../engine/monthlyFlow.ts'
import { fmt } from '../lib/format.ts'
import { Note } from '../components/ui.tsx'
import { useDialog } from '../components/Dialog.tsx'
import type { Nav } from '../App.tsx'
import { SourceRecords } from '../components/SourceRecords.tsx'
import type { ImportProposal } from '../../shared/imports.ts'
import './setoran.css'

const FORMATS: { kind: string; example: string; detail: string }[] = [
  { kind: 'Ekspor mesin absensi (baris per hari)', example: 'Data Rekap absensi_pusat.xls · kanwil 2 … .xls', detail: 'Header Scan Masuk/Scan Pulang atau Clock In/Clock Out. Jadwal, scan aktual, durasi sumber, pengecualian, ID mesin, dan unit disimpan terpisah. Format KPPU DD/MM dikenali dari header; tanggal ambigu meminta pilihan.' },
  { kind: 'Mesin Online (aplikasi HP)', example: 'Data Rekap Absensi_Online_DariHP.xlsx', detail: 'WFO/WFA, kantor dan unit per baris, jadwal tidak ditebak dari Min. Durasi, durasi/status sumber, serta Target/Hasil Pekerjaan WFA. Status Approved, Reject, Pending, dan status tidak dikenal tetap dibedakan.' },
  { kind: 'Data Transaksi Karyawan (matriks Kanwil)', example: 'Data Rekap Absensi _ Kanwil I …xls', detail: 'Nama(No. mesin) × tanggal dengan sel "07:07-18:03". Header tanggal yang hari/bulannya tertukar diperbaiki otomatis.' },
  { kind: 'Jadwal absen manual (per bulan)', example: 'Data Rekap Penomoran ST _ Kanwil V …xlsx', detail: 'Satu sheet per bulan, kolom Ket / Jam masuk / Jam pulang. Kode DINAS, WFA, SAKIT, "Absen Eror".' },
  { kind: 'Daily Attendance Checking Report', example: 'Rekapitulasi Absen_Kanwil VI …xls', detail: 'Hanya kode harian (PD, WF, S, X, …) tanpa jam; sel kosong = Normal sesuai legenda.' },
]

const sourceLabels: Record<CoverageSource, string> = { offline: 'Mesin Offline', online: 'Mesin Online', 'surat-tugas': 'Surat Tugas (ST)' }
const coverageLabels: Record<string, string> = { missing: 'Belum diterima', unconfirmed: 'Data ada, cakupan belum dikonfirmasi', partial: 'Parsial', complete: 'Lengkap', nil: 'Nihil terkonfirmasi', 'not-applicable': 'Tidak berlaku' }
const SOURCE_ICON = { offline: Printer, online: Globe2, 'surat-tugas': ScrollText } as const
type UploadContext = { office: string; source: CoverageSource; start: string; end: string }

export type UploadRequest = { source: CoverageSource; nonce: number }

export function ImportPage({ nav, toast, request, clashCount = 0 }: { nav: Nav; toast: (m: string) => void; request?: UploadRequest; clashCount?: number }) {
  const hr = useHr()
  const { user } = useAuth()
  const demoMode = new URLSearchParams(window.location.search).get('demo') === '1'
  const [dateOrder, setDateOrder] = useState<'' | 'DMY' | 'MDY'>('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const uploadDialog = useRef<HTMLDialogElement>(null)
  const previewSection = useRef<HTMLElement>(null)
  const [modalTarget, setModalTarget] = useState<UploadContext>()
  const fileDetails = useRef<HTMLDetailsElement>(null)
  const uploadTarget = useRef<UploadContext | undefined>(undefined)
  const [fileFilter, setFileFilter] = useState<{ office: string; source: CoverageSource }>()
  const [results, setResults] = useState<ImportResult[]>([])
  const [dragSource, setDragSource] = useState<CoverageSource>()
  const dialog = useDialog()
  const [open, setOpen] = useState<string | null>(null)
  const selectedRange = hr.weekScope === 'full' ? weekRange(hr.weekSlice.weekStart) : { start: hr.weekSlice.displayStart, end: hr.weekSlice.displayEnd }
  const offices = user.offices?.length ? user.offices : OFFICES
  const sourceCoverage = useMemo(() => inspectSourceCoverage(hr.files, selectedRange.start, selectedRange.end), [hr.files, selectedRange.start, selectedRange.end])
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const rangeElapsed = selectedRange.end <= today
  const uploadedFiles = hr.files.filter(file => !file.id.startsWith('manual-st:') && (!fileFilter || coverageSource(file.kind) === fileFilter.source && (fileFilter.office === 'Semua kantor' || file.office === fileFilter.office || file.evidence.some(row => row.office === fileFilter.office) || file.assignments.some(row => row.office === fileFilter.office))))

  useEffect(() => {
    if (modalTarget && !uploadDialog.current?.open) uploadDialog.current?.showModal()
  }, [modalTarget])
  useEffect(() => {
    if (results.length) previewSection.current?.scrollIntoView({ block: 'start' })
  }, [results])

  const showSources = (office: string, source: CoverageSource) => {
    setFileFilter({ office, source })
    uploadDialog.current?.close()
    if (fileDetails.current) { fileDetails.current.open = true; fileDetails.current.scrollIntoView({ block: 'start' }) }
  }

  const selectSource = (office: string, source: CoverageSource) => {
    const target = { office, source, ...selectedRange }
    uploadTarget.current = target
    setModalTarget(target)
  }

  useEffect(() => {
    if (request) selectSource('Semua kantor', request.source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce])

  const submitNa = async (source: CoverageSource) => {
    if (!rangeElapsed) { toast('Konfirmasi hanya dapat dibuat untuk tanggal yang sudah berlangsung'); return }
    const nil = source === 'surat-tugas'
    const basis = await dialog.prompt({
      title: nil ? 'Tidak ada ST pekan ini' : `${sourceLabels[source]}: tidak ada data pekan ini`,
      message: `${formatID(selectedRange.start)}–${formatID(selectedRange.end)}. Pernyataan ini dicatat sebagai jejak audit dan menandai sumber sudah beres untuk pekan ini.`,
      label: 'Alasan atau dasar', minLength: 10, placeholder: nil ? 'Mis. register ST Pusat dan Kanwil dicek, tidak ada ST pekan ini.' : 'Mis. mesin tidak beroperasi pekan ini, sesuai surat ...',
      confirmLabel: 'Simpan pernyataan',
    })
    if (!basis) return
    try {
      if (nil) await hr.declareNilSt('Pusat', selectedRange.start, selectedRange.end, basis)
      else await hr.declareNotApplicable('Pusat', source, selectedRange.start, selectedRange.end, basis)
      toast(`${sourceLabels[source]}: tidak ada data pekan ini dicatat`)
    } catch (error) { toast((error as Error).message) }
  }

  const handle = async (list: FileList | File[]) => {
    if (user.role !== 'superadmin' || busy) return
    const target = uploadTarget.current
    const files = [...list].filter(f => /\.(xlsx?|xls\.dbf\.xls)$/i.test(f.name) || f.name.toLowerCase().endsWith('.xls'))
    if (!files.length) { toast('Pilih file Excel (.xls / .xlsx)'); return }
    setBusy(true)
    try {
      const { previews: incoming, results: res } = await hr.previewFiles(files, dateOrder || undefined, true)
      let revision = hr.revision
      for (const incomingFile of incoming) {
        const file = incomingFile.file
        const result = res.find(r => r.name === file.fileName)
        if (!result || incomingFile.duplicate) continue
        try {
          if (!target) throw new Error('Pilih kartu sumber terlebih dahulu.')
          if (coverageSource(file.kind) !== target.source) throw new Error(`File terdeteksi sebagai ${sourceLabels[coverageSource(file.kind)]}. Pilih kartu sumber yang sesuai.`)
          // Setoran mingguan: baris di luar pekan disaring di server; upload menandai sumber ini diterima untuk pekan tsb.
          const coverageEnd = target.end < today ? target.end : today
          const proposal: ImportProposal = {
            uploadId: file.id, expectedRevision: revision, office: 'Semua kantor',
            mode: 'add', resolveUnmappedOffice: false, range: { start: target.start, end: target.end },
            ...(target.start <= today ? { coverage: { start: target.start, end: coverageEnd, status: 'complete' as const, basis: `Setoran mingguan ${sourceLabels[target.source]} seluruh KPPU melalui unggah file ${file.fileName}` } } : {}),
            reason: `Setoran ${sourceLabels[target.source]} seluruh KPPU, ${target.start}–${target.end} melalui kartu mingguan`,
          }
          const impact = await hr.previewImport(proposal)
          await hr.commitImport(proposal, impact.checksum)
          revision++
          const outside = impact.source.parsedRows - impact.counts.added - impact.counts.duplicate
          result.message = `${fmt.format(impact.counts.added)} baris baru tersimpan${impact.counts.duplicate ? `, ${fmt.format(impact.counts.duplicate)} duplikat dilewati` : ''}${outside > 0 ? `; ${fmt.format(outside)} baris di luar pekan tidak dipakai` : ''}. Kantor tiap baris dipetakan otomatis.${file.quarantined?.length ? ` ${file.quarantined.length} baris perlu diperiksa di rincian sumber.` : ''}${impact.coverageNote ? ` ${impact.coverageNote}` : ''}`
        } catch (error) {
          result.ok = false
          result.message = (error as Error).message
        }
      }
      setResults(res)
      toast(`${res.filter(r => r.ok).length} dari ${res.length} file selesai diproses`)

    } catch (error) { toast((error as Error).message) }
    finally { setBusy(false) }
  }

  const declareFileCoverage = async (file: SourceFile, status: 'complete' | 'partial') => {
    if (!rangeElapsed) { toast('Cakupan hanya dapat dikonfirmasi untuk tanggal yang sudah berlangsung'); return }
    const complete = status === 'complete'
    const basis = await dialog.prompt({
      title: complete ? `Konfirmasi cakupan lengkap ${file.fileName}` : `Tandai ${file.fileName} sebagai parsial`,
      message: `${file.office}, ${formatID(selectedRange.start)}–${formatID(selectedRange.end)}.${complete ? ' Untuk ST, pastikan seluruh register yang diwajibkan sudah tercakup.' : ''}`,
      label: complete ? 'Dasar kelengkapan' : 'Dasar status parsial', minLength: 10, placeholder: 'Rujukan dan alasan, minimal 10 karakter',
      confirmLabel: complete ? 'Konfirmasi lengkap' : 'Tandai parsial',
    })
    if (!basis) return
    try { await hr.declareFileCoverage(file.id, selectedRange.start, selectedRange.end, status, basis); toast(`Cakupan ${complete ? 'lengkap' : 'parsial'} dicatat`) }
    catch (error) { toast((error as Error).message) }
  }

  return <div className="page setoran-page">
    <section aria-label="Setoran mingguan" className="office-submissions">
      <div className="week-head">
        <h3>Setoran pekan {formatID(selectedRange.start, { short: true })}–{formatID(selectedRange.end, { short: true })}</h3>
        <p className="setoran-hint">Tiga file untuk seluruh KPPU. Seret file ke kartu atau klik tombolnya.</p>
        <details className="setoran-how"><summary>Cara kerja</summary>
          <p>Kantor tiap baris dipetakan otomatis. File multi-pekan boleh diunggah; hanya tanggal pekan ini yang dipakai.</p>
          <p>Setelah tersimpan, sumber tersebut tercatat sudah disetor untuk pekan ini. Mengunggah ulang file yang sama untuk pekan lain diperbolehkan; baris ganda dilewati.</p>
        </details>
      </div>
      <div className="weekly-upload-cards" role="group" aria-label="Sumber setoran mingguan">
        {(['offline', 'online', 'surat-tugas'] as CoverageSource[]).map(source => {
          const item = sourceCoverage.find(entry => entry.source === source)!
          const label = source === 'offline' ? 'Mesin Offline' : source === 'online' ? 'Mesin Online' : 'Rekap ST'
          const Icon = SOURCE_ICON[source]
          const status = item.ready ? (item.state === 'nil' ? 'Nihil pekan ini' : item.state === 'not-applicable' ? 'Tidak ada data pekan ini' : 'Sudah disetor') : item.state === 'missing' ? (rangeElapsed ? 'Belum disetor' : 'Belum waktunya') : item.state === 'partial' ? `Disetor sebagian${item.declaredThrough ? ` s.d. ${formatID(item.declaredThrough, { short: true })}` : ''}` : 'Data ada, belum dinyatakan disetor'
          const tone = item.ready ? (item.state === 'complete' ? 'ok' : 'info') : item.state === 'missing' ? (rangeElapsed ? 'danger' : 'idle') : 'warn'
          const canUpload = user.role === 'superadmin'
          return <div className={`office-source src-${source} ${item.ready ? 'is-ready' : ''} ${dragSource === source ? 'dragging' : ''}`} key={source}
            onDragOver={e => { if (!canUpload) return; e.preventDefault(); setDragSource(source) }}
            onDragLeave={() => setDragSource(s => s === source ? undefined : s)}
            onDrop={e => {
              e.preventDefault(); setDragSource(undefined)
              if (!canUpload) return
              uploadTarget.current = { office: 'Semua kantor', source, ...selectedRange }
              void handle(e.dataTransfer.files)
            }}>
            <div className="src-head"><span className="src-icon"><Icon size={18} /></span><strong>{label}</strong></div>
            <span className={`tone-chip tone-${tone}`}>{item.ready ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {status}</span>
            <small className="src-meta">{item.files ? `${item.files} file tersimpan` : 'Belum ada file'}</small>
            <button type="button" className="office-source-main" disabled={busy} onClick={() => selectSource('Semua kantor', source)} aria-label={canUpload ? `Unggah ${sourceLabels[source]}` : `Lihat ${sourceLabels[source]}`}>
              <UploadCloud size={15} /> <span className="office-source-action">{canUpload ? item.files ? 'Unggah tambahan / koreksi' : 'Pilih file atau seret ke sini' : 'Lihat sumber'}</span>
            </button>
            <div className="office-source-extra">
              {source === 'surat-tugas' && <button type="button" className="link" onClick={() => nav('rekap-st', 'Pusat')}>Isi ST manual</button>}
              {canUpload && !item.ready && <button type="button" className="link" disabled={busy || !rangeElapsed} onClick={() => void submitNa(source)}>{source === 'surat-tugas' ? 'Tidak ada ST pekan ini' : 'Tidak ada data pekan ini'}</button>}
            </div>
          </div>
        })}
      </div>
      {sourceCoverage.every(item => item.ready)
        ? <Note>Setoran pekan ini lengkap. Lanjutkan ke <button type="button" className="link" onClick={() => nav('reconcile')}>Rekonsiliasi</button> untuk memutuskan clash, lalu periksa <button type="button" className="link" onClick={() => nav('meal')}>Uang Makan</button>.</Note>
        : <Note tone="warn">Uang makan pekan ini final setelah ketiga sumber disetor. Rekonsiliasi sudah bisa dimulai dari data yang masuk.</Note>}
      {!rangeElapsed && <Note tone="warn">Pekan ini masih berjalan. Setoran dicatat sampai hari ini; tanggal setelahnya belum dihitung.</Note>}
    </section>

    <dialog ref={uploadDialog} className="setoran-dialog" aria-labelledby="setoran-dialog-title" onClose={() => setModalTarget(undefined)}>
      {modalTarget && <>
        <h2 id="setoran-dialog-title">{sourceLabels[modalTarget.source]} · seluruh KPPU</h2>
        <p className="setoran-dialog-period">{formatID(modalTarget.start)}–{formatID(modalTarget.end)}</p>
        {user.role === 'superadmin' ? <>
          <p>Pilih file Excel asli dari sumbernya. Hanya tanggal pekan ini yang dipakai; kantor tiap baris dipetakan otomatis.</p>
          <input ref={input} aria-label="Pilih file absensi" hidden type="file" multiple accept=".xls,.xlsx" disabled={busy} onChange={e => {
            const files = [...(e.currentTarget.files ?? [])]
            e.currentTarget.value = ''
            if (files.length) { uploadDialog.current?.close(); void handle(files) }
          }} />
          <button className="btn primary" type="button" autoFocus disabled={busy} onClick={() => input.current?.click()}><UploadCloud size={16} /> Pilih file</button>
          <small>Excel .xls atau .xlsx · Bisa memilih beberapa file</small>
          {demoMode && <p className="setoran-hint">Mode demo memakai contoh sintetis dan menyimpan perubahan di browser. File yang dipilih di sini tidak diunggah ke server.</p>}
        </> : <p role="status">Akun Admin dapat melihat sumber dan melakukan rekonsiliasi. Unggah file hanya tersedia untuk Superadmin.</p>}
        <div className="setoran-dialog-actions">
          <button className="btn secondary" type="button" onClick={() => showSources(modalTarget.office, modalTarget.source)}>Lihat sumber</button>
          <button className="btn secondary" type="button" aria-label="Tutup modal setoran" onClick={() => uploadDialog.current?.close()}>Tutup</button>
        </div>
      </>}
    </dialog>

    {user.role === 'superadmin' && <section ref={previewSection} className="setoran-upload" aria-label="Hasil unggahan setoran">
      {busy && <p role="status"><Loader2 className="spin" size={16} /> Memproses dan menyimpan file…</p>}
      <details className="setoran-options"><summary>Pengaturan format tanggal</summary>
        <label className="select-label">Urutan tanggal dalam file<select className="select" value={dateOrder} onChange={e => setDateOrder(e.target.value as typeof dateOrder)}><option value="">Deteksi otomatis; minta konfirmasi jika ambigu</option><option value="DMY">DD/MM/YYYY</option><option value="MDY">MM/DD/YYYY</option></select></label>
      </details>
      {results.length > 0 && <div className="import-results" aria-live="polite">
        {results.map(r => <div key={r.name} className={r.ok ? 'ok' : 'fail'}>{r.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<strong>{r.name}</strong><span>{r.message}</span></div>)}
      </div>}
      {results.some(r => r.ok) && <div className="upload-cta"><div><strong>Setoran tersimpan.</strong><span>{clashCount ? `${fmt.format(clashCount)} clash menunggu keputusan di pekan ini.` : 'Tidak ada clash menunggu di pekan ini.'}</span></div><button type="button" className="btn primary" onClick={() => nav('reconcile')}>Lanjut ke rekonsiliasi{clashCount ? ` (${fmt.format(clashCount)} clash)` : ''} <ArrowRight size={15} /></button></div>}
    </section>}

    <details ref={fileDetails} className="setoran-details"><summary>File sumber ({uploadedFiles.length}){fileFilter ? ` · ${fileFilter.office} · ${sourceLabels[fileFilter.source]}` : ''}</summary>
      {fileFilter && <button className="btn secondary" onClick={() => setFileFilter(undefined)}>Tampilkan semua sumber</button>}
      {uploadedFiles.length === 0 ? <p className="muted">{fileFilter ? 'Belum ada file untuk sumber ini. Pilih "Tampilkan semua sumber" atau unggah dari kartu sumber di atas.' : user.role === 'superadmin' ? 'Belum ada file sumber. Unggah file absensi dari kartu sumber di atas untuk mulai memeriksa data.' : 'Belum ada file sumber. Menunggu unggahan dari Superadmin.'}</p> :
        <div className="file-list">{[...uploadedFiles].sort(sortFiles).map(f => <FileRow key={f.id} file={f} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} onRemove={async () => { try { await hr.removeFile(f.id); toast(`${f.fileName} ditarik dari perhitungan; arsip tetap tersimpan`) } catch (e) { toast((e as Error).message) } }} onOffice={async o => { try { await hr.setFileOffice(f.id, o); toast('Kantor sumber diperbarui di server') } catch (e) { toast((e as Error).message) } }} onCoverage={status => declareFileCoverage(f, status)} coverageRange={selectedRange} />)}</div>}
    </details>

    <details className="setoran-details">
      <summary>Format file yang dapat dibaca</summary>
      <div className="format-list">{FORMATS.map(f => <div key={f.kind}><FileSpreadsheet size={17} /><div><strong>{f.kind}</strong><small>{f.example}</small><p>{f.detail}</p></div></div>)}</div>
    </details>
  </div>
}

const ORDER: SourceKind[] = ['mesin', 'daring', 'matriks-kanwil', 'jadwal-kanwil', 'laporan-kanwil', 'surat-tugas']
const sortFiles = (a: SourceFile, b: SourceFile) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.office.localeCompare(b.office)

function FileRow({ file, open, onToggle, onRemove, onOffice, onCoverage, coverageRange }: { file: SourceFile; open: boolean; onToggle: () => void; onRemove: () => Promise<void>; onOffice: (o: string) => Promise<void>; onCoverage: (status: 'complete' | 'partial') => Promise<void>; coverageRange: { start: string; end: string } }) {
  const warn = file.warnings.length + (file.quarantined?.length ?? 0)
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const editable = user.role === 'superadmin'
  const perform = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  return <article className={`file-row ${open ? 'open' : ''}`}>
    <div className="file-main">
      <div className={`file-kind k-${file.kind}`}><UploadCloud size={16} /></div>
      <div className="file-name"><strong title={file.fileName}>{file.fileName}</strong><span>{file.label}</span></div>
      <div className="file-meta">
        {file.kind === 'daring' ? <span className="pill">Semua kantor</span> :
          <select aria-label={`Kantor asal ${file.fileName}`} value={file.office} disabled={busy || !editable} onChange={e => void perform(() => onOffice(e.target.value))}>
            {[...(OFFICES.includes(file.office) ? [] : [file.office]), ...OFFICES].map(o => <option key={o}>{o}</option>)}
          </select>}
        <span>{file.period ? `${formatID(file.period.start, { short: true })} – ${formatID(file.period.end, { short: true })}` : '—'}</span>
        <span>{fmt.format(file.stats.rows)} baris · {fmt.format(file.stats.people)} nama</span>
      </div>
      <button className={`warn-toggle ${warn ? 'has' : ''}`} onClick={onToggle} aria-expanded={open}>{warn ? <><AlertTriangle size={14} /> {warn} catatan</> : 'Bersih'} <ChevronDown size={14} /></button>
      {editable && <button className="icon-btn danger" title="Tarik sumber dari perhitungan" aria-label={`Tarik sumber ${file.fileName}`} disabled={busy} onClick={() => void perform(onRemove)}><Trash2 size={15} /></button>}
    </div>
    {open && <div className="file-detail">
      {warn ? <ul>{file.warnings.map((w, i) => <li key={`warning-${i}`}>{w}</li>)}{file.quarantined?.map((q, i) => <li key={`quarantine-${i}`}>{q.ref}: {q.reason}</li>)}</ul> : <p>Tidak ada anomali format.</p>}
      {file.summaries && <p className="muted">Laporan juga memuat ringkasan per pegawai (Duty/Actual/Absent/Late) yang dipakai sebagai pembanding.</p>}
      <section className="file-coverage" aria-label="Deklarasi cakupan sumber">
        <strong>Deklarasi cakupan · {formatID(coverageRange.start, { short: true })}–{formatID(coverageRange.end, { short: true })}</strong>
        {(file.coverageDeclarations ?? []).filter(d => d.start <= coverageRange.end && d.end >= coverageRange.start).map((d, i) => <p key={`${d.start}|${d.end}|${i}`}>{coverageLabels[d.status]} · {formatID(d.start)}–{formatID(d.end)} · {d.basis} · {d.at}</p>)}
        {!(file.coverageDeclarations ?? []).some(d => d.start <= coverageRange.end && d.end >= coverageRange.start) && <p className="muted">Belum ada deklarasi untuk rentang ini.</p>}
        {editable && <div className="form-actions"><button className="btn secondary" disabled={busy} onClick={() => void perform(() => onCoverage('partial'))}>Tandai parsial</button><button className="btn secondary" disabled={busy} onClick={() => void perform(() => onCoverage('complete'))}>Konfirmasi lengkap</button></div>}
      </section>
      <SourceRecords file={file} />
    </div>}
  </article>
}
