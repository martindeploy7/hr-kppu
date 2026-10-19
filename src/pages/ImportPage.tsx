import { useState, type DragEvent } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, FolderUp, Loader2, Trash2, UploadCloud, XCircle } from 'lucide-react'
import { useAuth } from '../state/Auth.tsx'
import { useHr, type ImportResult } from '../state/HrData.tsx'
import type { SourceFile, SourceKind } from '../engine/types.ts'
import { OFFICES, OFFICE_CITY } from '../engine/ids.ts'
import { formatID } from '../engine/dates.ts'
import { fmt } from '../lib/format.ts'
import { Note, PageHeader, Panel } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'

type Column = { id: string; label: string; kinds: SourceKind[] }
const COLUMNS: Column[] = [
  { id: 'mesin', label: 'Mesin kantor', kinds: ['mesin', 'matriks-kanwil'] },
  { id: 'daring', label: 'Aplikasi HP', kinds: ['daring'] },
  { id: 'rekap', label: 'Rekap manual / laporan', kinds: ['jadwal-kanwil', 'laporan-kanwil'] },
  { id: 'st', label: 'Rekap surat tugas', kinds: ['surat-tugas'] },
]

const FORMATS: { kind: string; example: string; detail: string }[] = [
  { kind: 'Ekspor mesin absensi (baris per hari)', example: 'Data Rekap absensi_pusat.xls · kanwil 2 … .xls', detail: 'Header "Scan Masuk/Scan Pulang" atau "Clock In/Clock Out". Kolom NIK berisi NIP/NIKA, kolom Pengecualian berisi PD, WFA, Sakit, Cuti. Format tanggal M/D/Y dan D/M/Y dikenali otomatis.' },
  { kind: 'Presensi daring KPPU (aplikasi HP)', example: 'Data Rekap Absensi_Online_DariHP.xlsx', detail: 'WFO/WFA, lokasi, koordinat masuk/pulang, status Approved/Reject. Mencakup pegawai pusat dan kanwil.' },
  { kind: 'Data Transaksi Karyawan (matriks Kanwil)', example: 'Data Rekap Absensi _ Kanwil I …xls', detail: 'Nama(No. mesin) × tanggal dengan sel "07:07-18:03". Header tanggal yang hari/bulannya tertukar diperbaiki otomatis.' },
  { kind: 'Jadwal absen manual (per bulan)', example: 'Data Rekap Penomoran ST _ Kanwil V …xlsx', detail: 'Satu sheet per bulan, kolom Ket / Jam masuk / Jam pulang. Kode DINAS, WFA, SAKIT, "Absen Eror".' },
  { kind: 'Daily Attendance Checking Report', example: 'Rekapitulasi Absen_Kanwil VI …xls', detail: 'Hanya kode harian (PD, WF, S, X, …) tanpa jam; sel kosong = Normal sesuai legenda.' },
  { kind: 'Rekap surat tugas sekretaris', example: 'Kesekjenan, Kedeputian, Kanwil I/II/VI', detail: 'Nomor ST, tanggal ST, nama (dipisah koma/baris baru/blok), tanggal kegiatan teks bebas ("31 Ags-2 Sep 2026"), tujuan.' },
]

