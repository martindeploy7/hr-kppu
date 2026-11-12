import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Cake, CalendarDays, ChevronRight, Database, Plus, UploadCloud, UsersRound } from 'lucide-react'
import { useHr } from '../state/HrData.tsx'
import type { Employee } from '../engine/types.ts'
import { OFFICES } from '../engine/ids.ts'
import { ageFrom, fmt, initials, nextBirthdayDays, pct } from '../lib/format.ts'
import { formatID } from '../engine/dates.ts'
import { Drawer, Empty } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'

type EmployeeGroup = { name: string; employees: Employee[] }
type SelectedGroup = {
  title: string
  name: string
  description: string
  employees: Employee[]
  meta: (employee: Employee) => string
}
type EmployeeEvent = { employee: Employee; date: string }

const FIELDS: { key: keyof Employee; label: string; why: string }[] = [
  { key: 'nip', label: 'NIP', why: 'Identitas pegawai' },
  { key: 'golongan', label: 'Golongan', why: 'Tarif uang makan' },
  { key: 'jabatan', label: 'Jabatan', why: 'Profil pegawai' },
  { key: 'peringkatJabatan', label: 'Peringkat jabatan', why: 'Pengelompokan jabatan' },
  { key: 'jenisJabatan', label: 'Jenis jabatan', why: 'Klasifikasi jabatan fungsional' },
  { key: 'pendidikan', label: 'Pendidikan', why: 'Profil pegawai' },
  { key: 'tanggalMulaiKerja', label: 'Tanggal mulai kerja', why: 'Pegawai baru' },
  { key: 'tanggalPensiun', label: 'Tanggal pensiun', why: 'Perkiraan pegawai pensiun' },
  { key: 'tanggalPengunduranDiri', label: 'Tanggal pengunduran diri', why: 'Riwayat pegawai keluar' },
  { key: 'nomorWhatsApp', label: 'Nomor WhatsApp', why: 'Pesan pegawai' },
  { key: 'agama', label: 'Agama', why: 'Pesan hari raya' },
  { key: 'email', label: 'Email', why: 'Notifikasi resmi' },
  { key: 'tanggalLahir', label: 'Tanggal lahir', why: 'Kelompok usia' },
]

