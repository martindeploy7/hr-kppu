import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowRight, CalendarCheck2, Clock3, MapPinned, UploadCloud, UserX, UsersRound } from 'lucide-react'
import { useHr } from '../state/HrData.tsx'
import { dayName, formatID, monthLabel } from '../engine/dates.ts'
import type { EmployeeMonth } from '../engine/reconcile.ts'
import { OFFICES } from '../engine/ids.ts'
import { fmt, hours, pct } from '../lib/format.ts'
import { Empty, Kpi, Note, PageHeader, Panel, Seg } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'

const SERIES = [
  { key: 'kantor', label: 'Hadir di kantor', color: '#2a78d6' },
  { key: 'wfa', label: 'WFA', color: '#eb6834' },
  { key: 'dinas', label: 'Dinas (luar & lokal)', color: '#1baf7a' },
  { key: 'cuti', label: 'Cuti / sakit / izin', color: '#eda100' },
  { key: 'tk', label: 'Tanpa ket. / tidak lengkap', color: '#e87ba4' },
  { key: 'flag', label: 'Menunggu keputusan', color: '#d2a23a' },
  { key: 'notFound', label: 'Tidak ditemukan', color: '#9aa3ab' },
] as const

export function AttendanceOverview({ nav }: { nav: Nav }) {
  const hr = useHr()
  const [office, setOffice] = useState('Semua')
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const months = useMemo(() => hr.recon.months.filter(m => office === 'Semua' || m.employee.kantor === office), [hr.recon.months, office])

  const daily = useMemo(() => hr.recon.workdays.map(date => {
    const row = { date, label: `${dayName(date, true)} ${Number(date.slice(8))}`, kantor: 0, wfa: 0, dinas: 0, cuti: 0, tk: 0, flag: 0, notFound: 0 }
    for (const m of months) {
      const d = m.days.find(x => x.date === date)
      if (!d) continue
      if (d.reviewState === 'flag') { row.flag++; continue }
      if (d.reviewState === 'not-found') { row.notFound++; continue }
      if (d.reviewState !== 'valid') continue
      if (d.status === 'hadir') row.kantor++
      else if (d.status === 'hadir-wfa') row.wfa++
      else if (d.status === 'dinas-luar' || d.status === 'dinas-lokal' || d.status === 'diklat') row.dinas++
      else if (d.status === 'cuti' || d.status === 'sakit' || d.status === 'izin') row.cuti++
      else if (d.status === 'tanpa-keterangan' || d.status === 'tidak-lengkap') row.tk++
    }
    return row
  }), [months, hr.recon.workdays])

  if (!hr.files.length) return <div className="page"><Empty icon={UploadCloud} title="Belum ada data absensi" action={<button className="btn primary" onClick={() => nav('import')}>Impor file sumber</button>}>Unggah ekspor mesin, presensi HP, rekap Kanwil, dan rekap surat tugas untuk melihat ringkasan kehadiran.</Empty></div>

  const sum = (fn: (m: EmployeeMonth) => number) => months.reduce((s, m) => s + fn(m), 0)
  const covered = sum(m => m.reviewedDays)
  const present = sum(m => m.present)
  const openIssues = hr.recon.issues.filter(i => !hr.resolutions.some(r => r.issueId === i.id) && months.some(m => m.employee.id === i.employeeId))
  const open = openIssues.length + sum(m => m.flaggedDays + m.notFoundDays)
  const officesPresent = OFFICES.filter(o => hr.recon.months.some(m => m.employee.kantor === o))

  const units = groupUnits(months)
  const watch = [...months].filter(m => m.absent > 0 || m.lateMinutes > 0).sort((a, b) => b.absent - a.absent || b.lateMinutes - a.lateMinutes).slice(0, 8)
  const fridays = daily.filter(d => new Date(`${d.date}T00:00:00Z`).getUTCDay() === 5)
  const friWfa = fridays.reduce((s, d) => s + d.wfa, 0), friAll = fridays.reduce((s, d) => s + d.kantor + d.wfa, 0)
  const hpOnly = officesPresent.filter(o => !hr.files.some(f => f.kind !== 'daring' && f.kind !== 'surat-tugas' && f.office === o))
  const otByOffice = officesPresent.map(o => ({ office: o, minutes: hr.recon.months.filter(m => m.employee.kantor === o).reduce((s, m) => s + m.overtimeMinutes, 0) })).filter(x => x.minutes > 0)

  return <div className="page">
    <PageHeader kicker={`Periode ${monthLabel(hr.activePeriod)} · ${hr.recon.workdays.length} hari kerja`} title="Ringkasan kehadiran" actions={<select className="select" value={office} onChange={e => setOffice(e.target.value)} aria-label="Filter kantor"><option>Semua</option>{officesPresent.map(o => <option key={o}>{o}</option>)}</select>}>
      Grafik menghitung aktivitas yang sudah disahkan. Hari berflag dan hari tanpa bukti ditampilkan terpisah supaya data sementara tidak terlihat sebagai keputusan final.
    </PageHeader>

    <div className="kpi-row">
      <Kpi icon={UsersRound} label="Pegawai terpantau" value={fmt.format(months.length)} note={`${officesPresent.length} kantor · ${months.filter(m => !m.employee.nip).length} tanpa NIP`} tone="navy" />
      <Kpi icon={CalendarCheck2} label="Hadir atau bertugas (valid)" value={`${pct(present + sum(m => m.dutyOut), covered)}%`} note={`Hadir ${fmt.format(present)} + dinas ${fmt.format(sum(m => m.dutyOut))} dari ${fmt.format(covered)} hari valid`} tone="green" />
      <Kpi icon={MapPinned} label="Hari perjalanan dinas" value={fmt.format(sum(m => m.dutyOut))} note={`+ ${fmt.format(sum(m => m.dutyLocal))} hari dinas lokal`} />
      <Kpi icon={UserX} label="Tanpa keterangan" value={fmt.format(sum(m => m.absent))} note={`${months.filter(m => m.absent > 0).length} pegawai · ${fmt.format(sum(m => m.incomplete))} hari bukti tidak lengkap`} tone="red" />
      <Kpi icon={AlertTriangle} label="Hari / isu perlu ditinjau" value={fmt.format(open)} note={<button className="link" onClick={() => nav('reconcile')}>Buka matriks <ArrowRight size={12} /></button>} tone="gold" />
    </div>

    <Panel title="Komposisi kehadiran per hari kerja" sub="Jumlah pegawai per status. Hari tanpa sumber untuk pegawai tertentu tidak dihitung." aside={<Seg label="Tampilan" value={view} onChange={setView} options={[{ value: 'chart', label: 'Grafik' }, { value: 'table', label: 'Tabel' }]} />}>
      {view === 'chart' ? <div className="chart-box">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={daily} margin={{ top: 8, right: 8, left: -14, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="#ece9e3" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#d9d5cd' }} tick={{ fontSize: 10, fill: '#5d6874' }} interval={0} angle={-35} textAnchor="end" height={46} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#5d6874' }} />
            <Tooltip cursor={{ fill: 'rgba(7,44,82,.05)' }} contentStyle={{ borderRadius: 10, border: '1px solid #e7e3dc', fontSize: 12 }} labelFormatter={(_, p) => p?.[0] ? formatID(p[0].payload.date, { day: true }) : ''} />
            <Legend iconType="square" iconSize={10} itemSorter={null} wrapperStyle={{ fontSize: 11, color: '#3d4a57' }} />
            {SERIES.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} stroke="#fff" strokeWidth={1} radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0} />)}
          </BarChart>
        </ResponsiveContainer>
      </div> : <div className="table-wrap"><table className="data">
        <thead><tr><th>Tanggal</th>{SERIES.map(s => <th key={s.key} className="num">{s.label}</th>)}</tr></thead>
        <tbody>{daily.map(d => <tr key={d.date}><td>{formatID(d.date, { day: true })}</td>{SERIES.map(s => <td key={s.key} className="num">{d[s.key]}</td>)}</tr>)}</tbody>
      </table></div>}
      <div className="insights">
        {hr.files.filter(f => f.partialDates?.length).map(f => <p key={f.id}><strong>Ekspor belum lengkap:</strong> {f.fileName} untuk {f.partialDates!.map(d => formatID(d, { short: true })).join(' & ')} hampir tidak berisi jam pulang/scan. Pegawai tidak dicatat tanpa keterangan pada tanggal itu; minta ekspor ulang dari mesin.</p>)}
        {friAll > 0 && <p><strong>Jumat didominasi WFA:</strong> {pct(friWfa, friAll)}% kehadiran hari Jumat tercatat WFA lewat aplikasi, sesuai pola jadwal "Jum'at" di mesin.</p>}
        {hpOnly.length > 0 && <p><strong>{hpOnly.join(', ')}</strong> hanya terpantau dari aplikasi HP. Hari tanpa presensi daring berstatus "Belum ada data", bukan "tanpa keterangan", sampai rekap mesin kantor tersebut diterima.</p>}
        {sum(m => m.lateDays) > 0 && <p><strong>{fmt.format(sum(m => m.lateDays))} hari terlambat</strong> (masuk setelah 08:00) dari {months.filter(m => m.lateDays > 0).length} pegawai. Pada aturan uang makan "tepat waktu", hari-hari ini tidak dibayar.</p>}
      </div>
    </Panel>

    <div className="grid-2">
      <Panel title="Kehadiran per unit" sub="Diurutkan dari tingkat kehadiran terendah.">
        <div className="table-wrap tall"><table className="data">
          <thead><tr><th>Unit</th><th className="num">Pegawai</th><th className="num">Hadir/bertugas</th><th className="num">Terlambat</th><th className="num">TK</th><th className="num">Dinas</th></tr></thead>
          <tbody>{units.map(u => <tr key={`${u.office}|${u.unit}`}><td><strong>{u.unit}</strong><small>{u.office}</small></td><td className="num">{u.count}</td><td className="num"><Meter value={u.rate} /></td><td className="num">{u.late}</td><td className={`num ${u.absent ? 'bad' : ''}`}>{u.absent}</td><td className="num">{u.duty}</td></tr>)}</tbody>
        </table></div>
      </Panel>
      <Panel title="Pantauan disiplin" sub="Akumulasi bulan ini. PP 94/2021 menghitung ketidakhadiran tanpa alasan sah secara kumulatif per tahun (mulai 3 hari: teguran lisan).">
        {watch.length === 0 ? <p className="muted">Tidak ada catatan.</p> : <div className="watch-list">{watch.map(m => <button key={m.employee.id} onClick={() => nav('employees', m.employee.id)}>
          <div><strong>{m.employee.nama}</strong><small>{m.employee.unit || m.employee.kantor}</small></div>
          <span className={m.absent >= 3 ? 'tag bad' : 'tag'}>{m.absent} hari TK</span>
          <span className="tag soft"><Clock3 size={11} /> {hours(m.lateMinutes)}</span>
        </button>)}</div>}
        <Note>Daftar ini bahan pembinaan, bukan keputusan hukuman. Pastikan isu rekonsiliasi pegawai terkait sudah ditinjau, karena sebagian "tanpa keterangan" bisa berasal dari surat tugas yang belum tercatat.</Note>
        {otByOffice.length > 0 && <div className="ot-strip"><span>Jam lembur tercatat (kandidat SPKL):</span>{otByOffice.map(o => <em key={o.office}>{o.office} {Math.round(o.minutes / 60)} jam</em>)}</div>}
      </Panel>
    </div>
  </div>
}

function Meter({ value }: { value: number }) {
  return <span className="meter"><span><span style={{ width: `${value}%` }} className={value < 70 ? 'low' : ''} /></span><b>{value}%</b></span>
}

function groupUnits(months: EmployeeMonth[]) {
  const map = new Map<string, EmployeeMonth[]>()
  for (const m of months) { const k = `${m.employee.kantor}|${m.employee.unit || 'Unit belum diisi'}`; map.set(k, [...(map.get(k) ?? []), m]) }
  return [...map.entries()].map(([k, list]) => {
    const [office, unit] = k.split('|')
    const covered = list.reduce((s, m) => s + m.reviewedDays, 0)
    return { office, unit: unit.replace(/ - Sekretaris Jenderal$/, ''), count: list.length, rate: pct(list.reduce((s, m) => s + m.present + m.dutyOut, 0), covered), late: list.reduce((s, m) => s + m.lateDays, 0), absent: list.reduce((s, m) => s + m.absent, 0), duty: list.reduce((s, m) => s + m.dutyOut, 0) }
  }).sort((a, b) => a.rate - b.rate)
}
