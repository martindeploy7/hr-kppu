import { useMemo, useState, type DragEvent } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, FolderUp, Loader2, Trash2, UploadCloud, XCircle } from 'lucide-react'
import { useAuth } from '../state/Auth.tsx'
import { useHr, type ImportResult } from '../state/HrData.tsx'
import type { SourceFile, SourceKind } from '../engine/types.ts'
import { OFFICES, OFFICE_CITY } from '../engine/ids.ts'
import { formatID } from '../engine/dates.ts'
import { fmt } from '../lib/format.ts'
import { Note, PageHeader, Panel } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'
import { SourceRecords } from '../components/SourceRecords.tsx'
import { groupAssignments, importedAssignments, type ImportChange, type ImportImpactResponse, type ImportMode, type ImportProposal, type ImportTarget } from '../../shared/imports.ts'

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
        <div className="file-list">{[...hr.files].sort(sortFiles).map(f => <FileRow key={f.id} file={f} open={open === f.id} onToggle={() => setOpen(open === f.id ? null : f.id)} onRemove={async () => { try { await hr.removeFile(f.id); toast(`${f.fileName} ditarik dari perhitungan; arsip tetap tersimpan`) } catch (e) { toast((e as Error).message) } }} onOffice={async o => { try { await hr.setFileOffice(f.id, o); toast('Kantor sumber diperbarui di server') } catch (e) { toast((e as Error).message) } }} />)}</div>}
    </Panel>

    <Panel title="Format yang dikenali" sub="Dipetakan dari file nyata yang dipakai saat ini. Format baru bisa ditambahkan sebagai parser terpisah.">
      <div className="format-list">{FORMATS.map(f => <div key={f.kind}><FileSpreadsheet size={17} /><div><strong>{f.kind}</strong><small>{f.example}</small><p>{f.detail}</p></div></div>)}</div>
      <Note>Saran untuk tahap berikutnya: seragamkan format ekspor Kanwil (saat ini ada 4 bentuk berbeda) atau tarik langsung dari API mesin & aplikasi, agar langkah unggah ini bisa dijadwalkan otomatis.</Note>
    </Panel>
  </div>
}

const ORDER: SourceKind[] = ['mesin', 'daring', 'matriks-kanwil', 'jadwal-kanwil', 'laporan-kanwil', 'surat-tugas']
const sortFiles = (a: SourceFile, b: SourceFile) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.office.localeCompare(b.office)

function FileRow({ file, open, onToggle, onRemove, onOffice }: { file: SourceFile; open: boolean; onToggle: () => void; onRemove: () => Promise<void>; onOffice: (o: string) => Promise<void> }) {
  const warn = file.warnings.length + (file.quarantined?.length ?? 0)
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const editable = ['admin', 'hr'].includes(user.role)
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
      {editable && <button className="icon-btn" aria-label={`Tarik sumber ${file.fileName}`} disabled={busy} onClick={() => void perform(onRemove)}><Trash2 size={15} /></button>}
    </div>
    {open && <div className="file-detail">
      {warn ? <ul>{file.warnings.map((w, i) => <li key={`warning-${i}`}>{w}</li>)}{file.quarantined?.map((q, i) => <li key={`quarantine-${i}`}>{q.ref}: {q.reason}</li>)}</ul> : <p>Tidak ada anomali format.</p>}
      {file.summaries && <p className="muted">Laporan juga memuat ringkasan per pegawai (Duty/Actual/Absent/Late) yang dipakai sebagai pembanding.</p>}
      <SourceRecords file={file} />
    </div>}
  </article>
}

