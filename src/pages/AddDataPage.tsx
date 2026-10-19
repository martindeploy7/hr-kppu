import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { BriefcaseBusiness, CircleUserRound, Database, Download, FileSpreadsheet, Plus, UploadCloud } from 'lucide-react'
import { useAuth } from '../state/Auth.tsx'
import { useHr } from '../state/HrData.tsx'
import type { Employee } from '../engine/types.ts'
import { OFFICES } from '../engine/ids.ts'
import { downloadWorkbook, readSheets } from '../lib/xlsx.ts'
import { MASTER_COLUMNS as COLUMNS, parseMasterSheets, previewMasterImport, type MasterImport } from '../lib/masterImport.ts'
import { Note, PageHeader, Seg } from '../components/ui.tsx'

export function AddDataPage({ toast }: { toast: (m: string) => void }) {
  const hr = useHr()
  const { user } = useAuth()
  const defaultOffice = user.offices?.[0] ?? 'Pusat'
  const allowedOffices = OFFICES.filter(o => !user.offices?.length || user.offices.includes(o))
  const [tab, setTab] = useState<'bulk' | 'manual'>('bulk')
  const [preview, setPreview] = useState<MasterImport>({ rows: [], notices: [] })
  const [fileName, setFileName] = useState(''), [busy, setBusy] = useState(false), [page, setPage] = useState(0), [confirmed, setConfirmed] = useState(false)
  const plan = useMemo(() => previewMasterImport(preview, hr.roster.employees, allowedOffices), [preview, hr.roster.employees, user.offices])
  useEffect(() => setConfirmed(false), [preview, hr.revision])
  const [form, setForm] = useState<Partial<Employee>>({ kantor: defaultOffice, statusKepegawaian: 'Belum diketahui' })

  const onFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]; if (!file) return
    ev.target.value = ''
    setBusy(true); setPreview({ rows: [], notices: [] }); setFileName(''); setConfirmed(false); setPage(0)
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('Ukuran file melebihi 15 MB')
      setPreview(parseMasterSheets(await readSheets(file))); setFileName(file.name)
      toast(`${file.name} siap diperiksa`)
    } catch (e) { toast((e as Error).message) }
    finally { setBusy(false) }
  }
  const commit = () => {
    if (!confirmed || plan.invalid || !plan.rows.length || hr.saveStatus !== 'saved') return
    try { const r = hr.upsertMaster(plan.rows); setPreview({ rows: [], notices: [] }); setConfirmed(false); toast(`${r.updated} pegawai diperbarui · ${r.added} pegawai baru; periksa status penyimpanan server`) }
    catch (e) { toast((e as Error).message) }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const result = previewMasterImport({ rows: [{ ref: 'Input manual', value: form, errors: [] }], notices: [] }, hr.roster.employees, allowedOffices)
    if (result.invalid) { toast(result.entries[0].errors.join(' · ')); return }
    if (!result.rows.length) { toast('Tidak ada perubahan data'); return }
    try {
      const r = hr.upsertMaster(result.rows); setForm({ kantor: defaultOffice, statusKepegawaian: 'Belum diketahui' })
      toast(r.updated ? 'Perubahan pegawai disiapkan; periksa status penyimpanan' : 'Pegawai baru disiapkan; periksa status penyimpanan')
    } catch (e) { toast((e as Error).message) }
  }
  const template = () => downloadWorkbook('Template_Master_Pegawai_KPPU.xlsx', [
    { name: 'Master Pegawai', rows: [COLUMNS.map(c => c.header), COLUMNS.map(c => c.example)], widths: COLUMNS.map(c => Math.max(14, c.header.length + 2)) },
    { name: 'Petunjuk', rows: [['Kolom', 'Keterangan'], ['NIP', 'Kunci utama pencocokan (18 digit, simpan sebagai teks).'], ['NIKA', 'Dipakai bila NIP belum ada (mis. data mesin Kanwil).'], ['Golongan', 'PNS: III/b dsb. PPPK: I–XVII. Menentukan tarif & PPh uang makan.'], ['Kantor', OFFICES.join(', ')], ['Baris yang NIP/NIKA-nya sudah ada', 'akan MEMPERBARUI data pegawai tersebut, bukan membuat duplikat.']], widths: [34, 80] },
  ])
  const field = (k: keyof Employee, label: string, type = 'text') => <label><span>{label}</span><input type={type} value={String(form[k] ?? '')} onChange={e => setForm({ ...form, [k]: e.target.value })} /></label>

  return <div className="page">
    <PageHeader title="Tambah & lengkapi data pegawai" actions={<Seg label="Mode" value={tab} onChange={setTab} options={[{ value: 'bulk', label: 'Bulk import' }, { value: 'manual', label: 'Input manual' }]} />}>
      Pegawai sudah terbentuk dari sumber absensi. Halaman ini untuk melengkapi field yang tidak ada di absensi (golongan, jabatan, agama, WhatsApp) atau menambah pegawai baru.
    </PageHeader>
    {tab === 'bulk' ? <section className="panel">
      <div className="bulk-top"><div className="upload-icon"><UploadCloud /></div><div><h3>Bulk import master pegawai</h3><p>Excel atau CSV; semua sheet master dikenali. Pencocokan memakai NIP/NIKA. Nama tidak menggabungkan pegawai.</p></div><button className="btn secondary" onClick={template}><Download size={16} /> Download template</button></div>
      <label className="dropzone"><input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={onFile} /><div><FileSpreadsheet size={32} /><strong>{busy ? 'Membaca file…' : 'Pilih file master'}</strong><span>.xlsx, .xls, .csv</span></div></label>
      {preview.rows.length > 0 && <div className="import-preview">
        <div className="preview-head"><div><strong>{fileName} · {plan.entries.length} baris</strong><span>{plan.updated} pegawai diperbarui · {plan.added} pegawai baru · {plan.invalid} baris perlu diperiksa</span></div><button className="btn secondary" onClick={() => setPreview({ rows: [], notices: [] })}>Batalkan preview</button></div>
        {preview.notices.map((notice, i) => <Note key={i}>{notice}</Note>)}
        {plan.invalid > 0 && <Note>{plan.invalid} baris bermasalah. Tidak ada baris disimpan. Perbaiki seluruh masalah di file lalu unggah ulang.</Note>}
        <div className="table-wrap"><table className="data"><thead><tr><th>Sumber</th><th>Nama / NIP / NIKA</th><th>Hasil & perubahan</th></tr></thead>
          <tbody>{plan.entries.slice(page * 20, (page + 1) * 20).map((entry, i) => <tr key={`${page}-${i}`}><td>{entry.ref}</td><td>{entry.value.nama || entry.target || '—'}<div className="mono">{entry.value.nip || 'Tanpa NIP'}</div><div>{entry.value.nika}</div></td><td>
            <span className={`tag ${entry.errors.length ? 'warn' : 'ok'}`}>{entry.action === 'gabung' ? 'digabung dalam batch' : entry.action === 'tetap' ? 'tidak berubah' : entry.action}</span>
            {entry.errors.map((error, j) => <p key={j}>{error}</p>)}
            {entry.changes.length > 0 && <details><summary>{entry.changes.length} field {entry.action === 'baru' ? 'terisi' : 'berubah'}{entry.target ? ` · ${entry.target}` : ''}</summary><ul>{entry.changes.map(change => <li key={change.field}><strong>{change.field}:</strong> {change.before || 'kosong'} → {change.after}</li>)}</ul></details>}
          </td></tr>)}</tbody></table></div>
        <div className="form-actions"><button className="btn secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Sebelumnya</button><span>Halaman {page + 1} / {Math.ceil(plan.entries.length / 20)}</span><button className="btn secondary" disabled={(page + 1) * 20 >= plan.entries.length} onClick={() => setPage(p => p + 1)}>Berikutnya</button></div>
        <label><input type="checkbox" checked={confirmed} disabled={plan.invalid > 0 || !plan.rows.length} onChange={e => setConfirmed(e.target.checked)} /> Saya telah memeriksa perubahan semua baris dan sheet. Field kosong tidak menghapus data lama.</label>
        <div className="form-actions"><span>{plan.rows.length ? `${plan.rows.length} pegawai siap disimpan` : plan.invalid ? 'Perbaiki file sebelum menyimpan' : 'Tidak ada perubahan'}</span><button className="btn primary" disabled={!confirmed || plan.invalid > 0 || !plan.rows.length || hr.saveStatus !== 'saved'} onClick={commit}><Database size={16} /> Simpan ke master</button></div>
      </div>}
      <Note>Data di file Dashboard_Data_Pegawai_KPPU_V3.xlsx adalah contoh sintetis (NIP tidak cocok dengan absensi). Untuk produksi, sumber master idealnya ekspor SIASN/BKN atau sistem kepegawaian internal.</Note>
    </section> : <form className="panel form-card" onSubmit={submit}>
      <div className="form-section"><div className="form-title"><CircleUserRound /><div><h3>Identitas</h3><p>NIP dipakai sebagai kunci; tanggal lahir & jenis kelamin dibaca otomatis dari NIP bila kosong.</p></div></div>
        <div className="form-grid">{field('nama', 'Nama lengkap')}{field('nip', 'NIP (18 digit)')}{field('nika', 'NIKA')}{field('tanggalLahir', 'Tanggal lahir', 'date')}{field('tempatLahir', 'Tempat lahir')}
          <label><span>Agama</span><select value={form.agama ?? ''} onChange={e => setForm({ ...form, agama: e.target.value as Employee['agama'] })}><option value="">—</option>{['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu', 'Lainnya'].map(x => <option key={x}>{x}</option>)}</select></label>
          {field('nomorWhatsApp', 'Nomor WhatsApp')}{field('email', 'Email', 'email')}</div></div>
      <div className="form-section"><div className="form-title"><BriefcaseBusiness /><div><h3>Kepegawaian</h3><p>Golongan menentukan tarif & PPh uang makan.</p></div></div>
        <div className="form-grid">
          <label><span>Kantor</span><select value={form.kantor} onChange={e => setForm({ ...form, kantor: e.target.value })}>{allowedOffices.map(o => <option key={o}>{o}</option>)}</select></label>
          {field('unit', 'Unit')}
          <label><span>Status</span><select value={form.statusKepegawaian} onChange={e => setForm({ ...form, statusKepegawaian: e.target.value as Employee['statusKepegawaian'] })}>{['PPPK', 'PNS', 'Non-ASN', 'Belum diketahui'].map(x => <option key={x}>{x}</option>)}</select></label>
          {field('golongan', 'Golongan')}{field('jabatan', 'Jabatan')}{field('tanggalMulaiKerja', 'Tanggal mulai kerja', 'date')}</div></div>
      <div className="form-actions"><span>Perubahan disimpan ke server; periksa status penyimpanan.</span><button className="btn primary" type="submit" disabled={hr.saveStatus !== 'saved'}><Plus size={16} /> Simpan pegawai</button></div>
    </form>}
  </div>
}
