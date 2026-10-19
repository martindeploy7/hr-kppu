import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AlertTriangle, ArrowDownUp, Download, Search, Settings2, UploadCloud, WalletCards } from 'lucide-react'
import { SubmissionPanel } from '../components/SubmissionPanel.tsx'
import { useHr } from '../state/HrData.tsx'
import { reconcile, STATUS_LABEL, type EmployeeMonth } from '../engine/reconcile.ts'
import { POLICY_PRESETS, type GolGroup, type MealPolicy } from '../engine/policy.ts'
import { formatID, monthBounds, monthLabel } from '../engine/dates.ts'
import { downloadWorkbook } from '../lib/xlsx.ts'
import { fmt, money } from '../lib/format.ts'
import { DayDetail } from '../components/DayDetail.tsx'
import { Drawer, Empty, Kpi, Note, PageHeader, Panel, StatusChip } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'

type SortKey = 'nama' | 'mealDays' | 'heldDays' | 'netto'

export function MealPage({ nav, toast }: { nav: Nav; toast: (m: string) => void }) {
  const hr = useHr()
  const [q, setQ] = useState('')
  const [office, setOffice] = useState('Semua')
  const [sort, setSort] = useState<SortKey>('nama')
  const [showPolicy, setShowPolicy] = useState(false)
  const [detail, setDetail] = useState<EmployeeMonth | null>(null)
  const months = hr.recon.months
  const offices = [...new Set(months.map(m => m.employee.kantor))].sort()

  const presetImpact = useMemo(() => POLICY_PRESETS.map(p => {
    const policy = { ...hr.policy, ...p.patch }
    const r = reconcile(hr.files, hr.roster, monthBounds(hr.activePeriod || '2000-01'), policy, hr.resolutions)
    return { ...p, days: r.months.reduce((s, m) => s + m.mealDays, 0), netto: r.months.reduce((s, m) => s + m.netto, 0), active: (Object.keys(p.patch) as (keyof MealPolicy)[]).every(k => hr.policy[k] === p.patch[k]) }
  }), [hr.files, hr.roster, hr.activePeriod, hr.policy, hr.resolutions])

  if (!hr.files.length) return <div className="page"><Empty icon={UploadCloud} title="Belum ada data" action={<button className="btn primary" onClick={() => nav('import')}>Impor file sumber</button>} /></div>

  const rows = months
    .filter(m => (office === 'Semua' || m.employee.kantor === office) && (!q || `${m.employee.nama} ${m.employee.nip} ${m.employee.unit}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === 'nama' ? a.employee.nama.localeCompare(b.employee.nama) : (b[sort] as number) - (a[sort] as number))
  const total = (fn: (m: EmployeeMonth) => number) => rows.reduce((s, m) => s + fn(m), 0)
  const noNip = rows.filter(m => !m.employee.nip && m.mealDays > 0).length
  const assumed = rows.filter(m => m.groupAssumed).length
  const heldExport = rows.reduce((s, m) => s + m.days.filter(d => d.meal.state === 'held' && d.meal.reason.includes('ekspor')).length, 0)
  const late = rows.reduce((s, m) => s + m.days.filter(d => d.meal.reason.startsWith('Terlambat')).length, 0)

  const exportXlsx = async () => {
    const period = monthLabel(hr.activePeriod)
    const head = ['No', 'Nama', 'NIP', 'NIKA', 'Kantor', 'Unit', 'Status', 'Jabatan', 'Golongan', 'Kelompok tarif', 'Hari kerja', 'Jumlah kehadiran', 'Hari uang makan', 'Hari ditahan', 'Tarif/hari', 'Bruto', 'PPh %', 'PPh', 'Netto', 'Catatan']
    const nominatif = rows.map((m, i) => [i + 1, m.employee.nama, m.employee.nip, m.employee.nika, m.employee.kantor, m.employee.unit, m.employee.statusKepegawaian, m.employee.jabatan, m.employee.golongan, `${m.group}${m.groupAssumed ? ' (belum diketahui)' : ''}`, m.workdays, m.present, m.mealDays, m.heldDays, m.amountPendingDays ? null : m.employee.rateHistory?.length ? 'Sesuai tarif harian' : m.rate, m.amountPendingDays ? null : m.bruto, m.amountPendingDays ? null : m.employee.rateHistory?.length ? 'Sesuai tarif harian' : m.pphPct, m.amountPendingDays ? null : m.pph, m.amountPendingDays ? null : m.netto, [!m.employee.nip && 'NIP belum ada', m.heldDays && `${m.heldDays} hari ditahan`, m.noData && `${m.noData} hari tanpa data`, m.amountPendingDays && `${m.amountPendingDays} hari nominal pending`].filter(Boolean).join('; ')])
    const daily = rows.flatMap(m => m.days.filter(d => d.workday).map(d => [m.employee.nama, m.employee.nip, d.date, STATUS_LABEL[d.status], d.clockIn ?? '', d.clockOut ?? '', d.lateMin || '', d.meal.state === 'eligible' ? 'Ya' : d.meal.state === 'held' ? 'Ditahan' : 'Tidak', d.meal.reason, d.meal.amount, d.meal.taxPct ?? '', d.basis, [...new Set(d.evidence.map(e => e.kind))].join(' + ')]))
    const held = rows.flatMap(m => m.days.filter(d => d.meal.state === 'held').map(d => [m.employee.nama, m.employee.nip, d.date, d.meal.reason, d.issues.map(i => i.detail).join(' | ')]))
    const p = hr.policy
    await downloadWorkbook(`Daftar_Nominatif_Uang_Makan_${hr.activePeriod}${office !== 'Semua' ? `_${office.replace(/\s/g, '')}` : ''}.xlsx`, [
      { name: 'Nominatif', rows: [[`USULAN DAFTAR NOMINATIF UANG MAKAN — KOMISI PENGAWAS PERSAINGAN USAHA`], [`Periode ${period} · ${office === 'Semua' ? 'Semua kantor' : office} · dibuat ${new Date().toLocaleString('id-ID')} oleh ${hr.reviewer}`], [], head, ...nominatif, [], ['', 'JUMLAH', '', '', '', '', '', '', '', '', '', total(m => m.present), total(m => m.mealDays), total(m => m.heldDays), '', total(m => m.bruto), '', total(m => m.pph), total(m => m.netto)]], widths: [5, 30, 20, 11, 11, 34, 12, 16, 10, 12, 9, 10, 10, 10, 10, 13, 7, 11, 13, 32] },
      { name: 'Rincian Harian', rows: [['Nama', 'NIP', 'Tanggal', 'Status', 'Masuk', 'Pulang', 'Terlambat (mnt)', 'Uang makan', 'Alasan', 'Nominal', 'PPh % efektif', 'Dasar status', 'Sumber'], ...daily], widths: [28, 20, 11, 22, 7, 7, 9, 10, 40, 10, 40, 22] },
      { name: 'Ditahan', rows: [['Nama', 'NIP', 'Tanggal', 'Alasan', 'Detail isu'], ...held], widths: [28, 20, 11, 36, 80] },
      { name: 'Review Sumber', rows: [['Sumber', 'Jenis', 'ID catatan', 'Keputusan', 'Alasan', 'Reviewer', 'Waktu'], ...hr.files.flatMap(f => (f.recordReviews ?? []).filter(r => office === 'Semua' || (r.kind === 'evidence' ? f.evidence : f.assignments).some(record => record.id === r.recordId && record.office === office)).map(r => [f.id, r.kind, r.recordId, r.disposition, r.reason, r.reviewer, r.at]))], widths: [32, 14, 32, 14, 60, 24, 26] },
      { name: 'Parameter', rows: [['Parameter', 'Nilai'], ['Wajib scan masuk & pulang', p.requireComplete ? 'Ya' : 'Tidak'], ['Wajib tepat waktu', p.requireOnTime ? `Ya (toleransi ${p.lateToleranceMin} mnt)` : 'Tidak'], ['Pulang cepat menggugurkan', p.requireNoEarlyLeave ? 'Ya' : 'Tidak'], ['WFA dihitung', p.countWfa ? 'Ya' : 'Tidak'], ['Dinas lokal ≤ 8 jam dihitung', p.countLocalDuty ? 'Ya' : 'Tidak'], ['Tahan bila ada isu', p.holdOnIssues ? 'Ya' : 'Tidak'], ['Non-ASN dibayar', p.includeNonAsn ? 'Ya' : 'Tidak'], ...(['I', 'II', 'III', 'IV'] as GolGroup[]).map(g => [`Tarif gol. ${g}`, `${p.rates[g]} · PPh ${p.pph[g]}%`]), ['Golongan kosong', 'Nominal pending; tanpa tarif fallback'], ['Revisi workspace', String(hr.revision)], ['Filter pencarian', q], ['Versi kalkulasi', '2.0.0'], ...hr.files.map(f => [`Sumber r${f.revision ?? 1}: ${f.fileName}`, `${f.hash ?? 'legacy'} · ${f.id}`]), ['Catatan', 'Tarif & PPh adalah nilai acuan awal; wajib dikonfirmasi Bagian Keuangan/SDM.']], widths: [36, 50] },
    ])
    toast('Daftar nominatif diunduh')
  }

  return <div className="page">
    <PageHeader kicker={`Langkah 4 · Hitung · ${monthLabel(hr.activePeriod)}`} title="Perhitungan uang makan" actions={<><button className="btn secondary" onClick={() => setShowPolicy(v => !v)}><Settings2 size={15} /> Aturan & tarif</button><button className="btn primary" onClick={exportXlsx}><Download size={15} /> Unduh daftar nominatif</button></>}>
      Dihitung per hari dari status rekonsiliasi: hadir di kantor dan WFA dengan pasangan scan lengkap dan tepat waktu dihitung; dinas lokal/luar, tugas belajar, diperbantukan, perjalanan dinas (menerima uang harian), cuti, sakit, izin, dan tanpa keterangan tidak. Hari dengan isu yang belum diputuskan ditahan, tidak otomatis dibayar.
    </PageHeader>

    <SubmissionPanel />
    <div className="kpi-row">
      <Kpi icon={WalletCards} label="Netto yang sudah terhitung" value={money.format(total(m => m.netto))} note={`Bruto ${money.format(total(m => m.bruto))} · PPh ${money.format(total(m => m.pph))}`} tone="navy" />
      <Kpi label="Hari uang makan" value={fmt.format(total(m => m.mealDays))} note={`${rows.filter(m => m.mealDays > 0).length} pegawai menerima`} tone="green" />
      <Kpi label="Hari ditahan" value={fmt.format(total(m => m.heldDays))} note={<>{fmt.format(heldExport)} menunggu ekspor ulang · <button className="link" onClick={() => nav('reconcile')}>{fmt.format(total(m => m.heldDays) - heldExport)} menunggu keputusan</button></>} tone="gold" />
      <Kpi label="Gugur karena terlambat" value={fmt.format(late)} note="Pada aturan aktif" tone="red" />
    </div>

    <Panel title="Dampak pilihan aturan" sub="Brief menyebut uang makan untuk pegawai yang tepat waktu (masuk ≤ 08:00) sampai jam pulang. Aturan resmi perlu dikonfirmasi; bandingkan dampaknya di sini.">
      <div className="presets">{presetImpact.map(p => <button key={p.id} className={`preset ${p.active ? 'on' : ''}`} onClick={() => hr.setPolicy(p.patch)}>
        <strong>{p.label}</strong><small>{p.detail}</small>
        <span>{fmt.format(p.days)} hari · {money.format(p.netto)}</span>
      </button>)}</div>
    </Panel>

    {showPolicy && <PolicyEditor />}

    {(noNip > 0 || assumed > 0) && <Note tone="warn">
      {noNip > 0 && <><strong>{noNip} pegawai</strong> berhak uang makan tetapi belum punya NIP (hanya dari sumber Kanwil). </>}
      {assumed > 0 && <><strong>{assumed} pegawai</strong> belum memiliki data golongan; nominal belum siap dan tidak menggunakan fallback. Lengkapi golongan lewat Tambah Data → Bulk import agar tarif & PPh tepat.</>}
    </Note>}

    <Panel title="Daftar nominatif" sub="Klik baris untuk melihat alasan per hari.">
      <div className="toolbar">
        <label className="search"><Search size={15} /><input placeholder="Cari nama, NIP, unit…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <select className="select" value={office} onChange={e => setOffice(e.target.value)} aria-label="Kantor"><option>Semua</option>{offices.map(o => <option key={o}>{o}</option>)}</select>
        <label className="select-label"><ArrowDownUp size={14} /><select className="select" value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Urutkan"><option value="nama">Nama</option><option value="mealDays">Hari UM terbanyak</option><option value="heldDays">Ditahan terbanyak</option><option value="netto">Netto terbesar</option></select></label>
      </div>
      <div className="table-wrap tall"><table className="data clickable">
        <thead><tr><th>Pegawai</th><th>Gol.</th><th className="num">Hadir</th><th className="num">UM</th><th className="num">Ditahan</th><th className="num">Tarif</th><th className="num">Bruto</th><th className="num">PPh</th><th className="num">Netto</th></tr></thead>
        <tbody>{rows.map(m => <tr key={m.employee.id} onClick={() => setDetail(m)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setDetail(m)}>
          <td><strong>{m.employee.nama}</strong><small>{m.employee.nip || <span className="warn-text"><AlertTriangle size={11} /> tanpa NIP</span>} · {m.employee.kantor}</small></td>
          <td>{m.employee.golongan || '—'}<small>{m.groupAssumed ? 'Kelompok belum diketahui' : m.group}</small></td>
          <td className="num">{m.present}<small>/{m.workdays - m.noData}</small></td>
          <td className="num strong">{m.mealDays}</td>
          <td className={`num ${m.heldDays ? 'held' : ''}`}>{m.heldDays || '—'}</td>
          <td className="num">{m.amountPendingDays || m.groupAssumed ? 'Pending' : m.employee.rateHistory?.length ? 'Tarif harian' : fmt.format(m.rate)}</td>
          <td className="num">{m.amountPendingDays ? 'Pending' : fmt.format(m.bruto)}</td>
          <td className="num">{m.pph ? fmt.format(m.pph) : '—'}</td>
          <td className="num strong">{m.amountPendingDays ? 'Pending' : fmt.format(m.netto)}</td>
        </tr>)}</tbody>
        <tfoot><tr><td>Jumlah ({rows.length} pegawai)</td><td /><td className="num">{fmt.format(total(m => m.present))}</td><td className="num">{fmt.format(total(m => m.mealDays))}</td><td className="num">{fmt.format(total(m => m.heldDays))}</td><td /><td className="num">{fmt.format(total(m => m.bruto))}</td><td className="num">{fmt.format(total(m => m.pph))}</td><td className="num">{fmt.format(total(m => m.netto))}</td></tr></tfoot>
      </table></div>
    </Panel>

    <AnimatePresence>{detail && <Drawer wide label="Rincian uang makan" onClose={() => setDetail(null)}>{(() => { const current = hr.recon.months.find(m => m.employee.id === detail.employee.id); return current ? <MealDetail month={current} /> : <p className="muted">Pegawai ini tidak lagi ada pada roster aktif periode ini setelah perubahan sumber. Tutup rincian untuk memeriksa perhitungan terbaru.</p> })()}</Drawer>}</AnimatePresence>
  </div>
}

function MealDetail({ month }: { month: EmployeeMonth }) {
  const [open, setOpen] = useState<string | null>(null)
  return <>
    <div className="drawer-head"><span className="page-kicker">Rincian uang makan</span><h2>{month.employee.nama}</h2><p>{month.employee.nip || 'Tanpa NIP'} · {month.employee.kantor} · gol. {month.employee.golongan || `Belum diketahui`}</p></div>
    <div className="mini-kpis"><div><span>Hari UM</span><strong>{month.mealDays}</strong></div><div><span>Ditahan</span><strong>{month.heldDays}</strong></div><div><span>Bruto</span><strong>{month.amountPendingDays ? 'Pending' : money.format(month.bruto)}</strong></div><div><span>Netto</span><strong>{month.amountPendingDays ? 'Pending' : money.format(month.netto)}</strong></div></div>
    <div className="day-rows">{month.days.filter(d => d.workday).map(d => <div key={d.date}>
      <button className={`day-row m-${d.meal.state}`} onClick={() => setOpen(open === d.date ? null : d.date)} aria-expanded={open === d.date}>
        <span className="d">{formatID(d.date, { short: true, year: false })}</span>
        <StatusChip status={d.status} />
        <span className="t mono">{d.clockIn ?? '—'} – {d.clockOut ?? '—'}</span>
        <span className="r">{d.meal.reason}</span>
        <b>{d.meal.amount ? fmt.format(d.meal.amount) : d.meal.state === 'held' ? 'ditahan' : d.meal.state === 'eligible' && !d.meal.amountReady ? 'pending' : '—'}</b>
      </button>
      {open === d.date && <DayDetail day={d} showMeal={false} />}
    </div>)}</div>
  </>
}

function PolicyEditor() {
  const hr = useHr()
  const p = hr.policy
  const toggle = (k: keyof MealPolicy, label: string, help: string) => <label className="toggle-row"><input type="checkbox" checked={p[k] as boolean} onChange={e => hr.setPolicy({ [k]: e.target.checked } as Partial<MealPolicy>)} /><span><strong>{label}</strong><small>{help}</small></span></label>
  return <Panel title="Aturan & tarif" sub="Nilai acuan awal mengikuti pola standar biaya uang makan ASN (PNS gol. I–IV; PPPK dipetakan I–IV≈I, V–VIII≈II, IX–XII≈III, XIII–XVII≈IV). Wajib dikonfirmasi Bagian Keuangan/SDM sebelum dipakai membayar.">
    <div className="policy-grid">
      <div className="toggles">
        <Note>Wajib scan masuk dan pulang, tepat waktu tanpa toleransi. Semua dinas tidak mendapat UM.</Note>
        {toggle('parametersApproved', 'Parameter telah diverifikasi Keuangan', 'Sahkan hanya setelah jadwal, tarif, pajak dan kalender terkonfirmasi.')}
        {toggle('requireNoEarlyLeave', 'Pulang sebelum jadwal menggugurkan', 'Sen–Kam 16:00, Jumat 16:30.')}
        {toggle('countWfa', 'WFA dihitung hadir', 'Presensi WFA lewat aplikasi yang disetujui.')}
        {toggle('holdOnIssues', 'Tahan hari yang punya isu terbuka', 'Mis. dinas luar tapi scan di kantor, jam diisi manual.')}
        {toggle('includeNonAsn', 'Bayar pegawai non-ASN', 'NIP placeholder (0000…) di aplikasi HP.')}
      </div>
      <div className="rates">
        <table className="data"><thead><tr><th>Kelompok</th><th className="num">Tarif / hari</th><th className="num">PPh %</th></tr></thead>
          <tbody>{(['I', 'II', 'III', 'IV'] as GolGroup[]).map(g => <tr key={g}><td>Golongan {g}</td>
            <td className="num"><input type="number" step={1000} value={p.rates[g]} onChange={e => hr.setPolicy({ rates: { ...p.rates, [g]: Number(e.target.value) } })} /></td>
            <td className="num"><input type="number" step={1} value={p.pph[g]} onChange={e => hr.setPolicy({ pph: { ...p.pph, [g]: Number(e.target.value) } })} /></td></tr>)}</tbody></table>
        <label className="holidays"><span>Hari libur nasional & cuti bersama (draf — cocokkan dengan SKB)</span><textarea rows={3} value={p.holidays.join(', ')} onChange={e => hr.setPolicy({ holidays: e.target.value.split(/[\s,]+/).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v)) })} /></label>
      </div>
    </div>
  </Panel>
}
