import { useState, type ChangeEvent, type FormEvent } from 'react'
import { BriefcaseBusiness, CheckCircle2, CircleUserRound, Database, Download, FileSpreadsheet, Plus, UploadCloud } from 'lucide-react'
import { useAuth } from '../state/Auth.tsx'
import { useHr } from '../state/HrData.tsx'
import type { Employee } from '../engine/types.ts'
import { OFFICES } from '../engine/ids.ts'
import { excelSerialToISO, parseSingleDate } from '../engine/dates.ts'
import { nameKey } from '../engine/names.ts'
import { downloadWorkbook, loadXlsx } from '../lib/xlsx.ts'
import { Note, PageHeader, Seg } from '../components/ui.tsx'

const COLUMNS: { header: string; key: keyof Employee; example: string }[] = [
  { header: 'NIP', key: 'nip', example: '198908242025211126' },
  { header: 'NIKA', key: 'nika', example: '3.24.0404' },
  { header: 'Nama', key: 'nama', example: 'Abbas R' },
  { header: 'Kantor', key: 'kantor', example: 'Pusat' },
  { header: 'Unit', key: 'unit', example: 'Biro Pencegahan' },
  { header: 'Status Kepegawaian', key: 'statusKepegawaian', example: 'PPPK' },
  { header: 'Golongan', key: 'golongan', example: 'IX' },
  { header: 'Jabatan', key: 'jabatan', example: 'Penata Kelola Persaingan Usaha' },
  { header: 'Tanggal Lahir', key: 'tanggalLahir', example: '1989-08-24' },
  { header: 'Tempat Lahir', key: 'tempatLahir', example: 'Jakarta' },
  { header: 'Jenis Kelamin', key: 'jenisKelamin', example: 'Laki-laki' },
  { header: 'Agama', key: 'agama', example: 'Islam' },
  { header: 'Nomor WhatsApp', key: 'nomorWhatsApp', example: '6281200000000' },
  { header: 'Email', key: 'email', example: 'nama@kppu.go.id' },
  { header: 'Pendidikan', key: 'pendidikan', example: 'S1' },
  { header: 'Disiplin Ilmu', key: 'disiplinIlmu', example: 'Hukum' },
  { header: 'Pelatihan', key: 'pelatihan', example: 'Hukum Persaingan Usaha; Investigasi' },
  { header: 'Tanggal Mulai Kerja', key: 'tanggalMulaiKerja', example: '2024-01-02' },
  { header: 'Alamat', key: 'alamat', example: '' },
  { header: 'Nama Kontak Darurat', key: 'namaKontakDarurat', example: '' },
  { header: 'Kontak Darurat', key: 'kontakDarurat', example: '' },
  { header: 'Status Perkawinan', key: 'statusPerkawinan', example: 'Kawin' },
]

const DATE_KEYS: (keyof Employee)[] = ['tanggalLahir', 'tanggalMulaiKerja']
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

function mapRow(r: Record<string, unknown>): Partial<Employee> {
  const lookup = new Map(Object.entries(r).map(([k, v]) => [norm(k), v]))
  const out: Record<string, unknown> = {}
  for (const c of COLUMNS) {
    const v = lookup.get(norm(c.header)) ?? lookup.get(norm(c.key))
    if (v === undefined || v === null || v === '') continue
    if (DATE_KEYS.includes(c.key)) out[c.key] = typeof v === 'number' ? excelSerialToISO(v) : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : parseSingleDate(String(v)) ?? ''
    else if (c.key === 'pelatihan') out[c.key] = String(v).split(/[;,]/).map(x => x.trim()).filter(Boolean)
    else out[c.key] = String(v).trim()
  }
  return out as Partial<Employee>
}

