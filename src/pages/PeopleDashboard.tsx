import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Cake, CalendarDays, Database, Plus, UploadCloud, UsersRound } from 'lucide-react'
import { useHr } from '../state/HrData.tsx'
import { useAuth } from '../state/Auth.tsx'
import type { Employee } from '../engine/types.ts'
import { ageFrom, fmt, pct } from '../lib/format.ts'
import { formatID } from '../engine/dates.ts'
import { Drawer, Empty } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'
import './people.css'
import {
  ALL_OFFICES, buildMovement, buildStats, employeeMeta, localDate, officeGroups, share,
  type EmployeeGroup, type MonthBucket, type WindowMonths,
} from './people/data.ts'
import { Pyramid, RankedBars, SegmentBar } from './people/charts.tsx'
import { CompletenessPanel, EducationTable, EventPanel, Panel, WindowPicker } from './people/panels.tsx'
import { PeopleGroupDrawer, type SelectedGroup } from './people/PeopleDrawer.tsx'

const DEFAULT_DESCRIPTION = 'Pilih nama pegawai untuk membuka profil lengkap.'

export function PeopleDashboard({ nav }: { nav: Nav }) {
  const { roster } = useHr()
  const canAddData = useAuth().user.role === 'superadmin' // App.nav menolak halaman Tambah Data untuk peran lain
  const allEmps = roster.employees
  const [office, setOffice] = useState<string>(ALL_OFFICES)
  const [months, setMonths] = useState<WindowMonths>(12)
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup | null>(null)
  // Bar masuk dianimasikan sekali saat halaman pertama dibuka; perubahan filter tidak mengulangnya.
  const [entering, setEntering] = useState(true)
  useEffect(() => { const t = window.setTimeout(() => setEntering(false), 900); return () => window.clearTimeout(t) }, [])
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

  const today = useMemo(() => localDate(new Date()), [])
  const offices = useMemo(() => officeGroups(allEmps), [allEmps])
  const activeOffice = offices.some(group => group.name === office) ? office : ALL_OFFICES
  const emps = useMemo(
    () => activeOffice === ALL_OFFICES ? allEmps : allEmps.filter(e => (e.kantor || 'Kantor belum diisi') === activeOffice),
    [allEmps, activeOffice],
  )
  const stats = useMemo(() => buildStats(emps, today), [emps, today])
  const movement = useMemo(() => buildMovement(emps, months, today), [emps, months, today])
  const yearAhead = useMemo(() => buildMovement(emps, 12, today).pensions, [emps, today])

  if (!allEmps.length) return <div className="page"><Empty icon={UploadCloud} title="Belum ada data pegawai" action={<div className="row-actions"><button className="btn primary" onClick={() => nav('import')}>Impor file absensi</button>{canAddData && <button className="btn secondary" onClick={() => nav('add')}>Tambah data pegawai</button>}</div>}>Daftar pegawai dibentuk dari sumber absensi, lalu dilengkapi lewat isi manual atau impor massal.</Empty></div>

  const todayLabel = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
  const monthFmt = new Intl.DateTimeFormat('id-ID', { month: 'short' })
  const scopeNote = activeOffice === ALL_OFFICES ? '' : ` Kantor: ${activeOffice}.`
  const nowKey = today.slice(0, 7)

  const open = (title: string, name: string, employees: Employee[], description = DEFAULT_DESCRIPTION, meta: (employee: Employee) => string = employeeMeta) => {
    focusOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelectedGroup({ title, name, description: description + scopeNote, employees, meta })
  }
  const pick = (title: string, description?: string) => (group: EmployeeGroup) => open(title, group.name, group.employees, description)
  const dated = (dateOf: (employee: Employee) => string | undefined) => (employee: Employee) =>
    [dateOf(employee) ? formatID(dateOf(employee)!) : '', employee.kantor, employee.unit].filter(Boolean).join(' · ')
  const withAgeMeta = (employee: Employee) => [employee.tanggalLahir ? `${ageFrom(employee.tanggalLahir)} tahun` : '', employee.jabatan, employee.unit].filter(Boolean).join(' · ')

  const known = stats.male + stats.female
  const unknownGenderCount = emps.length - known
  const bandsMissingGender = stats.bands.reduce((sum, band) => sum + band.employees.length - band.male.length - band.female.length, 0)
  const scopeLabel = activeOffice === ALL_OFFICES ? 'Semua kantor' : activeOffice

  return <div className={`pd-page${entering ? ' is-entering' : ''}`}>
    <section className="pd-hero on-dark">
      <div className="pd-hero-copy">
        <div className="pd-hero-date"><CalendarDays size={15} aria-hidden="true" /><span>{todayLabel}</span></div>
        <h2>People Dashboard</h2>
        <p>Ringkasan pegawai KPPU. Pilih batang, segmen, atau angka untuk melihat daftar pegawainya; data kosong tampil sebagai “Belum diisi”.</p>
        <span className="pd-hero-note"><Database size={14} aria-hidden="true" /> Master pegawai · sumber impor dan pelengkapan admin</span>
      </div>
      <div className="pd-hero-actions">
        <button className="btn secondary" onClick={() => nav('employees')}><UsersRound size={17} /> Buka Data Pegawai</button>
        {canAddData && <button className="btn primary" onClick={() => nav('add')}><Plus size={17} /> Lengkapi data pegawai</button>}
      </div>
    </section>

    <div className="pd-filter" role="group" aria-label="Filter kantor">
      <span className="pd-filter-label" id="pd-filter-label">Kantor</span>
      <div className="pd-chips" aria-labelledby="pd-filter-label">
        <button type="button" className="pd-chip" aria-pressed={activeOffice === ALL_OFFICES} onClick={() => setOffice(ALL_OFFICES)}>Semua<small>{fmt.format(allEmps.length)}</small></button>
        {offices.map(group => <button type="button" key={group.name} className="pd-chip" aria-pressed={activeOffice === group.name} onClick={() => setOffice(group.name)}>{group.name}<small>{fmt.format(group.employees.length)}</small></button>)}
      </div>
      <p className="pd-filter-status" aria-live="polite">{activeOffice === ALL_OFFICES ? `Menampilkan seluruh ${fmt.format(emps.length)} pegawai.` : `Menampilkan ${fmt.format(emps.length)} pegawai di ${activeOffice}. Semua panel mengikuti pilihan ini.`}</p>
    </div>

    <section className="pd-kpis" aria-label={`Ringkasan kepegawaian, ${scopeLabel}`}>
      <Kpi label="Total pegawai" value={fmt.format(emps.length)} sub={`${fmt.format(stats.unitCount)} unit · ${stats.status.map(s => `${s.employees.length} ${s.name}`).join(' · ')}`} onClick={() => open('Total pegawai', scopeLabel, emps)} action={`Lihat ${emps.length} pegawai`} />
      <Kpi label="Rata-rata usia" value={<>{stats.avgAge.toFixed(1)} <small>tahun</small></>} sub={`Median ${stats.medianAge.toFixed(1)} · dari ${fmt.format(stats.withAge)} tanggal lahir terisi`} />
      <Kpi label="Laki-laki : Perempuan" value={`${pct(stats.male, known)} : ${pct(stats.female, known)}`} sub={`${fmt.format(stats.male)} L · ${fmt.format(stats.female)} P${unknownGenderCount ? ` · ${fmt.format(unknownGenderCount)} belum diisi` : ''}`} />
      <Kpi label="Akan pensiun · 12 bulan" value={fmt.format(yearAhead.length)} sub={yearAhead.length ? `Terdekat ${formatID(yearAhead[0].date, { short: true })}` : 'Belum ada tanggal pensiun terisi'} onClick={() => open('Akan pensiun dalam 12 bulan', `${yearAhead.length} pegawai`, yearAhead.map(item => item.employee), DEFAULT_DESCRIPTION, dated(e => e.tanggalPensiun))} action={`Lihat ${yearAhead.length} pegawai yang akan pensiun`} disabled={!yearAhead.length} />
    </section>

    <Section title="Komposisi" hint="Sebaran kantor, status kepegawaian, dan jenis kelamin.">
      <div className="pd-grid pd-grid-comp">
        <Panel title="Per kantor" sub="Pusat dan semua kantor wilayah. Filter di atas menyorot satu kantor." aside={`${offices.length} kantor`}>
          <RankedBars title="Per kantor" groups={offices} total={allEmps.length} noun="kantor" selected={activeOffice === ALL_OFFICES ? undefined : activeOffice} onSelect={pick('Per kantor')} />
        </Panel>
        <div className="pd-stack">
          <Panel title="Status kepegawaian" sub="PNS, PPPK, dan Non-ASN." aside={`${fmt.format(emps.length)} pegawai`}>
            <SegmentBar title="status kepegawaian" groups={stats.status} total={emps.length} onSelect={pick('Status kepegawaian')} />
          </Panel>
          <Panel title="Jenis kelamin" sub="Dari data master atau diturunkan dari NIP." aside={`${fmt.format(emps.length)} pegawai`}>
            <SegmentBar title="jenis kelamin" groups={stats.gender} total={emps.length} onSelect={pick('Jenis kelamin')} />
          </Panel>
        </div>
      </div>
    </Section>

    <Section title="Struktur organisasi" hint="Unit, peringkat, jabatan fungsional, dan pendidikan. Pilih baris untuk membuka daftar pegawai.">
      <div className="pd-grid pd-grid-struct">
        <Panel title="Per unit" sub="Semua unit dari data pegawai." aside={`${fmt.format(stats.units.length)} unit`}>
          <RankedBars title="Per unit" groups={stats.units} total={emps.length} noun="unit" searchable sortable scroll onSelect={pick('Per unit')} />
        </Panel>
        <Panel title="Jabatan fungsional" sub={<>{fmt.format(stats.functionalCount)} pegawai berjenis jabatan Fungsional. Jenis jabatan kosong dipisah, tidak dihitung.</>} aside={`${fmt.format(stats.functional.length)} kelompok`}>
          <RankedBars title="Jabatan fungsional" groups={stats.functional} total={stats.functionalTotal} noun="jabatan" searchable sortable scroll onSelect={pick('Jabatan fungsional')} emptyText="Belum ada pegawai berjenis jabatan Fungsional." />
        </Panel>
        <Panel title="Peringkat jabatan" sub="Dikelompokkan dari kolom peringkat jabatan di master." aside={`${fmt.format(stats.rank.length)} peringkat`}>
          <RankedBars title="Peringkat jabatan" groups={stats.rank} total={emps.length} noun="peringkat" sortable initial={8} onSelect={pick('Peringkat jabatan')} />
        </Panel>
        <Panel title="Jenis pendidikan" sub="Jenjang diseragamkan dari isian pendidikan; tertinggi di atas." aside={`${fmt.format(stats.education.length)} jenjang`}>
          <EducationTable groups={stats.education} total={emps.length} onSelect={pick('Jenis pendidikan')} />
        </Panel>
      </div>
    </Section>

    <Section title="Demografi" hint="Struktur usia menurut jenis kelamin dan ulang tahun terdekat.">
      <div className="pd-grid pd-grid-demo">
        <Panel title="Piramida usia" sub="Kelompok 5 tahun. Pilih batang untuk satu jenis kelamin, atau label usia untuk semua." aside={`${fmt.format(stats.withAge)} dari ${fmt.format(emps.length)} terisi`}>
          {stats.withAge ? <Pyramid bands={stats.bands} onSelect={(band, side) => {
            const list = side === 'all' ? band.employees : side === 'male' ? band.male : band.female
            const who = side === 'all' ? 'Semua jenis kelamin.' : side === 'male' ? 'Laki-laki.' : 'Perempuan.'
            open('Kelompok usia', `Usia ${band.label} tahun`, list, `${who} ${DEFAULT_DESCRIPTION}`, withAgeMeta)
          }} /> : <p className="pd-empty">Belum ada tanggal lahir yang terisi.</p>}
          <ul className="pd-chips-stat" aria-label="Ringkasan kelompok usia 10 tahunan">
            {stats.coarseAges.map(group => <li key={group.name}><button type="button" className="pd-stat" disabled={!group.employees.length} onClick={() => open('Kelompok usia', group.name, group.employees, DEFAULT_DESCRIPTION, withAgeMeta)} aria-label={`Lihat ${group.employees.length} pegawai usia ${group.name}`}>
              <span>{group.name}</span><strong>{fmt.format(group.employees.length)}</strong><small>{share(group.employees.length, stats.withAge)}</small>
            </button></li>)}
          </ul>
          {(stats.unknownAge.length > 0 || bandsMissingGender > 0) && <div className="pd-note">
            {bandsMissingGender > 0 && <p>{fmt.format(bandsMissingGender)} pegawai tanpa jenis kelamin tidak tampil di kedua sisi piramida, tetapi tetap terhitung pada label usia.</p>}
            {stats.unknownAge.length > 0 && <button type="button" className="pd-more" onClick={() => open('Kelompok usia', 'Tanggal lahir belum diisi', stats.unknownAge, 'Tanggal lahir belum tersedia pada master pegawai.')}>Tanggal lahir belum diisi pada {fmt.format(stats.unknownAge.length)} pegawai · lihat daftar</button>}
          </div>}
        </Panel>
        <Panel title="Ulang tahun terdekat" sub={`30 hari ke depan · ${stats.birthdays.length} pegawai`} className="pd-birthday" aside={<button type="button" className="pd-link" onClick={() => nav('automation')}>Atur pesan</button>}>
          {stats.birthdays.length ? <ul className="pd-bday-list">{stats.birthdays.slice(0, 6).map(({ e, days }) => {
            const [, month, day] = e.tanggalLahir.split('-').map(Number)
            return <li key={e.id}><button type="button" className="pd-bday" onClick={() => nav('employees', e.id)}>
              <span className="pd-bday-date"><strong>{day}</strong><small>{monthFmt.format(new Date(2000, month - 1, day))}</small></span>
              <span className="pd-bday-who"><strong>{e.nama}</strong><small>{e.unit.replace(/ - Sekretaris Jenderal$/, '') || e.kantor}</small></span>
              <span className="pd-bday-when">{days === 0 ? 'Hari ini' : days === 1 ? 'Besok' : `${days} hari lagi`}</span>
            </button></li>
          })}</ul> : <div className="pd-empty-icon"><Cake size={19} aria-hidden="true" /><p>Tidak ada ulang tahun dalam 30 hari.</p></div>}
          {stats.birthdays.length > 6 && <button type="button" className="pd-more" onClick={() => open('Ulang tahun terdekat', `${stats.birthdays.length} pegawai`, stats.birthdays.map(item => item.e), '30 hari ke depan, terdekat dahulu.', e => [e.unit, e.kantor].filter(Boolean).join(' · '))}>Lihat semua {stats.birthdays.length} pegawai</button>}
        </Panel>
      </div>
    </Section>

    <Section title="Perubahan pegawai" hint="Pensiun, pegawai baru, dan pengunduran diri. Hanya tanggal yang diisi yang dihitung."
      aside={<div className="pd-window"><span id="pd-window-label">Jendela waktu</span><WindowPicker value={months} onChange={setMonths} /></div>}>
      <div className="pd-grid pd-grid-events">
        <EventPanel title="Akan pensiun" range={`${months} bulan ke depan · sampai ${formatID(movement.future)}`} items={movement.pensions} buckets={movement.pensionBuckets} nowKey={nowKey}
          emptyText="Belum ada tanggal pensiun dalam periode ini."
          notes={[
            { count: stats.overduePension.length, text: `${stats.overduePension.length} pegawai aktif sudah melewati tanggal pensiun yang tercatat.`, action: 'Periksa daftar pegawai', onOpen: () => open('Sudah melewati tanggal pensiun', `${stats.overduePension.length} pegawai`, stats.overduePension, DEFAULT_DESCRIPTION, dated(e => e.tanggalPensiun)) },
            { count: stats.missingPension.length, text: `Tanggal pensiun belum diisi pada ${stats.missingPension.length} pegawai aktif.`, action: 'Periksa daftar pegawai', onOpen: () => open('Tanggal pensiun belum diisi', `${stats.missingPension.length} pegawai`, stats.missingPension, DEFAULT_DESCRIPTION, e => [e.kantor, e.unit].filter(Boolean).join(' · ')) },
          ]}
          onBucket={(bucket: MonthBucket) => open('Akan pensiun', bucket.full, bucket.employees, DEFAULT_DESCRIPTION, dated(e => e.tanggalPensiun))}
          onPerson={e => nav('employees', e.id)}
          onAll={() => open(`Akan pensiun dalam ${months} bulan`, `${movement.pensions.length} pegawai`, movement.pensions.map(item => item.employee), DEFAULT_DESCRIPTION, dated(e => e.tanggalPensiun))} />
        <EventPanel title="Pegawai baru" range={`${months} bulan terakhir · sejak ${formatID(movement.past)}`} items={movement.newHires} buckets={movement.hireBuckets} nowKey={nowKey}
          emptyText="Belum ada tanggal mulai kerja dalam periode ini."
          notes={[{ count: stats.missingStartDate.length, text: `Tanggal mulai kerja belum diisi pada ${stats.missingStartDate.length} pegawai.`, action: 'Periksa daftar pegawai', onOpen: () => open('Tanggal mulai kerja belum diisi', `${stats.missingStartDate.length} pegawai`, stats.missingStartDate, DEFAULT_DESCRIPTION, e => [e.kantor, e.unit].filter(Boolean).join(' · ')) }]}
          onBucket={(bucket: MonthBucket) => open('Pegawai baru', bucket.full, bucket.employees, DEFAULT_DESCRIPTION, dated(e => e.tanggalMulaiKerja))}
          onPerson={e => nav('employees', e.id)}
          onAll={() => open(`Pegawai baru dalam ${months} bulan`, `${movement.newHires.length} pegawai`, movement.newHires.map(item => item.employee), DEFAULT_DESCRIPTION, dated(e => e.tanggalMulaiKerja))} />
        <EventPanel title="Mengundurkan diri" range={`${months} bulan terakhir · sejak ${formatID(movement.past)}`} items={movement.resignations} buckets={movement.resignBuckets} nowKey={nowKey}
          emptyText="Belum ada tanggal pengunduran diri dalam periode ini."
          notes={[{ count: stats.inactiveWithoutResignationDate.length, text: `${stats.inactiveWithoutResignationDate.length} pegawai Nonaktif tanpa tanggal pengunduran diri. Nonaktif tidak otomatis dihitung mengundurkan diri.`, action: 'Periksa daftar pegawai', onOpen: () => open('Nonaktif tanpa tanggal pengunduran diri', `${stats.inactiveWithoutResignationDate.length} pegawai`, stats.inactiveWithoutResignationDate, DEFAULT_DESCRIPTION, e => [e.statusPegawai, e.kantor].filter(Boolean).join(' · ')) }]}
          onBucket={(bucket: MonthBucket) => open('Mengundurkan diri', bucket.full, bucket.employees, DEFAULT_DESCRIPTION, dated(e => e.tanggalPengunduranDiri))}
          onPerson={e => nav('employees', e.id)}
          onAll={() => open(`Pengunduran diri dalam ${months} bulan`, `${movement.resignations.length} pegawai`, movement.resignations.map(item => item.employee), DEFAULT_DESCRIPTION, dated(e => e.tanggalPengunduranDiri))} />
      </div>
    </Section>

    <Section title="Kualitas data" hint="Kelengkapan master pegawai. Isian kosong memengaruhi grafik di atas.">
      <CompletenessPanel fields={stats.completeness} employeeCount={emps.length}
        onMissing={field => open('Data belum lengkap', `${field.label} belum diisi`, emps.filter(e => !e[field.key]), `Pegawai yang ${field.label.toLocaleLowerCase('id-ID')} belum terisi pada master.`)} />
    </Section>

    <AnimatePresence>{selectedGroup && <Drawer wide label={`${selectedGroup.title}: ${selectedGroup.name}`} onClose={closeSelectedGroup}>
      <PeopleGroupDrawer key={`${selectedGroup.title}|${selectedGroup.name}`} group={selectedGroup} onSelect={employee => { focusOrigin.current = null; nav('employees', employee.id) }} />
    </Drawer>}</AnimatePresence>
  </div>
}

function Section({ title, hint, aside, children }: { title: string; hint: string; aside?: ReactNode; children: ReactNode }) {
  return <section className="pd-section">
    <div className="pd-section-head">
      <div><h2>{title}</h2><p>{hint}</p></div>
      {aside}
    </div>
    {children}
  </section>
}

function Kpi({ label, value, sub, onClick, action, disabled }: {
  label: string; value: ReactNode; sub: string; onClick?: () => void; action?: string; disabled?: boolean
}) {
  const body = <>
    <span className="pd-kpi-label">{label}</span>
    <strong className="pd-kpi-value">{value}</strong>
    <small className="pd-kpi-sub">{sub}</small>
  </>
  return onClick
    ? <button type="button" className="pd-kpi is-action" onClick={onClick} disabled={disabled} title={action}>{body}</button>
    : <div className="pd-kpi">{body}</div>
}

