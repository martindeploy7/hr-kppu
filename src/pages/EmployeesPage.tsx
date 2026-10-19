import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ChevronRight, Pencil, Plus, Search, UploadCloud } from 'lucide-react'
import { useAuth } from '../state/Auth.tsx'
import { EmploymentPeriods } from '../components/EmploymentPeriods.tsx'
import { useHr } from '../state/HrData.tsx'
import type { Employee } from '../engine/types.ts'
import { formatID, monthLabel } from '../engine/dates.ts'
import { STATUS_LABEL } from '../engine/reconcile.ts'
import { ageFrom, fmt, initials, money } from '../lib/format.ts'
import { Drawer, Empty, PageHeader, Panel, StatusChip, STATUS_SHORT } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'

const ALIAS_LABEL = { nip: 'NIP', nika: 'NIKA', app: 'ID aplikasi', mesin: 'No. mesin', nama: 'Nama tertulis' }

export function EmployeesPage({ nav, toast, focus }: { nav: Nav; toast: (m: string) => void; focus?: string }) {
  const hr = useHr()
  const [q, setQ] = useState('')
  const [office, setOffice] = useState('Semua')
  const [status, setStatus] = useState('Semua')
  const [selected, setSelected] = useState<string | null>(focus ?? null)
  const [limit, setLimit] = useState(80)
  useEffect(() => { if (focus) setSelected(focus) }, [focus])
  const emps = hr.roster.employees
  const offices = [...new Set(emps.map(e => e.kantor))].sort()
  const rows = useMemo(() => emps.filter(e => (office === 'Semua' || e.kantor === office) && (status === 'Semua' || e.statusKepegawaian === status) &&
    (!q || `${e.nama} ${e.nip} ${e.nika} ${e.unit} ${e.aliases.map(a => a.value).join(' ')}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.nama.localeCompare(b.nama)), [emps, office, status, q])
  const emp = selected ? hr.roster.byId.get(selected) : undefined

  if (!emps.length) return <div className="page"><Empty icon={UploadCloud} title="Belum ada data pegawai" action={<button className="btn primary" onClick={() => nav('import')}>Impor file absensi</button>} /></div>

  return <div className="page">
    <PageHeader title="Direktori pegawai" actions={<button className="btn primary" onClick={() => nav('add')}><Plus size={16} /> Tambah / impor master</button>}>
      Satu profil per orang, menyatukan NIP, NIKA, nomor mesin, dan semua variasi nama yang muncul di sumber. Field bertanda "dari NIP" diturunkan otomatis.
    </PageHeader>
    <Panel>
      <div className="toolbar">
        <label className="search"><Search size={15} /><input placeholder="Cari nama, NIP, NIKA, alias…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <select className="select" value={office} onChange={e => setOffice(e.target.value)} aria-label="Kantor"><option>Semua</option>{offices.map(o => <option key={o}>{o}</option>)}</select>
        <select className="select" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status kepegawaian"><option>Semua</option><option>PPPK</option><option>PNS</option><option>Non-ASN</option><option>Belum diketahui</option></select>
        <span className="count-line">{fmt.format(rows.length)} pegawai</span>
      </div>
      <div className="table-wrap tall"><table className="data clickable">
        <thead><tr><th>Pegawai</th><th>NIP / NIKA</th><th>Kantor & unit</th><th>Status</th><th>Sumber</th><th /></tr></thead>
        <tbody>{rows.slice(0, limit).map(e => <tr key={e.id} onClick={() => setSelected(e.id)} tabIndex={0} onKeyDown={ev => ev.key === 'Enter' && setSelected(e.id)}>
          <td><div className="emp-cell"><span className="mini-avatar">{initials(e.nama)}</span><div><strong>{e.nama}</strong><small>{e.aliases.filter(a => a.kind === 'nama' && a.value.toLowerCase() !== e.nama.toLowerCase()).length ? `juga ditulis: ${[...new Set(e.aliases.filter(a => a.kind === 'nama' && a.value.toLowerCase() !== e.nama.toLowerCase()).map(a => a.value))].slice(0, 2).join(', ')}` : e.jabatan || ''}</small></div></div></td>
          <td className="mono">{e.nip || <span className="warn-text">tanpa NIP</span>}<small>{e.nika || e.aliases.find(a => a.kind === 'app')?.value || ''}</small></td>
          <td>{e.kantor}<small>{e.unit.replace(/ - Sekretaris Jenderal$/, '') || '—'}</small></td>
          <td><span className={`pill st-${e.statusKepegawaian.replace(/\s/g, '-').toLowerCase()}`}>{e.statusKepegawaian}</span></td>
          <td><div className="src-tags">{e.sources.map(s => <span key={s}>{s}</span>)}</div></td>
          <td><ChevronRight size={15} /></td>
        </tr>)}</tbody>
      </table></div>
      {rows.length > limit && <button className="btn secondary more" onClick={() => setLimit(l => l + 120)}>Tampilkan lebih banyak</button>}
    </Panel>
    <AnimatePresence>{emp && <Drawer wide label={`Profil ${emp.nama}`} onClose={() => setSelected(null)}><Profile emp={emp} toast={toast} nav={nav} /></Drawer>}</AnimatePresence>
  </div>
}

function Profile({ emp, toast, nav }: { emp: Employee; toast: (m: string) => void; nav: Nav }) {
  const { user } = useAuth()
  const hr = useHr()
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState({ golongan: emp.golongan, jabatan: emp.jabatan, nip: emp.nip, nomorWhatsApp: emp.nomorWhatsApp, agama: emp.agama, email: emp.email })
  const month = hr.recon.months.find(m => m.employee.id === emp.id)
  const derived = (k: string) => emp.derived.includes(k) ? <em className="derived">dari NIP</em> : null
  const save = () => { hr.updateEmployee(emp.id, form as Partial<Employee>); setEdit(false); toast('Data pegawai diperbarui') }
  const aliases = emp.aliases.reduce<Record<string, typeof emp.aliases>>((acc, a) => { (acc[a.kind] ??= []).push(a); return acc }, {})
  return <>
    <div className="profile-top">
      <span className="profile-avatar">{initials(emp.nama)}</span>
      <div><span className="pill">{emp.statusKepegawaian}</span><h2>{emp.nama}</h2><p>{emp.jabatan || 'Jabatan belum diisi'} · {emp.kantor}</p><small>{emp.unit || 'Unit belum diisi'}</small></div>
      {['admin', 'hr'].includes(user.role) && <button className="btn secondary" onClick={() => setEdit(v => !v)}><Pencil size={14} /> {edit ? 'Batal' : 'Lengkapi'}</button>}
    </div>

    {edit && <div className="edit-grid">
      {([['nip', 'NIP'], ['golongan', 'Golongan (mis. IX atau III/b)'], ['jabatan', 'Jabatan'], ['nomorWhatsApp', 'Nomor WhatsApp'], ['email', 'Email']] as const).map(([k, label]) => <label key={k}><span>{label}</span><input value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} /></label>)}
      <label><span>Agama</span><select value={form.agama} onChange={e => setForm({ ...form, agama: e.target.value as Employee['agama'] })}><option value="">—</option>{['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu', 'Lainnya'].map(x => <option key={x}>{x}</option>)}</select></label>
      <button className="btn primary" onClick={save}>Simpan</button>
    </div>}

    <div className="facts">
      <div><span>NIP</span><strong className="mono">{emp.nip || '—'}</strong></div>
      <div><span>NIKA</span><strong className="mono">{emp.nika || '—'}</strong></div>
      <div><span>Tanggal lahir {derived('tanggalLahir')}</span><strong>{emp.tanggalLahir ? `${formatID(emp.tanggalLahir)} (${ageFrom(emp.tanggalLahir)} th)` : '—'}</strong></div>
      <div><span>Jenis kelamin {derived('jenisKelamin')}</span><strong>{emp.jenisKelamin || '—'}</strong></div>
      <div><span>Status {derived('statusKepegawaian')}</span><strong>{emp.statusKepegawaian}</strong></div>
      <div><span>Golongan</span><strong>{emp.golongan || '—'}</strong></div>
      <div><span>WhatsApp</span><strong>{emp.nomorWhatsApp || '—'}</strong></div>
      <div><span>Agama</span><strong>{emp.agama || '—'}</strong></div>
    </div>

    {month && <section className="profile-block">
      <h3>Kehadiran {monthLabel(hr.activePeriod)}</h3>
      <div className="strip">{month.days.filter(d => d.workday).map(d => <span key={d.date} className={`cell st-${d.status}`} title={`${formatID(d.date)} · ${STATUS_LABEL[d.status]}`}>{STATUS_SHORT[d.status]}</span>)}</div>
      <div className="mini-kpis"><div><span>Hadir</span><strong>{month.present}</strong></div><div><span>Dinas</span><strong>{month.dutyOut}</strong></div><div><span>TK</span><strong>{month.absent}</strong></div><div><span>Terlambat</span><strong>{month.lateDays} hr</strong></div><div><span>Uang makan</span><strong>{money.format(month.netto)}</strong></div></div>
      <div className="row-actions"><button className="link" onClick={() => nav('reconcile', emp.nama)}>Lihat isu pegawai ini ({month.openIssues})</button></div>
    </section>}

    <EmploymentPeriods employee={emp} />
    <section className="profile-block">
      <h3>Identitas di setiap sumber</h3>
      <div className="alias-list">{(Object.keys(ALIAS_LABEL) as (keyof typeof ALIAS_LABEL)[]).filter(k => aliases[k]).map(k => <div key={k}>
        <span>{ALIAS_LABEL[k]}</span>
        <div>{[...new Map(aliases[k].map(a => [a.value.toLowerCase(), a])).values()].map(a => <em key={a.value} title={a.source}>{k === 'mesin' ? a.value.replace(':', ' #') : a.value}<small>{a.source}</small></em>)}</div>
      </div>)}</div>
    </section>

    {month && month.days.some(d => d.status === 'dinas-luar' && d.assignments.length) && <section className="profile-block">
      <h3>Surat tugas periode ini</h3>
      <div className="st-list">{[...new Map(month.days.flatMap(d => d.assignments).map(a => [a.id, a])).values()].map(a => <div key={a.id}><StatusChip status={a.local ? 'dinas-lokal' : 'dinas-luar'} compact /><div><strong>ST {a.letterNo ?? '(tanpa nomor)'}</strong><span>{a.rawDate} → {a.destination ?? '—'}</span><small>{a.unit ?? a.office}</small></div></div>)}</div>
    </section>}

    {(emp.pendidikan || emp.pelatihan.length > 0 || emp.alamat) && <section className="profile-block">
      <h3>Profil lain (master)</h3>
      <div className="facts">
        <div><span>Pendidikan</span><strong>{[emp.pendidikan, emp.disiplinIlmu].filter(Boolean).join(' ') || '—'}</strong></div>
        <div><span>Pelatihan</span><strong>{emp.pelatihan.join(', ') || '—'}</strong></div>
        <div><span>Alamat</span><strong>{emp.alamat || '—'}</strong></div>
        <div><span>Kontak darurat</span><strong>{[emp.namaKontakDarurat, emp.kontakDarurat].filter(Boolean).join(' · ') || '—'}</strong></div>
      </div>
    </section>}
  </>
}