export function AddDataPage({ toast }: { toast: (m: string) => void }) {
  const hr = useHr()
  const { user } = useAuth()
  const defaultOffice = user.offices?.[0] ?? 'Pusat'
  const allowedOffices = OFFICES.filter(o => !user.offices?.length || user.offices.includes(o))
  const [tab, setTab] = useState<'bulk' | 'manual'>('bulk')
  const [preview, setPreview] = useState<Partial<Employee>[]>([])
  const [form, setForm] = useState<Partial<Employee>>({ kantor: defaultOffice, statusKepegawaian: 'Belum diketahui' })

  const matchOf = (row: Partial<Employee>) => hr.roster.employees.find(e => (row.nip && (e.nip === row.nip || e.aliases.some(a => a.kind === 'nip' && a.value === row.nip))) || (row.nika && e.nika === row.nika) || (!row.nip && row.nama && nameKey(e.nama) === nameKey(row.nama)))
  const onFile = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]; if (!file) return
    try {
      const XLSX = await loadXlsx()
      const wb = file.name.endsWith('.csv') ? XLSX.read(await file.text(), { type: 'string' }) : XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true })
      setPreview(rows.map(mapRow).filter(r => r.nama || r.nip))
      toast(`${file.name} dibaca`)
    } catch { toast('File tidak dapat dibaca. Gunakan template.') }
    ev.target.value = ''
  }
  const commit = () => { const r = hr.upsertMaster(preview); setPreview([]); toast(`${r.updated} pegawai diperbarui · ${r.added} pegawai baru`) }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!form.nama) { toast('Nama wajib diisi'); return }
    if (form.nip && !/^\d{18}$/.test(form.nip)) { toast('NIP harus 18 digit'); return }
    const r = hr.upsertMaster([form]); setForm({ kantor: defaultOffice, statusKepegawaian: 'Belum diketahui' })
    toast(r.updated ? 'Data pegawai yang sudah ada diperbarui' : 'Pegawai baru ditambahkan')
  }
  const template = () => downloadWorkbook('Template_Master_Pegawai_KPPU.xlsx', [
    { name: 'Master Pegawai', rows: [COLUMNS.map(c => c.header), COLUMNS.map(c => c.example)], widths: COLUMNS.map(c => Math.max(14, c.header.length + 2)) },
    { name: 'Petunjuk', rows: [['Kolom', 'Keterangan'], ['NIP', 'Kunci utama pencocokan (18 digit, simpan sebagai teks).'], ['NIKA', 'Dipakai bila NIP belum ada (mis. data mesin Kanwil).'], ['Golongan', 'PNS: III/b dsb. PPPK: I–XVII. Menentukan tarif & PPh uang makan.'], ['Kantor', OFFICES.join(', ')], ['Baris yang NIP/NIKA-nya sudah ada', 'akan MEMPERBARUI data pegawai tersebut, bukan membuat duplikat.']], widths: [34, 80] },
  ])
  const field = (k: keyof Employee, label: string, type = 'text') => <label><span>{label}</span><input type={type} value={String(form[k] ?? '')} onChange={e => setForm({ ...form, [k]: e.target.value })} /></label>

  const matched = preview.filter(r => matchOf(r)).length
  return <div className="page">
    <PageHeader title="Tambah & lengkapi data pegawai" actions={<Seg label="Mode" value={tab} onChange={setTab} options={[{ value: 'bulk', label: 'Bulk import' }, { value: 'manual', label: 'Input manual' }]} />}>
      Pegawai sudah terbentuk dari sumber absensi. Halaman ini untuk melengkapi field yang tidak ada di absensi (golongan, jabatan, agama, WhatsApp) atau menambah pegawai baru.
    </PageHeader>
    {tab === 'bulk' ? <section className="panel">
      <div className="bulk-top"><div className="upload-icon"><UploadCloud /></div><div><h3>Bulk import master pegawai</h3><p>Excel atau CSV dengan header sesuai template. Pencocokan memakai NIP → NIKA → nama.</p></div><button className="btn secondary" onClick={template}><Download size={16} /> Download template</button></div>
      <label className="dropzone"><input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} /><div><FileSpreadsheet size={32} /><strong>Pilih file master</strong><span>.xlsx, .xls, .csv</span></div></label>
      {preview.length > 0 && <div className="import-preview">
        <div className="preview-head"><div><strong>Pratinjau {preview.length} baris</strong><span>{matched} cocok dengan pegawai yang ada (akan diperbarui) · {preview.length - matched} pegawai baru</span></div><button className="btn primary" onClick={commit}><Database size={16} /> Simpan ke master</button></div>
        <div className="table-wrap"><table className="data"><thead><tr><th>Nama</th><th>NIP</th><th>Golongan</th><th>Kantor</th><th>Hasil</th></tr></thead>
          <tbody>{preview.slice(0, 8).map((r, i) => { const m = matchOf(r); return <tr key={i}><td>{r.nama}</td><td className="mono">{r.nip}</td><td>{r.golongan}</td><td>{r.kantor}</td><td>{m ? <span className="tag ok"><CheckCircle2 size={11} /> perbarui {m.nama}</span> : <span className="tag">baru</span>}</td></tr> })}</tbody></table></div>
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
      <div className="form-actions"><span>Perubahan disimpan ke server; periksa status penyimpanan.</span><button className="btn primary" type="submit"><Plus size={16} /> Simpan pegawai</button></div>
    </form>}
  </div>
}
