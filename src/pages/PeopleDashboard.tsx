import { useMemo } from 'react'
import { Cake, CalendarDays, Database, Plus, UploadCloud, UsersRound } from 'lucide-react'
import { useHr } from '../state/HrData.tsx'
import type { Employee } from '../engine/types.ts'
import { OFFICES } from '../engine/ids.ts'
import { ageFrom, fmt, nextBirthdayDays, pct } from '../lib/format.ts'
import { Empty } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'

const FIELDS: { key: keyof Employee; label: string; why: string }[] = [
  { key: 'nip', label: 'NIP', why: 'Kunci daftar nominatif' },
  { key: 'golongan', label: 'Golongan', why: 'Tarif & PPh uang makan' },
  { key: 'jabatan', label: 'Jabatan', why: 'Daftar nominatif' },
  { key: 'nomorWhatsApp', label: 'Nomor WhatsApp', why: 'WA blast' },
  { key: 'agama', label: 'Agama', why: 'Ucapan hari raya' },
  { key: 'email', label: 'Email', why: 'Notifikasi resmi' },
  { key: 'tanggalLahir', label: 'Tanggal lahir', why: 'Ucapan ulang tahun' },
]

export function PeopleDashboard({ nav }: { nav: Nav }) {
  const { roster } = useHr()
  const emps = roster.employees
  const stats = useMemo(() => {
    const byOffice = OFFICES.map(o => ({ name: o, value: emps.filter(e => e.kantor === o).length })).filter(x => x.value)
    const unitMap = new Map<string, number>()
    emps.forEach(e => { const u = (e.unit || 'Unit belum diisi').replace(/ - Sekretaris Jenderal$/, ''); unitMap.set(u, (unitMap.get(u) ?? 0) + 1) })
    const units = [...unitMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
    const withAge = emps.filter(e => e.tanggalLahir)
    const ages = [['< 30', 0, 30], ['30–39', 30, 40], ['40–49', 40, 50], ['50+', 50, 200]].map(([name, lo, hi]) => ({ name: name as string, value: withAge.filter(e => { const a = ageFrom(e.tanggalLahir); return a >= (lo as number) && a < (hi as number) }).length }))
    const status = ['PPPK', 'PNS', 'Non-ASN', 'Belum diketahui'].map(s => ({ name: s, value: emps.filter(e => e.statusKepegawaian === s).length })).filter(x => x.value)
    const male = emps.filter(e => e.jenisKelamin === 'Laki-laki').length, female = emps.filter(e => e.jenisKelamin === 'Perempuan').length
    const birthdays = emps.filter(e => e.tanggalLahir).map(e => ({ e, days: nextBirthdayDays(e.tanggalLahir) })).filter(x => x.days <= 30).sort((a, b) => a.days - b.days)
    const completeness = FIELDS.map(f => ({ ...f, filled: emps.filter(e => Boolean(e[f.key])).length }))
    const avgAge = withAge.length ? withAge.reduce((s, e) => s + ageFrom(e.tanggalLahir), 0) / withAge.length : 0
    return { byOffice, units, ages, status, male, female, birthdays, completeness, avgAge, withAge: withAge.length }
  }, [emps])

  if (!emps.length) return <div className="page"><Empty icon={UploadCloud} title="Belum ada data pegawai" action={<div className="row-actions"><button className="btn primary" onClick={() => nav('import')}>Impor file absensi</button><button className="btn secondary" onClick={() => nav('add')}>Tambah data master</button></div>}>Daftar pegawai dibentuk otomatis dari sumber absensi (NIP, nama, unit, kantor), lalu dilengkapi lewat input manual atau bulk import.</Empty></div>

  const maxUnit = Math.max(1, ...stats.units.slice(0, 8).map(u => u.value))
  const maxOffice = Math.max(1, ...stats.byOffice.map(u => u.value))
  const maxAge = Math.max(1, ...stats.ages.map(u => u.value))
  const today = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const dateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' })

  return <div className="dashboard-page">
    <section className="dashboard-hero">
      <div className="dashboard-hero-copy">
        <div className="dashboard-date"><CalendarDays size={15} /><span>{today}</span></div>
        <h2>Ringkasan pegawai KPPU</h2>
        <p>Dibentuk dari {roster.employees.filter(e => e.sources.some(s => s !== 'Master pegawai')).length} identitas di sumber absensi. Jenis kelamin, tanggal lahir, dan status PPPK/PNS dibaca langsung dari struktur NIP.</p>
        <span className="dashboard-data-note"><Database size={14} /> Data riil hasil impor · tersimpan lokal</span>
      </div>
      <div className="dashboard-actions">
        <button className="btn secondary" onClick={() => nav('employees')}><UsersRound size={17} /> Direktori pegawai</button>
        <button className="btn primary" onClick={() => nav('add')}><Plus size={17} /> Lengkapi data</button>
      </div>
    </section>

    <section className="dashboard-summary" aria-label="Ringkasan kepegawaian">
      <div className="summary-metric"><span>Total pegawai</span><strong>{fmt.format(emps.length)}</strong><small>{stats.status.map(s => `${s.value} ${s.name}`).join(' · ')}</small></div>
      <div className="summary-metric"><span>Kantor</span><strong>{stats.byOffice.length}</strong><small>Pusat + {stats.byOffice.filter(o => o.name !== 'Pusat').length} kantor wilayah</small></div>
      <div className="summary-metric"><span>Rata-rata usia</span><strong>{stats.avgAge.toFixed(1)} <small>tahun</small></strong><small>Dari {stats.withAge} tanggal lahir (NIP)</small></div>
      <div className="summary-metric"><span>Laki-laki : Perempuan</span><strong>{pct(stats.male, stats.male + stats.female)} : {pct(stats.female, stats.male + stats.female)}</strong><small>{stats.male} L · {stats.female} P (digit ke-15 NIP)</small></div>
    </section>

    <div className="dashboard-primary-grid">
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><div><h2>Sebaran per unit</h2><p>Unit dari aplikasi presensi; departemen mesin bila unit belum ada</p></div><span>{stats.units.length} unit</span></div>
        <div className="unit-chart">{stats.units.slice(0, 8).map(u => <div className="unit-row" key={u.name}><span className="unit-name" title={u.name}>{u.name}</span><span className="unit-track"><span style={{ width: `${(u.value / maxUnit) * 100}%` }} /></span><span className="unit-value">{u.value}<small> orang</small></span></div>)}</div>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><div><h2>Per kantor</h2><p>Pusat dan kantor wilayah</p></div></div>
        <div className="unit-chart">{stats.byOffice.map(u => <div className="unit-row" key={u.name}><span className="unit-name">{u.name}</span><span className="unit-track"><span style={{ width: `${(u.value / maxOffice) * 100}%` }} /></span><span className="unit-value">{u.value}</span></div>)}</div>
      </section>
    </div>

    <div className="dashboard-secondary-grid">
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><div><h2>Kelompok usia</h2><p>Dari tanggal lahir di NIP</p></div></div>
        <div className="tenure-chart">{stats.ages.map(a => <div className="tenure-column" key={a.name}><strong>{a.value}</strong><div className="tenure-track"><span style={{ height: `${Math.max(a.value ? 6 : 0, (a.value / maxAge) * 100)}%` }} /></div><span>{a.name}</span></div>)}</div>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><div><h2>Kelengkapan data</h2><p>Yang dibutuhkan fitur lain</p></div></div>
        <div className="discipline-list">{stats.completeness.map(f => <div className="discipline-row" key={f.key}>
          <div className="discipline-label"><span>{f.label} <small className="muted">· {f.why}</small></span><strong>{pct(f.filled, emps.length)}%</strong></div>
          <div className="discipline-track"><span style={{ width: `${pct(f.filled, emps.length)}%` }} /></div>
        </div>)}</div>
      </section>
      <section className="dashboard-panel birthday-panel">
        <div className="dashboard-panel-heading"><div><h2>Ulang tahun terdekat</h2><p>30 hari ke depan · {stats.birthdays.length} pegawai</p></div><button className="panel-link" onClick={() => nav('automation')}>Atur pesan</button></div>
        {stats.birthdays.length ? <div className="birthday-list">{stats.birthdays.slice(0, 5).map(({ e, days }) => {
          const [, m, d] = e.tanggalLahir.split('-').map(Number)
          const date = new Date(2000, m - 1, d)
          return <button className="birthday-row" key={e.id} onClick={() => nav('employees', e.id)}>
            <span className="birthday-date"><strong>{d}</strong><small>{dateFmt.format(date).split(' ')[1]}</small></span>
            <span className="birthday-person"><strong>{e.nama}</strong><small>{e.unit.replace(/ - Sekretaris Jenderal$/, '') || e.kantor}</small></span>
            <span className="birthday-countdown">{days === 0 ? 'Hari ini' : days === 1 ? 'Besok' : `${days} hari lagi`}</span>
          </button>
        })}</div> : <div className="birthday-empty"><Cake size={19} /><p>Tidak ada ulang tahun dalam 30 hari.</p></div>}
      </section>
    </div>
  </div>
}