function ImportPreview({ file, onDone, toast }: { file: SourceFile; onDone: () => void; toast: (s: string) => void }) {
  const hr = useHr()
  const { user } = useAuth()
  const [office, setOffice] = useState(file.office === 'Semua kantor' && user.offices?.length ? user.offices[0] : file.office), [mode, setMode] = useState<ImportMode>('add'), [replaces, setReplaces] = useState(''), [completeThrough, setCompleteThrough] = useState(''), [completeSnapshot, setCompleteSnapshot] = useState(false), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [loadingImpact, setLoadingImpact] = useState(false), [error, setError] = useState(''), [impact, setImpact] = useState<ImportImpactResponse | null>(null), [impactKey, setImpactKey] = useState(''), [confirmedKey, setConfirmedKey] = useState(''), [page, setPage] = useState(0), [selected, setSelected] = useState<Record<string, { included: boolean; targets: ImportTarget[] }>>({})
  const incomingGroups = useMemo(() => groupAssignments(file.assignments.map(a => ({ ...a, office }))), [file, office])
  const existingGroups = useMemo(() => hr.files.filter(f => f.active !== false && f.kind === 'surat-tugas').flatMap(source => groupAssignments(importedAssignments(source).filter(a => a.office === office)).map(group => ({ ...group, sourceId: source.id, fileName: source.fileName, revision: source.revision ?? 1 }))).filter(group => group.replaceable), [hr.files, office])
  const selections = useMemo(() => incomingGroups.flatMap(group => selected[group.key]?.included ? [{ incomingKey: group.key, targets: selected[group.key].targets }] : []), [incomingGroups, selected])
  const proposal = useMemo<ImportProposal>(() => ({ uploadId: file.id, expectedRevision: hr.revision, office, mode, ...(mode === 'replace-file' && replaces ? { replaces } : {}), ...(completeThrough ? { completeThrough } : {}), completeSnapshot, ...(mode === 'replace-registers' ? { selections } : {}), reason, offset: page * 50, limit: 50 }), [file.id, hr.revision, office, mode, replaces, completeThrough, completeSnapshot, selections, reason, page])
  const intentKey = JSON.stringify({ ...proposal, offset: 0, limit: 50 })
  const impactCurrent = !!impact && impactKey === intentKey
  const previous = hr.files.find(f => f.id === replaces)
  const replacingRegisters = mode === 'replace-registers' && selections.some(s => s.targets.length > 0)
  const officeOptions = user.offices?.length ? [...new Set([file.office, ...user.offices])] : [...new Set([file.office, ...OFFICES])]
  const requestImpact = async (offset = 0) => {
    if (mode === 'replace-registers' && !selections.length) return
    setLoadingImpact(true); setError('')
    try {
      const result = await hr.previewImport({ ...proposal, offset, limit: 50 })
      setImpact(result); setImpactKey(intentKey); setConfirmedKey(''); setPage(Math.floor(offset / 50))
    } catch (e) { setError((e as Error).message); setImpact(null); setImpactKey('') }
    finally { setLoadingImpact(false) }
  }
  const commit = async () => {
    if (!impactCurrent || confirmedKey !== intentKey || !impact) return
    setBusy(true); setError('')
    try { await hr.commitImport({ ...proposal, offset: 0, limit: 50 }, impact.checksum); toast('Sumber disimpan ke server'); onDone() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const chooseAll = () => { setCompleteSnapshot(false); setSelected(Object.fromEntries(incomingGroups.map(g => [g.key, { included: true, targets: selected[g.key]?.targets ?? [] }]))) }
  const toggleTarget = (incomingKey: string, target: ImportTarget, checked: boolean) => { setCompleteSnapshot(false); setSelected(current => {
    const existing = current[incomingKey] ?? { included: true, targets: [] }, token = `${target.sourceId}|${target.registerKey}`
    const targets = checked ? [...existing.targets.filter(t => `${t.sourceId}|${t.registerKey}` !== token), target] : existing.targets.filter(t => `${t.sourceId}|${t.registerKey}` !== token)
    return { ...current, [incomingKey]: { included: true, targets } }
  }) }
  const changeStatus: Record<ImportChange['status'], string> = { added: 'Tambah', changed: 'Berubah', removed: 'Hapus dari scope', ambiguous: 'Pasangan ambigu', duplicate: 'Duplikat' }
  const sourceValue = (value?: ImportChange['before']) => value ? <>{value.name}<br /><small>{value.office}{value.start ? ` · ${value.start}${value.end !== value.start ? `–${value.end}` : ''}` : ''}</small><br /><small>{value.detail} · {value.ref}</small></> : '—'
  return <Panel title={`Preview: ${file.fileName}`} sub={`${file.label} · ${file.stats.rows} baris · ${file.stats.people} nama · ${file.quarantined?.length ?? 0} karantina`}>
    <p>{file.period ? `${file.period.start} — ${file.period.end}` : 'Periode tidak ditemukan'} · Parser {file.parserVersion} · SHA-256 {file.hash?.slice(0, 12)}</p>
    <div className="import-preview-fields">
      <label>Kantor sumber<select value={office} onChange={e => { setOffice(e.target.value); setReplaces(''); setSelected({}); setCompleteSnapshot(false) }}>{officeOptions.map(o => <option key={o}>{o}</option>)}</select></label>
      <label>Perlakuan data<select value={mode} onChange={e => { setMode(e.target.value as ImportMode); setConfirmedKey(''); setCompleteSnapshot(false); setPage(0) }}><option value="add">Tambahkan seluruh sumber</option><option value="replace-file">Ganti seluruh dataset</option>{file.kind === 'surat-tugas' && <option value="replace-registers">Pilih register ST</option>}</select></label>
      {mode === 'replace-file' && <label>Dataset yang diganti<select value={replaces} onChange={e => { setReplaces(e.target.value); setConfirmedKey(''); setCompleteSnapshot(false) }}><option value="">Pilih dataset lama</option>{hr.files.filter(f => f.active !== false && f.kind === file.kind && f.office === (file.kind === 'daring' ? file.office : office)).map(f => <option key={f.id} value={f.id}>{f.fileName} (revisi {f.revision ?? 1})</option>)}</select></label>}
      <label>Lengkap sampai (hanya jika dikonfirmasi)<input type="date" min={file.period?.start} value={completeThrough} onChange={e => setCompleteThrough(e.target.value)} /></label>
    </div>
    {mode === 'replace-file' && previous && <><Note tone="warn">Seluruh sumber lama ({previous.stats.rows} baris) akan dinonaktifkan. Gunakan ini hanya untuk snapshot lengkap; perubahan parsial tidak boleh menghapus baris yang tidak muncul.</Note><label className="review-confirm"><input type="checkbox" checked={completeSnapshot} onChange={e => setCompleteSnapshot(e.target.checked)} /> Saya memastikan workbook baru merupakan snapshot lengkap untuk seluruh dataset lama yang dipilih.</label></>}
    {mode === 'replace-registers' && <section className="import-registers" aria-label="Pilih register surat tugas">
      <div className="form-actions"><strong>Pilih scope yang akan diimpor</strong><button className="btn secondary" type="button" onClick={chooseAll}>Pilih semua register</button></div>
      <p>Hanya register yang dicentang masuk ke kalkulasi. Nomor dan unit yang tidak terbaca hanya dapat ditambahkan; sistem tidak menebak register lama yang harus diganti.</p>
      {incomingGroups.map(group => <article className="import-register" key={group.key}>
        <label className="review-confirm"><input type="checkbox" checked={!!selected[group.key]?.included} onChange={e => { setCompleteSnapshot(false); setSelected(current => ({ ...current, [group.key]: { included: e.target.checked, targets: current[group.key]?.targets ?? [] } })) }} /> <strong>{group.label}</strong> · {group.assignments.length} peserta</label>
        {selected[group.key]?.included && group.replaceable && <details><summary>Ganti scope lama (opsional)</summary>
          {existingGroups.length ? existingGroups.map(old => <label className="review-confirm" key={`${old.sourceId}|${old.key}`}><input type="checkbox" checked={!!selected[group.key]?.targets.some(t => t.sourceId === old.sourceId && t.registerKey === old.key)} onChange={e => toggleTarget(group.key, { sourceId: old.sourceId, registerKey: old.key }, e.target.checked)} /> Ganti {old.label} · {old.assignments.length} catatan · {old.fileName} (revisi {old.revision})</label>) : <p>Tidak ada register lama yang dapat dipilih; register ini akan ditambahkan.</p>}
        </details>}
        {selected[group.key]?.included && !group.replaceable && <p className="muted">Nomor ST atau unit tidak cukup terbaca untuk memilih scope lama. Data ini hanya dapat ditambahkan atau diganti bersama seluruh dataset.</p>}
      </article>)}
      {!incomingGroups.length && <p className="muted">Tidak ada peserta ST yang dapat dipilih dari workbook ini.</p>}
      {replacingRegisters && <label className="review-confirm"><input type="checkbox" checked={completeSnapshot} onChange={e => setCompleteSnapshot(e.target.checked)} /> Saya memastikan register baru lengkap untuk scope lama yang dipilih; peserta yang hilang memang harus berhenti aktif.</label>}
      {file.master?.length ? <Note tone="warn">Workbook juga memuat {file.master.length} baris master. Mode pilih register tidak mengaktifkan baris master itu; gunakan impor master terpisah bila memang perlu memperbaruinya.</Note> : null}
    </section>}
    <label className="import-reason">Alasan impor / dasar kelengkapan<textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} placeholder="Jelaskan penambahan atau dasar snapshot lengkap, minimal 10 karakter" /></label>
    {file.warnings.length > 0 && <details><summary>{file.warnings.length} catatan parser</summary><ul>{file.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
    {!!file.quarantined?.length && <details><summary>Baris karantina</summary><ul>{file.quarantined.map((q, i) => <li key={i}>{q.ref}: {q.reason}</li>)}</ul></details>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="form-actions"><button className="btn secondary" onClick={onDone} disabled={busy || loadingImpact}>Batalkan</button><button className="btn secondary" onClick={() => void requestImpact(0)} disabled={busy || loadingImpact || office === 'Belum ditentukan' || reason.trim().length < 10 || (mode === 'replace-file' && (!replaces || !completeSnapshot)) || (replacingRegisters && !completeSnapshot) || (mode === 'replace-registers' && !selections.length)}>{loadingImpact ? 'Menghitung diff…' : 'Hitung diff & dampak'}</button></div>
    {loadingImpact && <p role="status">Menghitung perubahan baris dan dampak pada hari yang terpengaruh…</p>}
    {impactCurrent && impact && <section className="import-impact" aria-label="Diff dan dampak impor">
      <h4>Hasil preview terikat revisi {impact.revision}</h4>
      <p>{impact.source.selectedRows} baris dipilih dari {impact.source.parsedRows} baris terurai{impact.source.omittedMasterCount ? ` · ${impact.source.omittedMasterCount} baris master tidak diaktifkan` : ''}. Scope lama yang diganti: {impact.replacedScopes.length}.</p>
      <div className="import-counts">{([['Tambah',impact.counts.added],['Berubah',impact.counts.changed],['Dihapus dari scope',impact.counts.removed],['Ambigu',impact.counts.ambiguous],['Duplikat',impact.counts.duplicate],['Sama',impact.counts.unchanged]] as [string,number][]).map(([label,count]) => <span key={label}><strong>{fmt.format(count)}</strong> {label}</span>)}</div>
      {impact.review.computed ? <Note>Perubahan hari UM: {impact.review.changedDays} hari berubah · {impact.review.newlyHeld} baru ditahan · {impact.review.changedAmounts} nominal berubah · isu terbuka {impact.review.issuesBefore} → {impact.review.issuesAfter} dari {impact.review.touchedDates} tanggal terdampak.</Note> : <Note tone="warn">{impact.review.note}</Note>}
      {impact.registers?.map(r => <p key={r.incomingKey}>{r.label}: {r.selectedRows} peserta; {r.targetCount ? `${r.targetCount} scope register lama diganti` : 'ditambahkan'} · {r.counts.added} tambah, {r.counts.changed} berubah, {r.counts.removed} hilang dari scope, {r.counts.ambiguous} ambigu.</p>)}
      {impact.changes.length > 0 ? <><div className="table-wrap"><table className="data"><thead><tr><th>Perubahan</th><th>Catatan lama</th><th>Catatan baru</th><th>Field berubah</th></tr></thead><tbody>{impact.changes.map((row,i) => <tr key={`${row.kind}-${row.status}-${row.after?.ref ?? row.before?.ref}-${i}`}><td>{changeStatus[row.status]} · {row.kind === 'presensi' ? 'Presensi' : row.kind === 'surat-tugas' ? 'Surat tugas' : 'Master'}{row.status === 'ambiguous' ? ` (${row.countBefore ?? 0} → ${row.countAfter ?? 0})` : ''}</td><td>{sourceValue(row.before)}</td><td>{sourceValue(row.after)}</td><td>{row.changedFields.join(', ') || '—'}</td></tr>)}</tbody></table></div>
        {impact.totalChanges > impact.limit && <div className="form-actions"><button className="btn secondary" disabled={!impact.offset || loadingImpact} onClick={() => void requestImpact(Math.max(0, impact.offset - impact.limit))}>Sebelumnya</button><span>Baris {impact.offset + 1}–{impact.offset + impact.changes.length} dari {impact.totalChanges}</span><button className="btn secondary" disabled={!impact.hasMore || loadingImpact} onClick={() => void requestImpact(impact.offset + impact.limit)}>Berikutnya</button></div>}</> : <p>Tidak ada record baru/berubah/dihapus dalam scope yang dipilih.</p>}
      {impact.review.examples.length > 0 && <details><summary>Contoh hari pegawai yang berubah ({impact.review.examples.length})</summary><div className="table-wrap"><table className="data"><thead><tr><th>Pegawai/tanggal</th><th>Sebelum</th><th>Sesudah</th></tr></thead><tbody>{impact.review.examples.map(day => <tr key={`${day.employeeId}|${day.date}`}><td>{day.name}<br />{day.date}</td><td>{day.before.status} · {day.before.mealState} · {day.before.clockIn}–{day.before.clockOut} · {day.before.issues} isu</td><td>{day.after.status} · {day.after.mealState} · {day.after.clockIn}–{day.after.clockOut} · {day.after.issues} isu</td></tr>)}</tbody></table></div></details>}
      <label className="review-confirm"><input type="checkbox" checked={confirmedKey === intentKey} onChange={e => setConfirmedKey(e.target.checked ? intentKey : '')} /> Saya sudah memeriksa diff, scope penggantian, dan dampak hari UM.</label>
      <button className="btn primary" onClick={() => void commit()} disabled={busy || loadingImpact || !impactCurrent || confirmedKey !== intentKey || hr.saveStatus !== 'saved'}>{busy ? 'Menyimpan…' : 'Konfirmasi impor'}</button>
    </section>}
    {impact && !impactCurrent && <p role="status" className="muted">Pilihan impor berubah. Hitung ulang diff dan dampaknya sebelum konfirmasi.</p>}
  </Panel>
}