function groupEmployees(employees: Employee[], value: (employee: Employee) => string): EmployeeGroup[] {
  const groups = new Map<string, EmployeeGroup>()
  for (const employee of employees) {
    const name = value(employee).trim() || 'Belum diisi'
    const key = name.toLocaleLowerCase('id-ID')
    const group = groups.get(key) ?? { name, employees: [] }
    group.employees.push(employee)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.employees.length - a.employees.length || a.name.localeCompare(b.name, 'id'))
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function shiftYear(dateText: string, amount: number) {
  const [year, month, day] = dateText.split('-').map(Number)
  const nextYear = year + amount
  const lastDay = new Date(nextYear, month, 0).getDate()
  return `${nextYear}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

function educationLevel(value: string) {
  const raw = value.trim()
  if (!raw) return 'Pendidikan belum diisi'
  const compact = raw.toLocaleUpperCase('id-ID').replace(/[\s._]/g, '').replace(/STRATA/g, 'S')
  if (/^(S3|DOKTOR|DOKTORAL|PH\.D)/.test(compact)) return 'S3'
  if (/^(S2|MAGISTER|MASTER)/.test(compact)) return 'S2'
  if (/^(S1|SARJANA|BACHELOR)/.test(compact)) return 'S1'
  if (/^(D4|DIV|D-IV|DIPLOMAIV)/.test(compact)) return 'D4 / Sarjana Terapan'
  if (/^(D3|DIII|D-III|DIPLOMAIII)/.test(compact)) return 'D3'
  if (/^(D2|DII|D-II|DIPLOMAII)/.test(compact)) return 'D2'
  if (/^(D1|DI|D-I|DIPLOMAI)/.test(compact)) return 'D1'
  if (/^(SMA|SMK|SLTA|PAKETC|MADRASAHALIYAH)/.test(compact) || compact === 'MA') return 'SMA / sederajat'
  if (/^(SMP|SLTP|MTs)/.test(compact)) return 'SMP / sederajat'
  if (/^(SD|MI)/.test(compact)) return 'SD / sederajat'
  return raw
}

function employeeMeta(employee: Employee) {
  return [employee.jabatan, employee.kantor, employee.unit].filter(Boolean).join(' · ') || employee.statusKepegawaian
}

export function PeopleDashboard({ nav }: { nav: Nav }) {
  const { roster } = useHr()
  const emps = roster.employees
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup | null>(null)
  const focusOrigin = useRef<HTMLElement | null>(null)
  const closeSelectedGroup = () => {
    setSelectedGroup(null)
    requestAnimationFrame(() => focusOrigin.current?.focus())
  }
  useEffect(() => {
    if (!selectedGroup) return
    const focusClose = requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.side-drawer .drawer-x')?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeSelectedGroup()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(focusClose)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedGroup])
  const stats = useMemo(() => {
    const today = localDate(new Date())
    const yearAgo = shiftYear(today, -1)
    const nextYear = shiftYear(today, 1)
    const byOffice = groupEmployees(emps, e => e.kantor || 'Kantor belum diisi').sort((a, b) => {
      const rankA = OFFICES.indexOf(a.name), rankB = OFFICES.indexOf(b.name)
      return (rankA < 0 ? 99 : rankA) - (rankB < 0 ? 99 : rankB) || a.name.localeCompare(b.name, 'id')
    })
    const units = groupEmployees(emps, e => (e.unit || 'Unit belum diisi').replace(/ - Sekretaris Jenderal$/, ''))
    const withAge = emps.filter(e => e.tanggalLahir)
    const ages = [
      { name: '< 30', employees: withAge.filter(e => ageFrom(e.tanggalLahir) < 30) },
      { name: '30–39', employees: withAge.filter(e => ageFrom(e.tanggalLahir) >= 30 && ageFrom(e.tanggalLahir) < 40) },
      { name: '40–49', employees: withAge.filter(e => ageFrom(e.tanggalLahir) >= 40 && ageFrom(e.tanggalLahir) < 50) },
      { name: '50+', employees: withAge.filter(e => ageFrom(e.tanggalLahir) >= 50) },
    ]
    const unknownAge = emps.filter(e => !e.tanggalLahir)
    const education = groupEmployees(emps, e => educationLevel(e.pendidikan))
    const gender = groupEmployees(emps, e => e.jenisKelamin || 'Jenis kelamin belum diisi')
    const rank = groupEmployees(emps, e => e.peringkatJabatan || 'Peringkat jabatan belum diisi')
    const functionalEmployees = emps.filter(e => /^(?:jabatan\s+)?fungsional(?:\b|$)/i.test(e.jenisJabatan?.trim() ?? ''))
    const functional = groupEmployees(functionalEmployees, e => e.jabatan || 'Jabatan belum diisi')
    const unclassifiedJobs = emps.filter(e => !e.jenisJabatan?.trim())
    if (unclassifiedJobs.length) functional.push({ name: 'Jenis jabatan belum diisi', employees: unclassifiedJobs })
    const status = ['PPPK', 'PNS', 'Non-ASN', 'Belum diketahui'].map(name => ({ name, value: emps.filter(e => e.statusKepegawaian === name).length })).filter(group => group.value)
    const male = emps.filter(e => e.jenisKelamin === 'Laki-laki').length
    const female = emps.filter(e => e.jenisKelamin === 'Perempuan').length
    const birthdays = emps.filter(e => e.tanggalLahir).map(e => ({ e, days: nextBirthdayDays(e.tanggalLahir) })).filter(x => x.days <= 30).sort((a, b) => a.days - b.days)
    const completeness = FIELDS.map(field => ({ ...field, filled: emps.filter(e => Boolean(e[field.key])).length }))
    const avgAge = withAge.length ? withAge.reduce((sum, e) => sum + ageFrom(e.tanggalLahir), 0) / withAge.length : 0
    const within = (date: string | undefined, start: string, end: string) => Boolean(date && date >= start && date <= end)
    const pensions: EmployeeEvent[] = emps.filter(e => e.statusPegawai !== 'Nonaktif' && within(e.tanggalPensiun, today, nextYear)).map(employee => ({ employee, date: employee.tanggalPensiun! })).sort((a, b) => a.date.localeCompare(b.date))
    const newHires: EmployeeEvent[] = emps.filter(e => within(e.tanggalMulaiKerja, yearAgo, today)).map(employee => ({ employee, date: employee.tanggalMulaiKerja })).sort((a, b) => b.date.localeCompare(a.date))
    const resignations: EmployeeEvent[] = emps.filter(e => within(e.tanggalPengunduranDiri, yearAgo, today)).map(employee => ({ employee, date: employee.tanggalPengunduranDiri! })).sort((a, b) => b.date.localeCompare(a.date))
    const missingPension = emps.filter(e => e.statusPegawai !== 'Nonaktif' && !e.tanggalPensiun)
    const missingStartDate = emps.filter(e => !e.tanggalMulaiKerja)
    const inactiveWithoutResignationDate = emps.filter(e => e.statusPegawai === 'Nonaktif' && !e.tanggalPengunduranDiri)
    return {
      byOffice, units, ages, unknownAge, education, gender, rank, functional, status, male, female,
      birthdays, completeness, avgAge, withAge: withAge.length, pensions, newHires, resignations,
      missingPension, missingStartDate, inactiveWithoutResignationDate, yearAgo, nextYear,
    }
  }, [emps])

  if (!emps.length) return <div className="page"><Empty icon={UploadCloud} title="Belum ada data pegawai" action={<div className="row-actions"><button className="btn primary" onClick={() => nav('import')}>Impor file absensi</button><button className="btn secondary" onClick={() => nav('add')}>Tambah data master</button></div>}>Daftar pegawai dibentuk dari sumber absensi, lalu dapat dilengkapi melalui input manual atau impor master.</Empty></div>

  const today = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const dateFmt = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' })
  const openGroup = (title: string, group: EmployeeGroup, description = 'Pilih nama pegawai untuk membuka profil lengkap.', meta = employeeMeta) => {
    focusOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelectedGroup({ title, name: group.name, description, employees: group.employees, meta })
  }
  const openEvents = (title: string, employees: Employee[], dateOf: (employee: Employee) => string) => {
    focusOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelectedGroup({
      title, name: `${employees.length} pegawai`, description: 'Pilih nama pegawai untuk membuka profil lengkap.', employees,
      meta: employee => [dateOf(employee), employee.kantor, employee.unit].filter(Boolean).join(' · '),
    })
  }
  const maxAge = Math.max(1, ...stats.ages.map(group => group.employees.length))

  return <div className="dashboard-page">
    <section className="dashboard-hero">
      <div className="dashboard-hero-copy">
        <div className="dashboard-date"><CalendarDays size={15} /><span>{today}</span></div>
        <h2>Ringkasan pegawai KPPU</h2>
        <p>Kelompok dihitung dari master pegawai. Jenis kelamin, tanggal lahir, dan status ASN dapat dilengkapi dari data master atau diturunkan dari NIP.</p>
        <span className="dashboard-data-note"><Database size={14} /> Master pegawai · sumber impor dan pelengkapan admin</span>
      </div>
      <div className="dashboard-actions">
        <button className="btn secondary" onClick={() => nav('employees')}><UsersRound size={17} /> Direktori pegawai</button>
        <button className="btn primary" onClick={() => nav('add')}><Plus size={17} /> Lengkapi data</button>
      </div>
    </section>

    <section className="dashboard-summary" aria-label="Ringkasan kepegawaian">
      <div className="summary-metric"><span>Total pegawai</span><strong>{fmt.format(emps.length)}</strong><small>{stats.status.map(s => `${s.value} ${s.name}`).join(' · ')}</small></div>
      <div className="summary-metric"><span>Kantor</span><strong>{stats.byOffice.length}</strong><small>Pusat + {stats.byOffice.filter(o => o.name !== 'Pusat').length} kantor wilayah</small></div>
      <div className="summary-metric"><span>Rata-rata usia</span><strong>{stats.avgAge.toFixed(1)} <small>tahun</small></strong><small>Dari {stats.withAge} tanggal lahir terisi</small></div>
      <div className="summary-metric"><span>Laki-laki : Perempuan</span><strong>{pct(stats.male, stats.male + stats.female)} : {pct(stats.female, stats.male + stats.female)}</strong><small>{stats.male} L · {stats.female} P dari data terisi</small></div>
    </section>

    <div className="dashboard-primary-grid">
      <DistributionPanel title="Sebaran per unit" description="Unit dari data pegawai. Pilih kelompok untuk melihat anggotanya." groups={stats.units} onSelect={group => openGroup('Sebaran per unit', group)} />
      <DistributionPanel title="Per kantor" description="Pusat dan seluruh kantor wilayah." groups={stats.byOffice} onSelect={group => openGroup('Per kantor', group)} />
    </div>

    <div className="dashboard-secondary-grid">
      <section className="dashboard-panel">
        <div className="dashboard-panel-heading"><div><h2>Kelompok usia</h2><p>Dari tanggal lahir pada master atau NIP</p></div></div>
        <div className="tenure-chart people-age-chart">{stats.ages.map(group => {
          const value = group.employees.length
          return <button type="button" className="tenure-column people-age-button" key={group.name} disabled={!value} aria-label={`Lihat ${value} pegawai usia ${group.name}`} onClick={() => openGroup('Kelompok usia', group, 'Pegawai dalam kelompok usia ini.') }>
            <strong>{value}</strong><span className="tenure-track"><span style={{ height: `${Math.max(value ? 6 : 0, (value / maxAge) * 100)}%` }} /></span><span>{group.name}</span>
          </button>
        })}</div>
        {stats.unknownAge.length > 0 && <button type="button" className="people-missing-row" onClick={() => openGroup('Kelompok usia', { name: 'Tanggal lahir belum diisi', employees: stats.unknownAge }, 'Tanggal lahir belum tersedia pada master pegawai.')}>Tanggal lahir belum diisi <strong>{stats.unknownAge.length} orang</strong></button>}
      </section>
      <section className="dashboard-panel birthday-panel">
        <div className="dashboard-panel-heading"><div><h2>Ulang tahun terdekat</h2><p>30 hari ke depan · {stats.birthdays.length} pegawai</p></div><button className="panel-link" onClick={() => nav('automation')}>Atur pesan</button></div>
        {stats.birthdays.length ? <div className="birthday-list">{stats.birthdays.slice(0, 5).map(({ e, days }) => {
          const [, month, day] = e.tanggalLahir.split('-').map(Number)
          const date = new Date(2000, month - 1, day)
          return <button className="birthday-row" key={e.id} onClick={() => nav('employees', e.id)}>
            <span className="birthday-date"><strong>{day}</strong><small>{dateFmt.format(date).split(' ')[1]}</small></span>
            <span className="birthday-person"><strong>{e.nama}</strong><small>{e.unit.replace(/ - Sekretaris Jenderal$/, '') || e.kantor}</small></span>
            <span className="birthday-countdown">{days === 0 ? 'Hari ini' : days === 1 ? 'Besok' : `${days} hari lagi`}</span>
          </button>
        })}</div> : <div className="birthday-empty"><Cake size={19} /><p>Tidak ada ulang tahun dalam 30 hari.</p></div>}
      </section>
    </div>

    <PeopleCompletenessPanel fields={stats.completeness} employeeCount={emps.length} />

    <section className="people-section">
      <div className="people-section-heading"><h2>Profil pegawai</h2><p>Pendidikan dan jabatan mengikuti isian eksplisit pada master. Pilih kelompok untuk melihat daftar pegawai.</p></div>
      <div className="people-profile-grid">
        <EducationTablePanel groups={stats.education} employeeCount={emps.length} onSelect={group => openGroup('Jenis pendidikan', group)} />
        <GenderCompositionPanel groups={stats.gender} employeeCount={emps.length} onSelect={group => openGroup('Jenis kelamin', group)} />
        <DistributionPanel title="Peringkat jabatan" description="Dikelompokkan dari kolom peringkat jabatan pada master." groups={stats.rank} onSelect={group => openGroup('Peringkat jabatan', group)} />
        <DistributionPanel title="Jabatan fungsional" description="Hanya jenis jabatan yang ditandai Fungsional. Klasifikasi kosong tetap ditampilkan terpisah." groups={stats.functional} onSelect={group => openGroup('Jabatan fungsional', group)} />
      </div>
    </section>

    <section className="people-section">
      <div className="people-section-heading"><h2>Perubahan pegawai</h2><p>Jendela waktu 12 bulan. Pensiun dan pengunduran diri hanya memakai tanggal yang diisi secara eksplisit.</p></div>
      <div className="people-event-grid">
        <EventPanel title="Akan pensiun" period={`12 bulan ke depan · sampai ${formatID(stats.nextYear)}`} items={stats.pensions} emptyText="Belum ada tanggal pensiun dalam periode ini." coverageLabel={`Tanggal pensiun belum diisi pada ${stats.missingPension.length} pegawai aktif.`} coverage={stats.missingPension} onOpen={() => openEvents('Tanggal pensiun belum diisi', stats.missingPension, e => e.kantor)} onPerson={e => nav('employees', e.id)} onAll={() => openEvents('Akan pensiun dalam 12 bulan', stats.pensions.map(event => event.employee), e => e.tanggalPensiun ? formatID(e.tanggalPensiun) : '')} />
        <EventPanel title="Pegawai baru" period={`12 bulan terakhir · sejak ${formatID(stats.yearAgo)}`} items={stats.newHires} emptyText="Belum ada tanggal mulai kerja dalam periode ini." coverageLabel={`Tanggal mulai kerja belum diisi pada ${stats.missingStartDate.length} pegawai.`} coverage={stats.missingStartDate} onOpen={() => openEvents('Tanggal mulai kerja belum diisi', stats.missingStartDate, e => e.kantor)} onPerson={e => nav('employees', e.id)} onAll={() => openEvents('Pegawai baru dalam 12 bulan', stats.newHires.map(event => event.employee), e => e.tanggalMulaiKerja ? formatID(e.tanggalMulaiKerja) : '')} />
        <EventPanel title="Mengundurkan diri" period={`12 bulan terakhir · sejak ${formatID(stats.yearAgo)}`} items={stats.resignations} emptyText="Belum ada tanggal pengunduran diri dalam periode ini." coverageLabel={`${stats.inactiveWithoutResignationDate.length} pegawai berstatus Nonaktif tanpa tanggal pengunduran diri. Status Nonaktif tidak otomatis dianggap mengundurkan diri.`} coverage={stats.inactiveWithoutResignationDate} onOpen={() => openEvents('Nonaktif tanpa tanggal pengunduran diri', stats.inactiveWithoutResignationDate, e => e.statusPegawai)} onPerson={e => nav('employees', e.id)} onAll={() => openEvents('Pengunduran diri dalam 12 bulan', stats.resignations.map(event => event.employee), e => e.tanggalPengunduranDiri ? formatID(e.tanggalPengunduranDiri) : '')} />
      </div>
    </section>

    <AnimatePresence>{selectedGroup && <Drawer wide label={`${selectedGroup.title}: ${selectedGroup.name}`} onClose={closeSelectedGroup}>
      <PeopleGroupDrawer group={selectedGroup} onSelect={employee => { focusOrigin.current = null; nav('employees', employee.id) }} />
    </Drawer>}</AnimatePresence>
  </div>
}

function PeopleCompletenessPanel({ fields, employeeCount }: {
  fields: { key: keyof Employee; label: string; why: string; filled: number }[]
  employeeCount: number
}) {
  const columns = [fields.slice(0, Math.ceil(fields.length / 2)), fields.slice(Math.ceil(fields.length / 2))]
  const filledTotal = fields.reduce((sum, field) => sum + field.filled, 0)
  const total = fields.length * employeeCount
  const overall = pct(filledTotal, total)

  return <section className="dashboard-panel people-completeness-panel" aria-labelledby="people-completeness-title">
    <div className="dashboard-panel-heading">
      <div><h2 id="people-completeness-title">Kelengkapan data</h2><p>{fields.length} isian penting untuk profil, pengelompokan, dan tindak lanjut pegawai.</p></div>
      <span className="people-completeness-badge">{overall}% terisi</span>
    </div>
    <div className="people-completeness-overview">
      <div className="people-completeness-overview-copy"><strong>{fmt.format(filledTotal)} <small>dari {fmt.format(total)} isian</small></strong><span>rata-rata cakupan seluruh master pegawai</span></div>
      <div className="people-completeness-overview-track" role="meter" aria-label="Kelengkapan seluruh isian" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall}><span style={{ width: `${overall}%` }} /></div>
    </div>
    <div className="people-completeness-columns">
      {columns.map((column, index) => <div className="people-completeness-table-wrap" key={index}>
        <table className="people-completeness-table">
          <thead><tr><th scope="col">Data yang dicek</th><th scope="col">Terisi</th><th scope="col">Cakupan</th></tr></thead>
          <tbody>{column.map(field => {
            const coverage = pct(field.filled, employeeCount)
            return <tr key={field.key}>
              <th scope="row"><span>{field.label}</span><small>{field.why}</small></th>
              <td><strong>{fmt.format(field.filled)}</strong><small>/{fmt.format(employeeCount)}</small></td>
              <td><div className="people-completeness-cell"><strong>{coverage}%</strong><span className="people-completeness-track" role="meter" aria-label={`${field.label}: ${coverage}% terisi`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage}><span style={{ width: `${coverage}%` }} /></span></div></td>
            </tr>
          })}</tbody>
        </table>
      </div>)}
    </div>
  </section>
}

function EducationTablePanel({ groups, employeeCount, onSelect }: {
  groups: EmployeeGroup[]; employeeCount: number; onSelect: (group: EmployeeGroup) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? groups : groups.slice(0, 7)
  return <section className="dashboard-panel people-education-panel">
    <div className="dashboard-panel-heading"><div><h2>Jenis pendidikan</h2><p>Jenjang diseragamkan dari isian pendidikan. Pilih baris untuk melihat pegawai.</p></div><span>{groups.length} jenjang</span></div>
    {groups.length ? <div className="people-education-table-wrap">
      <table className="people-education-table">
        <thead><tr><th scope="col">Jenjang</th><th scope="col">Pegawai</th></tr></thead>
        <tbody>{visible.map((group, index) => {
          const count = group.employees.length
          const coverage = pct(count, employeeCount)
          return <tr key={group.name}>
            <th scope="row"><button type="button" className="people-education-select" onClick={() => onSelect(group)} aria-label={`Lihat ${count} pegawai dengan pendidikan ${group.name}`}><span className="people-education-rank">{index + 1}</span><span title={group.name}>{group.name}</span></button></th>
            <td><div className="people-education-count"><div><strong>{fmt.format(count)}</strong><small>{coverage}%</small></div><span className="people-education-track" aria-hidden="true"><span style={{ width: `${coverage}%` }} /></span></div></td>
          </tr>
        })}</tbody>
      </table>
    </div> : <p className="people-empty-note">Belum ada data pendidikan.</p>}
    {groups.length > 7 && <button type="button" className="people-show-groups" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Ringkas jenjang' : `Tampilkan ${groups.length - 7} jenjang lainnya`}</button>}
  </section>
}

function GenderCompositionPanel({ groups, employeeCount, onSelect }: {
  groups: EmployeeGroup[]; employeeCount: number; onSelect: (group: EmployeeGroup) => void
}) {
  const colorFor = (name: string) => /laki-laki/i.test(name) ? '#294360' : /perempuan/i.test(name) ? '#d9251c' : '#9a7a3d'
  return <section className="dashboard-panel people-gender-panel">
    <div className="dashboard-panel-heading"><div><h2>Jenis kelamin</h2><p>Komposisi dari data master atau NIP. Pilih kategori untuk melihat pegawai.</p></div><span>{fmt.format(employeeCount)} pegawai</span></div>
    {groups.length ? <>
      <div className="people-gender-stack" role="img" aria-label={`Komposisi jenis kelamin dari ${employeeCount} pegawai`}>
        {groups.map(group => {
          const share = pct(group.employees.length, employeeCount)
          const width = employeeCount ? (group.employees.length / employeeCount) * 100 : 0
          return <span key={group.name} title={`${group.name}: ${group.employees.length} pegawai (${share}%)`} style={{ width: `${width}%`, backgroundColor: colorFor(group.name) }} />
        })}
      </div>
      <div className="people-gender-legend">
        {groups.map(group => {
          const count = group.employees.length
          const share = pct(count, employeeCount)
          return <button type="button" className="people-gender-row" key={group.name} onClick={() => onSelect(group)} aria-label={`Lihat ${count} pegawai: ${group.name}, ${share}%`}>
            <span className="people-gender-key" style={{ backgroundColor: colorFor(group.name) }} aria-hidden="true" />
            <span className="people-gender-name">{group.name}</span><strong>{fmt.format(count)}</strong><small>{share}%</small>
          </button>
        })}
      </div>
    </> : <p className="people-empty-note">Belum ada data jenis kelamin.</p>}
  </section>
}

function DistributionPanel({ title, description, groups, onSelect }: { title: string; description: string; groups: EmployeeGroup[]; onSelect: (group: EmployeeGroup) => void }) {
  const [expanded, setExpanded] = useState(false)
  const max = Math.max(1, ...groups.map(group => group.employees.length))
  const visible = expanded ? groups : groups.slice(0, 6)
  return <section className="dashboard-panel">
    <div className="dashboard-panel-heading"><div><h2>{title}</h2><p>{description}</p></div><span>{groups.length} kelompok</span></div>
    {groups.length ? <div className="unit-chart people-distribution-list">{visible.map(group => {
      const value = group.employees.length
      return <button type="button" className="unit-row people-group-row" key={group.name} disabled={!value} aria-label={`Lihat ${value} pegawai dalam ${group.name}, ${title}`} onClick={() => onSelect(group)}>
        <span className="unit-name" title={group.name}>{group.name}</span>
        <span className="unit-track" aria-hidden="true"><span style={{ width: `${(value / max) * 100}%` }} /></span>
        <span className="unit-value">{value}<small> orang</small></span>
      </button>
    })}</div> : <p className="people-empty-note">Belum ada data untuk dikelompokkan.</p>}
    {groups.length > 6 && <button type="button" className="people-show-groups" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Ringkas kelompok' : `Tampilkan ${groups.length - 6} kelompok lainnya`}</button>}
  </section>
}

function EventPanel({ title, period, items, emptyText, coverageLabel, coverage, onOpen, onPerson, onAll }: {
  title: string; period: string; items: EmployeeEvent[]; emptyText: string; coverageLabel: string; coverage: Employee[];
  onOpen: () => void; onPerson: (employee: Employee) => void; onAll: () => void
}) {
  return <section className="dashboard-panel people-event-panel">
    <div className="dashboard-panel-heading"><div><h2>{title}</h2><p>{period} · {items.length} pegawai</p></div></div>
    {items.length ? <div className="people-event-list">{items.slice(0, 4).map(({ employee, date }) => <button type="button" className="people-event-row" key={employee.id} onClick={() => onPerson(employee)}>
      <span><strong>{employee.nama}</strong><small>{employee.kantor} · {employee.unit || 'Unit belum diisi'}</small></span>
      <time dateTime={date}>{formatID(date)}</time>
    </button>)}</div> : <p className="people-empty-note">{emptyText}</p>}
    {items.length > 4 && <button type="button" className="people-show-groups" onClick={onAll}>Lihat semua {items.length} pegawai</button>}
    {coverage.length > 0 && <div className="people-coverage"><p>{coverageLabel}</p><button type="button" className="people-coverage-link" onClick={onOpen}>Periksa daftar pegawai</button></div>}
  </section>
}

function PeopleGroupDrawer({ group, onSelect }: { group: SelectedGroup; onSelect: (employee: Employee) => void }) {
  const [limit, setLimit] = useState(50)
  const employees = [...group.employees].sort((a, b) => a.nama.localeCompare(b.nama, 'id'))
  return <div className="people-drawer">
    <p className="people-drawer-kicker">{group.title}</p>
    <h2>{group.name}</h2>
    <p className="people-drawer-description">{group.description}</p>
    <p className="people-drawer-count">{fmt.format(employees.length)} pegawai</p>
    <div className="people-detail-list">{employees.slice(0, limit).map(employee => <button type="button" className="people-detail-row" key={employee.id} onClick={() => onSelect(employee)}>
      <span className="people-detail-avatar">{initials(employee.nama)}</span>
      <span className="people-detail-copy"><strong>{employee.nama}</strong><small>{group.meta(employee) || employee.statusKepegawaian}</small></span>
      <ChevronRight size={17} aria-hidden="true" />
    </button>)}</div>
    {employees.length > limit && <button type="button" className="people-show-groups" onClick={() => setLimit(value => value + 50)}>Tampilkan {Math.min(50, employees.length - limit)} pegawai berikutnya</button>}
  </div>
}