export function ImportPage({ nav, toast }: { nav: Nav; toast: (m: string) => void }) {
  const hr = useHr()
  const [dateOrder, setDateOrder] = useState<'' | 'DMY' | 'MDY'>('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [results, setResults] = useState<ImportResult[]>([])
  const [previews, setPreviews] = useState<SourceFile[]>([])
  const [open, setOpen] = useState<string | null>(null)

  const handle = async (list: FileList | File[]) => {
    const files = [...list].filter(f => /\.(xlsx?|xls\.dbf\.xls)$/i.test(f.name) || f.name.toLowerCase().endsWith('.xls'))
    if (!files.length) { toast('Pilih file Excel (.xls / .xlsx)'); return }
    setBusy(true)
    const { previews, results: res } = await hr.previewFiles(files, dateOrder || undefined)
    setPreviews(previews.filter(p => !p.duplicate).map(p => p.file))
    setResults(res)
    setBusy(false)
    const ok = res.filter(r => r.ok).length
    toast(`${ok} dari ${res.length} file berhasil dibaca`)
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files) }

  const coverage = (office: string, col: Column) => hr.files.filter(f => col.kinds.includes(f.kind) && (f.office === office || (f.kind === 'daring' && f.evidence.some(e => e.office === office))))
  const employeesByOffice = (office: string) => hr.roster.employees.filter(e => e.kantor === office).length

  return <div className="page">
    <PageHeader kicker="Langkah 1 · Kumpulkan sumber" title="Impor file absensi & surat tugas" actions={hr.files.length > 0 && <button className="btn primary" onClick={() => nav('overview')}>Lihat ringkasan</button>}>
      Unggah ekspor apa adanya dari mesin, aplikasi HP, kantor wilayah, dan sekretaris. Format dikenali otomatis dari isi file, bukan dari nama file. File dibaca di server. Periksa preview sebelum data masuk ke ruang kerja bersama; sumber asli dan riwayat perubahan disimpan.
    </PageHeader>

    <label className="select-label">Format tanggal mesin <select className="select" value={dateOrder} onChange={e => setDateOrder(e.target.value as typeof dateOrder)}><option value="">Deteksi otomatis (tahan jika ambigu)</option><option value="DMY">DD/MM/YYYY</option><option value="MDY">MM/DD/YYYY</option></select></label>
    <label className={`dropzone-lg ${drag ? 'drag' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
      <input type="file" multiple accept=".xls,.xlsx" disabled={busy} onChange={e => { if (e.target.files) void handle(e.target.files); e.target.value = '' }} />
      <div className="dz-icon">{busy ? <Loader2 className="spin" size={26} /> : <FolderUp size={26} />}</div>
      <strong>{busy ? 'Membaca file…' : 'Tarik semua file ke sini, atau klik untuk memilih'}</strong>
      <span>Bisa sekaligus banyak file (.xls / .xlsx). Isi identik dilewati. Penggantian dataset harus dipilih pada preview.</span>
    </label>

    {previews.map(file => <ImportPreview key={file.id} file={file} onDone={() => setPreviews(p => p.filter(f => f.id !== file.id))} toast={toast} />)}
    {results.length > 0 && <div className="import-results">
      {results.map(r => <div key={r.name} className={r.ok ? 'ok' : 'fail'}>{r.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<strong>{r.name}</strong><span>{r.message}</span></div>)}
    </div>}

    <Panel title="Cakupan sumber per kantor" sub="Kantor tanpa mesin atau rekap hanya terpantau dari aplikasi HP: hari tanpa presensi daring tidak bisa dibedakan antara tidak hadir dan tidak tercatat.">
      <div className="table-wrap">
        <table className="coverage">
          <thead><tr><th>Kantor</th>{COLUMNS.map(c => <th key={c.id}>{c.label}</th>)}<th>Pegawai</th></tr></thead>
          <tbody>{OFFICES.map(office => {
            const cells = COLUMNS.map(c => coverage(office, c))
            const onlyHp = cells[1].length > 0 && !cells[0].length && !cells[2].length
            return <tr key={office}>
              <th scope="row"><strong>{office}</strong><small>{OFFICE_CITY[office]}</small></th>
              {cells.map((files, i) => <td key={i} className={files.length ? 'has' : 'gap'}>
                {files.length ? <><CheckCircle2 size={14} /> <span>{COLUMNS[i].id === 'daring' ? `${fmt.format(new Set(files.flatMap(f => f.evidence.filter(e => e.office === office).map(e => e.name))).size)} pengguna` : files.map(f => f.period ? `${formatID(f.period.start, { short: true, year: false })}–${formatID(f.period.end, { short: true })}` : f.fileName).join(', ')}</span></> : <span className="gap-text">Belum ada</span>}
              </td>)}
              <td>{employeesByOffice(office) || '—'}{onlyHp && <span className="cov-flag" title="Hanya dari aplikasi HP">hanya HP</span>}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </Panel>

    <Panel title={`File sumber (${hr.files.length})`} sub="Periksa jenis yang terdeteksi dan kantor asal. Peringatan menjelaskan anomali format yang ditemukan saat membaca.">
      {hr.files.length === 0 ? <p className="muted">Belum ada file. Mulai dengan menarik folder "Rapat Absensi" ke kotak di atas.</p> :
        <div className="file-list">{[...hr.files].sort(sortFiles).map(f => <FileRow key={f.id} file={f} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} onRemove={() => { hr.removeFile(f.id); toast(`${f.fileName} dihapus`) }} onOffice={o => hr.setFileOffice(f.id, o)} />)}</div>}
    </Panel>

    <Panel title="Format yang dikenali" sub="Dipetakan dari file nyata yang dipakai saat ini. Format baru bisa ditambahkan sebagai parser terpisah.">
      <div className="format-list">{FORMATS.map(f => <div key={f.kind}><FileSpreadsheet size={17} /><div><strong>{f.kind}</strong><small>{f.example}</small><p>{f.detail}</p></div></div>)}</div>
      <Note>Saran untuk tahap berikutnya: seragamkan format ekspor Kanwil (saat ini ada 4 bentuk berbeda) atau tarik langsung dari API mesin & aplikasi, agar langkah unggah ini bisa dijadwalkan otomatis.</Note>
    </Panel>
  </div>
}

const ORDER: SourceKind[] = ['mesin', 'daring', 'matriks-kanwil', 'jadwal-kanwil', 'laporan-kanwil', 'surat-tugas']
const sortFiles = (a: SourceFile, b: SourceFile) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.office.localeCompare(b.office)

function FileRow({ file, open, onToggle, onRemove, onOffice }: { file: SourceFile; open: boolean; onToggle: () => void; onRemove: () => void; onOffice: (o: string) => void }) {
  const warn = file.warnings.length + (file.quarantined?.length ?? 0)
  return <article className={`file-row ${open ? 'open' : ''}`}>
    <div className="file-main">
      <div className={`file-kind k-${file.kind}`}><UploadCloud size={16} /></div>
      <div className="file-name"><strong title={file.fileName}>{file.fileName}</strong><span>{file.label}</span></div>
      <div className="file-meta">
        {file.kind === 'daring' ? <span className="pill">Semua kantor</span> :
          <select aria-label={`Kantor asal ${file.fileName}`} value={file.office} onChange={e => onOffice(e.target.value)}>
            {[...(OFFICES.includes(file.office) ? [] : [file.office]), ...OFFICES].map(o => <option key={o}>{o}</option>)}
          </select>}
        <span>{file.period ? `${formatID(file.period.start, { short: true })} – ${formatID(file.period.end, { short: true })}` : '—'}</span>
        <span>{fmt.format(file.stats.rows)} baris · {fmt.format(file.stats.people)} nama</span>
      </div>
      <button className={`warn-toggle ${warn ? 'has' : ''}`} onClick={onToggle} aria-expanded={open}>{warn ? <><AlertTriangle size={14} /> {warn} catatan</> : 'Bersih'} <ChevronDown size={14} /></button>
      <button className="icon-btn" aria-label={`Hapus ${file.fileName}`} onClick={onRemove}><Trash2 size={15} /></button>
    </div>
    {open && <div className="file-detail">
      {warn ? <ul>{file.warnings.map((w, i) => <li key={`warning-${i}`}>{w}</li>)}{file.quarantined?.map((q, i) => <li key={`quarantine-${i}`}>{q.ref}: {q.reason}</li>)}</ul> : <p>Tidak ada anomali format.</p>}
      {file.summaries && <p className="muted">Laporan juga memuat ringkasan per pegawai (Duty/Actual/Absent/Late) yang dipakai sebagai pembanding.</p>}
    </div>}
  </article>
}

function ImportPreview({ file, onDone, toast }: { file: SourceFile; onDone: () => void; toast: (s: string) => void }) {
  const hr = useHr()
  const { user } = useAuth()
  const [office, setOffice] = useState(file.office === 'Semua kantor' && user.offices?.length ? user.offices[0] : file.office), [replaces, setReplaces] = useState(''), [completeThrough, setCompleteThrough] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const previous = hr.files.find(f => f.id === replaces)
  const commit = async () => {
    setBusy(true); setError('')
    try { await hr.commitImport(file, office, replaces || undefined, completeThrough || undefined); toast('Sumber disimpan ke server'); onDone() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <Panel title={`Preview: ${file.fileName}`} sub={`${file.label} · ${file.stats.rows} baris · ${file.stats.people} nama · ${file.quarantined?.length ?? 0} karantina`}>
    <p>{file.period ? `${file.period.start} — ${file.period.end}` : 'Periode tidak ditemukan'} · Parser {file.parserVersion} · SHA-256 {file.hash?.slice(0, 12)}</p>
    <div className="import-preview-fields">
      <label>Kantor sumber<select value={office} onChange={e => { setOffice(e.target.value); setReplaces('') }}>{[...new Set([file.office, ...OFFICES])].map(o => <option key={o}>{o}</option>)}</select></label>
      <label>Perlakuan dataset<select value={replaces} onChange={e => setReplaces(e.target.value)}><option value="">Tambahkan data</option>{hr.files.filter(f => f.kind === file.kind && f.office === office).map(f => <option key={f.id} value={f.id}>Ganti seluruh dataset: {f.fileName} (r{f.revision ?? 1})</option>)}</select></label>
      <label>Lengkap sampai (hanya jika dikonfirmasi)<input type="date" min={file.period?.start} value={completeThrough} onChange={e => setCompleteThrough(e.target.value)} /></label>
    </div>
    {previous && <Note tone="warn">Snapshot lama ({previous.stats.rows} baris) dinonaktifkan seluruhnya; snapshot baru {file.stats.rows} baris. Keputusan yang buktinya berubah perlu ditinjau ulang. Gunakan tambahan untuk file parsial.</Note>}
    {file.warnings.length > 0 && <details><summary>{file.warnings.length} catatan parser</summary><ul>{file.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
    {!!file.quarantined?.length && <details><summary>Baris karantina</summary><ul>{file.quarantined.map((q, i) => <li key={i}>{q.ref}: {q.reason}</li>)}</ul></details>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="form-actions"><button className="btn secondary" onClick={onDone} disabled={busy}>Batalkan</button><button className="btn primary" onClick={commit} disabled={busy || office === 'Belum ditentukan' || hr.saveStatus === 'saving'}>{busy ? 'Menyimpan…' : 'Konfirmasi impor'}</button></div>
  </Panel>
}
