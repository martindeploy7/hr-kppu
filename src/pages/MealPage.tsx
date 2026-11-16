import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AlertTriangle, ArrowDownUp, Clock, Download, Hourglass, ListChecks, Search, Settings2, Users, WalletCards, X } from 'lucide-react'
import { SubmissionPanel } from '../components/SubmissionPanel.tsx'
import { useHr } from '../state/HrData.tsx'
import { useAuth } from '../state/Auth.tsx'
import { reconcile, STATUS_LABEL, type DayRecord, type EmployeeMonth } from '../engine/reconcile.ts'
import { POLICY_PRESETS, type GolGroup, type MealPolicy } from '../engine/policy.ts'
import { createCoverageLookup } from '../engine/monthlyFlow.ts'
import { formatID, monthBounds, monthLabel } from '../engine/dates.ts'
import { downloadWorkbook } from '../lib/xlsx.ts'
import { fmt, money } from '../lib/format.ts'
import { DayDetail } from '../components/DayDetail.tsx'
import { WeekPicker } from '../components/WeekPicker.tsx'
import { Drawer, Kpi, Note, PageHeader, Panel, Seg, StatusChip } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'
import './meal.css'

type Outcome = 'ok' | 'late' | 'early' | 'duty' | 'leave' | 'absent' | 'incomplete' | 'nodata' | 'decision' | 'estimate' | 'other'
const OUTCOMES: { id: Outcome; label: string; color: string }[] = [
  { id: 'ok', label: 'Dapat UM', color: 'var(--ok)' },
  { id: 'estimate', label: 'Menunggu setoran', color: 'var(--money-estimate)' },
  { id: 'decision', label: 'Menunggu keputusan', color: 'var(--warn)' },
  { id: 'late', label: 'Terlambat', color: 'var(--danger)' },
  { id: 'early', label: 'Pulang cepat', color: 'var(--danger-line)' },
  { id: 'duty', label: 'Dinas/ST', color: 'var(--duty)' },
  { id: 'leave', label: 'Cuti/Sakit/Izin', color: 'var(--leave)' },
  { id: 'absent', label: 'Tidak hadir (TK)', color: 'color-mix(in srgb, var(--danger) 60%, var(--brand-navy))' },
  { id: 'incomplete', label: 'Scan tidak lengkap', color: 'var(--warn-line)' },
  { id: 'nodata', label: 'Tidak ada data', color: 'var(--idle-line)' },
  { id: 'other', label: 'Lainnya', color: 'var(--idle)' },
]
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map(o => [o.id, o.label])) as Record<Outcome, string>
const OUTCOME_COLOR = Object.fromEntries(OUTCOMES.map(o => [o.id, o.color])) as Record<Outcome, string>

function classify(d: DayRecord): Outcome | null {
  if (!d.workday || d.reviewState === 'future' || d.status === 'belum-berlangsung' || d.status === 'libur') return null
  const m = d.meal
  if (m.state === 'eligible') return 'ok'
  if (m.state === 'held') return m.estimate ? 'estimate' : 'decision'
  if (d.lateMin > 0 && m.reason.startsWith('Terlambat')) return 'late'
  if (m.reason.startsWith('Pulang')) return 'early'
  if (['dinas-luar', 'dinas-lokal', 'diklat'].includes(d.status)) return 'duty'
  if (['cuti', 'sakit', 'izin'].includes(d.status)) return 'leave'
  if (d.status === 'tanpa-keterangan') return 'absent'
  if (d.status === 'tidak-lengkap' || /tidak lengkap/i.test(m.reason)) return 'incomplete'
  if (d.reviewState === 'not-found' || d.status === 'tidak-ada-data') return 'nodata'
  return 'other'
}

type SortKey = 'nama' | 'mealDays' | 'heldDays' | 'bruto'

export function MealPage({ nav, toast }: { nav: Nav; toast: (m: string) => void }) {
  const hr = useHr()
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [office, setOffice] = useState('Semua')
  const [sort, setSort] = useState<SortKey>('nama')
  const [showPolicy, setShowPolicy] = useState(false)
  const [view, setView] = useState<'week' | 'month'>('week')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [detail, setDetail] = useState<EmployeeMonth | null>(null)
  const calculation = view === 'week' ? hr.weekRecon : hr.recon
  const months = calculation.months
  const offices = [...new Set(months.map(m => m.employee.kantor))].sort()
  const coverageLookup = useMemo(() => createCoverageLookup(hr.files), [hr.files])

  const presetImpact = useMemo(() => POLICY_PRESETS.map(p => {
    const policy = { ...hr.policy, ...p.patch }
    const r = reconcile(hr.files, hr.roster, monthBounds(hr.activePeriod || '2000-01'), policy, hr.resolutions, undefined, hr.dayReviews, coverageLookup)
    return { ...p, days: r.months.reduce((s, m) => s + m.mealDays, 0), bruto: r.months.reduce((s, m) => s + m.bruto, 0), active: (Object.keys(p.patch) as (keyof MealPolicy)[]).every(k => hr.policy[k] === p.patch[k]) }
  }), [hr.files, hr.roster, hr.activePeriod, hr.policy, hr.resolutions, hr.dayReviews, coverageLookup])

  const rows = months
    .filter(m => (office === 'Semua' || m.employee.kantor === office) && (!q || `${m.employee.nama} ${m.employee.nip} ${m.employee.unit}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === 'nama' ? a.employee.nama.localeCompare(b.employee.nama) : (b[sort] as number) - (a[sort] as number))
  const outcomeCounts = useMemo(() => {
    const c = {} as Record<Outcome, number>
    OUTCOMES.forEach(o => { c[o.id] = 0 })
    rows.forEach(m => m.days.forEach(d => { const o = classify(d); if (o) c[o] += 1 }))
    return c
  }, [rows])
  const outcomeTotal = OUTCOMES.reduce((s, o) => s + outcomeCounts[o.id], 0)
  const shown = outcome ? rows.filter(m => m.days.some(d => classify(d) === outcome)) : rows
  const total = (fn: (m: EmployeeMonth) => number) => rows.reduce((s, m) => s + fn(m), 0)
  const workdayTarget = total(m => m.workdays)
  const reviewedDays = total(m => m.reviewedDays)
  const flaggedDays = total(m => m.flaggedDays)
  const notFoundDays = total(m => m.notFoundDays)
  const grossReady = rows.every(m => !m.amountPendingDays)
  const taxReady = rows.every(m => m.nettoReady && !m.amountPendingDays)
  const noNip = rows.filter(m => !m.employee.nip && m.mealDays > 0).length
  const assumed = rows.filter(m => m.groupAssumed).length
  const heldExport = rows.reduce((s, m) => s + m.days.filter(d => d.meal.state === 'held' && d.meal.reason.includes('ekspor')).length, 0)
  const late = rows.reduce((s, m) => s + m.days.filter(d => d.meal.reason.startsWith('Terlambat')).length, 0)

  const exportXlsx = async () => {
    const period = view === 'week'
      ? `${calculation.period.start}–${calculation.period.end}${hr.weekSlice.crossesMonth && hr.weekScope === 'month-part' ? ` · bagian ${monthLabel(hr.activePeriod)} dari pekan ${hr.weekSlice.weekStart}–${hr.weekSlice.weekEnd}` : ''}`
      : monthLabel(hr.activePeriod)
    const head = ['No', 'Nama', 'NIP', 'NIKA', 'Kantor', 'Unit', 'Status', 'Jabatan', 'Golongan', 'Kelompok tarif', 'Hari kerja', 'Jumlah kehadiran', 'Hari uang makan', 'Hari ditahan', 'Tarif/hari', 'Bruto', 'PPh %', 'PPh', 'Netto', 'Catatan']
    const nominatif = rows.map((m, i) => [i + 1, m.employee.nama, m.employee.nip, m.employee.nika, m.employee.kantor, m.employee.unit, m.employee.statusKepegawaian, m.employee.jabatan, m.employee.golongan, `${m.group}${m.groupAssumed ? ' (belum diketahui)' : ''}`, m.workdays, m.present, m.mealDays, m.heldDays, m.amountPendingDays ? null : m.employee.rateHistory?.length ? 'Sesuai tarif harian' : m.rate, m.amountPendingDays ? null : m.bruto, m.amountPendingDays ? null : !m.nettoReady ? 'Belum ditetapkan' : m.employee.rateHistory?.length ? 'Sesuai tarif harian' : m.pphPct, m.amountPendingDays ? null : !m.nettoReady ? 'Belum ditetapkan' : m.pph, m.amountPendingDays ? null : !m.nettoReady ? 'Belum ditetapkan' : m.netto, [!m.employee.nip && 'NIP belum ada', m.heldDays && `${m.heldDays} hari ditahan`, m.noData && `${m.noData} hari tidak ditemukan`, m.amountPendingDays && `${m.amountPendingDays} hari tarif pending`, !m.nettoReady && 'PPh/netto belum ditetapkan'].filter(Boolean).join('; ')])
    const daily = rows.flatMap(m => m.days.filter(d => d.workday).map(d => [m.employee.nama, m.employee.nip, d.date, STATUS_LABEL[d.status], d.clockIn ?? '', d.clockOut ?? '', d.lateMin || '', d.meal.state === 'eligible' ? 'Ya' : d.meal.state === 'held' ? 'Ditahan' : 'Tidak', d.meal.reason, d.meal.amount, d.meal.taxPct ?? '', d.basis, [...new Set(d.evidence.map(e => e.kind))].join(' + ')]))
    const held = rows.flatMap(m => m.days.filter(d => d.meal.state === 'held').map(d => [m.employee.nama, m.employee.nip, d.date, d.meal.reason, d.issues.map(i => i.detail).join(' | ')]))
    const evidenceRows = hr.files.flatMap(file => file.evidence.filter(e => e.date >= calculation.period.start && e.date <= calculation.period.end && (office === 'Semua' || e.office === office)).map(e => [file.fileName, e.ref, e.kind, e.office, e.name, e.sourceValues?.identifier ?? '', e.ids.nip ?? '', e.ids.nika ?? '', e.ids.mesin ?? '', e.ids.appId ?? '', e.unit ?? '', e.sourceValues?.date ?? '', e.date, e.sourceValues?.mode ?? e.mode ?? e.codeLabel ?? '', e.sourceValues?.approval ?? e.approvalStatus ?? '', e.clockIn ?? '', e.clockOut ?? '', e.sourceValues?.scheduleStart ?? e.schedule?.start ?? '', e.sourceValues?.scheduleEnd ?? e.schedule?.end ?? '', e.sourceValues?.duration ?? '', e.sourceDurationMin ?? '', e.sourceValues?.minimumDuration ?? '', e.minimumDurationMin ?? '', e.lateMin ?? '', e.earlyMin ?? '', e.overtimeMin ?? '', e.targetPekerjaan ?? '', e.hasilPekerjaan ?? '', e.sourceValues?.exception ?? e.codeLabel ?? '', e.location ?? '', e.officePending ? 'Perlu konfirmasi' : 'Terpetakan']))
    const p = hr.policy
    const exportPeriod = view === 'week' ? `pekan_${hr.weekSlice.weekStart}` : hr.activePeriod
    await downloadWorkbook(`Daftar_Nominatif_Uang_Makan_${exportPeriod}${office !== 'Semua' ? `_${office.replace(/\s/g, '')}` : ''}.xlsx`, [
      { name: 'Nominatif', rows: [[`DAFTAR PROGRESIF UANG MAKAN — KOMISI PENGAWAS PERSAINGAN USAHA`], [`Periode ${period} · ${office === 'Semua' ? 'Seluruh KPPU' : office} · dibuat ${new Date().toLocaleString('id-ID')} oleh ${hr.reviewer}`], [], head, ...nominatif, [], ['', 'JUMLAH', '', '', '', '', '', '', '', '', '', total(m => m.present), total(m => m.mealDays), total(m => m.heldDays), '', grossReady ? total(m => m.bruto) : 'Pending', '', taxReady ? total(m => m.pph) : 'Belum ditetapkan', taxReady ? total(m => m.netto) : 'Belum ditetapkan']], widths: [5, 30, 20, 11, 11, 34, 12, 16, 10, 12, 9, 10, 10, 10, 10, 13, 7, 11, 13, 32] },
      { name: 'Rincian Harian', rows: [['Nama', 'NIP', 'Tanggal', 'Status', 'Masuk', 'Pulang', 'Terlambat (mnt)', 'Uang makan', 'Alasan', 'Nominal', 'PPh % efektif', 'Dasar status', 'Sumber'], ...daily], widths: [28, 20, 11, 22, 7, 7, 9, 10, 40, 10, 40, 22] },
      { name: 'Rincian Sumber', rows: [['Workbook', 'Rujukan sheet/baris/kolom', 'Jenis sumber', 'Kantor', 'Nama sumber', 'Identifier sumber', 'NIP/NI', 'NIKA', 'ID mesin', 'ID aplikasi', 'Unit', 'Tanggal asal', 'Tanggal normalisasi', 'Jenis/keterangan', 'Approval sumber', 'Jam masuk', 'Jam pulang', 'Jadwal masuk', 'Jadwal pulang', 'Durasi sumber', 'Durasi menit', 'Min. Durasi asal', 'Min. Durasi menit', 'Terlambat menit', 'Pulang cepat menit', 'Lembur menit', 'Target Pekerjaan', 'Hasil Pekerjaan', 'Pengecualian/kode', 'Lokasi', 'Status kantor'], ...evidenceRows], widths: [34, 34, 20, 18, 28, 22, 20, 14, 14, 14, 36, 20, 20, 20, 22, 12, 12, 12, 12, 15, 15, 15, 15, 14, 17, 12, 50, 50, 24, 28, 20] },
      { name: 'Ditahan', rows: [['Nama', 'NIP', 'Tanggal', 'Alasan', 'Detail isu'], ...held], widths: [28, 20, 11, 36, 80] },
      { name: 'Review Sumber', rows: [['Sumber', 'Jenis', 'ID catatan', 'Keputusan', 'Alasan', 'Reviewer', 'Waktu'], ...hr.files.flatMap(f => (f.recordReviews ?? []).filter(r => office === 'Semua' || (r.kind === 'evidence' ? f.evidence : f.assignments).some(record => record.id === r.recordId && record.office === office)).map(r => [f.id, r.kind, r.recordId, r.disposition, r.reason, r.reviewer, r.at]))], widths: [32, 14, 32, 14, 60, 24, 26] },
      { name: 'Parameter', rows: [['Parameter', 'Nilai'], ['Batas kedatangan pukul 08:00', p.arrivalBoundary === 'inclusive' ? '≤ 08:00:00' : p.arrivalBoundary === 'exclusive' ? '< 08:00:00' : 'Belum ditetapkan; tepat 08:00 ditahan'], ['Tarif pokok UM diverifikasi', p.parametersApproved ? 'Ya' : 'Belum'], ['PPh/netto disahkan', p.taxParametersApproved ? 'Ya' : 'Belum; netto tidak dihitung'], ['Wajib scan masuk & pulang', p.requireComplete ? 'Ya' : 'Tidak'], ['Wajib tepat waktu', p.requireOnTime ? `Ya (toleransi ${p.lateToleranceMin} mnt)` : 'Tidak'], ['Pulang cepat menggugurkan', p.requireNoEarlyLeave ? 'Ya' : 'Tidak'], ['WFA dihitung', p.countWfa ? 'Ya' : 'Tidak'], ['Dinas lokal ≤ 8 jam dihitung', p.countLocalDuty ? 'Ya' : 'Tidak'], ['Tahan bila ada isu', p.holdOnIssues ? 'Ya' : 'Tidak'], ['Non-ASN dibayar', p.includeNonAsn ? 'Ya' : 'Tidak'], ...(['I', 'II', 'III', 'IV'] as GolGroup[]).map(g => [`Tarif gol. ${g}`, `${p.rates[g]}${p.taxParametersApproved ? ` · PPh ${p.pph[g]}%` : ''}`]), ['Golongan kosong', 'Tarif pending; tanpa fallback'], ['Revisi workspace', String(hr.revision)], ['Filter pencarian', q], ['Versi kalkulasi', '2.1.0'], ...hr.files.map(f => [`Sumber r${f.revision ?? 1}: ${f.fileName}`, `${f.hash ?? 'legacy'} · ${f.id}`]), ['Catatan', 'Tarif UM sesuai ketetapan pengguna. PPh/netto belum ditetapkan dan tetap pending sampai disahkan tersendiri.']], widths: [36, 50] },
    ])
    toast('Daftar nominatif diunduh')
  }

  return <div className="page meal-page">
    <PageHeader kicker={`Uang makan · ${view === 'week' ? `${formatID(calculation.period.start, { short: true })}–${formatID(calculation.period.end, { short: true })}` : monthLabel(hr.activePeriod)}`} title="Perhitungan uang makan" actions={<>{view === 'week' && <WeekPicker />}<Seg label="Periode hasil" value={view} onChange={setView} options={[{ value: 'week', label: 'Pekan terpilih' }, { value: 'month', label: 'Akumulasi bulan' }]} />{['admin', 'superadmin'].includes(user.role) && <button className="btn secondary" onClick={() => setShowPolicy(v => !v)}><Settings2 size={15} /> Aturan & tarif</button>}<button className="btn primary" onClick={exportXlsx}><Download size={15} /> Unduh daftar nominatif</button></>}>
      Hari tanpa clash divalidasi otomatis; hari dengan clash menunggu keputusan di Rekonsiliasi. Nominal final muncul setelah ketiga sumber pekan (Offline, Online, ST) disetor, sebelumnya tampil sebagai perkiraan.
    </PageHeader>

    {view === 'month' ? <SubmissionPanel /> : <Note>Setoran dan review mingguan terakumulasi pada periode {monthLabel(hr.activePeriod)}. Pengajuan nominatif tetap dilakukan melalui tampilan akumulasi bulan.</Note>}
    <section className="meal-hero">
      <div className="mh-card mh-final"><span className="mh-label"><WalletCards size={14} /> UM final</span><strong>{grossReady ? money.format(total(m => m.bruto)) : 'Pending'}</strong><small>{taxReady ? `Netto ${money.format(total(m => m.netto))} · PPh ${money.format(total(m => m.pph))}` : 'Hari tanpa clash dan setoran lengkap; PPh/netto belum ditetapkan'}</small></div>
      <div className="mh-card mh-est"><span className="mh-label"><Hourglass size={14} /> UM perkiraan</span><strong>{money.format(total(m => m.estimateBruto))}</strong><small>{fmt.format(total(m => m.estimateDays))} hari menunggu setoran lengkap</small></div>
      <div className="mh-card"><span className="mh-label"><ListChecks size={14} /> Hari UM</span><strong>{fmt.format(total(m => m.mealDays))}</strong><small>{fmt.format(total(m => m.heldDays))} hari ditahan · <button className="link" onClick={() => nav('reconcile')}>keputusan</button></small></div>
      <div className="mh-card"><span className="mh-label"><Users size={14} /> Pegawai penerima</span><strong>{rows.filter(m => m.mealDays > 0).length}</strong><small>dari {rows.length} pegawai</small></div>
    </section>

    <div className="meal-split">
      <Panel title="Kenapa tidak dapat UM" sub="Hari-orang per hasil. Klik segmen atau legenda untuk memfilter tabel.">
        {outcomeTotal === 0 ? <p className="muted">Belum ada hari kerja yang berlangsung pada periode ini. Hasil muncul setelah pekan dimulai dan setoran masuk.</p> : <>
          <div className="why-bar" role="group" aria-label="Distribusi hasil hari kerja">{OUTCOMES.filter(o => outcomeCounts[o.id] > 0).map(o => <button key={o.id} type="button" className={`why-seg ${outcome === o.id ? 'on' : ''} ${outcome && outcome !== o.id ? 'dim' : ''}`} style={{ flexGrow: outcomeCounts[o.id], background: o.color }} title={`${o.label}: ${outcomeCounts[o.id]} hari`} aria-label={`${o.label}: ${outcomeCounts[o.id]} hari`} aria-pressed={outcome === o.id} onClick={() => setOutcome(outcome === o.id ? null : o.id)} />)}</div>
          <div className="why-legend">{OUTCOMES.filter(o => outcomeCounts[o.id] > 0).map(o => <button key={o.id} type="button" className={`why-item ${outcome === o.id ? 'on' : ''}`} aria-pressed={outcome === o.id} onClick={() => setOutcome(outcome === o.id ? null : o.id)}><i style={{ background: o.color }} />{o.label}<b>{fmt.format(outcomeCounts[o.id])}</b><em>{Math.round(outcomeCounts[o.id] / outcomeTotal * 100)}%</em></button>)}</div>
        </>}
      </Panel>
      <Panel title="Aturan aktif" aside={['admin', 'superadmin'].includes(user.role) ? <button className="btn secondary" onClick={() => setShowPolicy(true)}><Settings2 size={14} /> Ubah aturan & tarif</button> : undefined}>
        <div className="rule-chips">
          <span className={`tone-chip ${hr.policy.arrivalBoundary ? 'tone-ok' : 'tone-warn'}`}><Clock size={12} /> {hr.policy.arrivalBoundary === 'inclusive' ? 'Masuk ≤ 08:00' : hr.policy.arrivalBoundary === 'exclusive' ? 'Masuk < 08:00' : 'Batas 08:00 belum ditetapkan'}</span>
          <span className="tone-chip tone-info">Scan masuk & pulang lengkap</span>
          {hr.policy.requireNoEarlyLeave && <span className="tone-chip tone-info">Pulang ≥ 16:00 (Jum 16:30)</span>}
          <span className="tone-chip tone-duty">Dinas/ST tidak dihitung</span>
          <span className={`tone-chip ${hr.policy.countWfa ? 'tone-ok' : 'tone-idle'}`}>WFA {hr.policy.countWfa ? 'dihitung' : 'tidak dihitung'}</span>
          <span className="tone-chip tone-leave">Cuti/sakit tidak dihitung</span>
        </div>
        <div className="rate-row">{(['I', 'II', 'III', 'IV'] as GolGroup[]).map(g => <div key={g}><span>Gol. {g}</span><strong>{money.format(hr.policy.rates[g])}</strong></div>)}</div>
      </Panel>
    </div>

    {user.role === 'superadmin' && <Panel title="Dampak pilihan aturan" sub="Aturan: scan masuk paling lambat 08:00 dan pulang tidak sebelum jadwal (Sen–Kam 16:00, Jumat 16:30).">
      <div className="presets">{presetImpact.map(p => <button key={p.id} className={`preset ${p.active ? 'on' : ''}`} onClick={() => hr.setPolicy(p.patch)}>
        <strong>{p.label}</strong><small>{p.detail}</small>
        <span>{fmt.format(p.days)} hari · Bruto {money.format(p.bruto)}</span>
      </button>)}</div>
    </Panel>}

    {showPolicy && <PolicyEditor />}

    {(noNip > 0 || assumed > 0) && <Note tone="warn">
      {noNip > 0 && <><strong>{noNip} pegawai</strong> berhak uang makan tetapi belum punya NIP (hanya dari sumber Kanwil). </>}
      {assumed > 0 && <><strong>{assumed} pegawai</strong> belum memiliki data golongan; nominal belum siap dan tidak menggunakan fallback. Lengkapi golongan lewat Tambah Data (Impor massal) agar tarif & PPh tepat.</>}
    </Note>}

    <Panel title="Daftar nominatif" sub="Klik baris untuk melihat alasan per hari." aside={outcome ? <button className="tone-chip tone-info meal-clear" onClick={() => setOutcome(null)}>Filter: {OUTCOME_LABEL[outcome]} · {shown.length} pegawai <X size={12} /> Hapus</button> : undefined}>
      <div className="toolbar">
        <label className="search"><Search size={15} /><input placeholder="Cari nama, NIP, unit…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <select className="select" value={office} onChange={e => setOffice(e.target.value)} aria-label="Kantor"><option>Semua</option>{offices.map(o => <option key={o}>{o}</option>)}</select>
        <label className="select-label"><ArrowDownUp size={14} /><select className="select" value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Urutkan"><option value="nama">Nama</option><option value="mealDays">Hari UM terbanyak</option><option value="heldDays">Ditahan terbanyak</option><option value="bruto">Bruto terbesar</option></select></label>
      </div>
      <div className="table-wrap tall"><table className="data clickable meal-table">
        <thead><tr><th>Pegawai</th><th>Golongan → tarif</th><th>Hari kerja</th><th className="num">Hari UM</th><th className="num">Nominal</th></tr></thead>
        <tbody>{shown.map(m => <tr key={m.employee.id} onClick={() => setDetail(m)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setDetail(m)}>
          <td><strong>{m.employee.nama}</strong><small>{m.employee.nip || <span className="warn-text"><AlertTriangle size={11} /> tanpa NIP</span>} · {m.employee.kantor}</small></td>
          <td>{m.employee.golongan || '—'} → <b>{m.amountPendingDays || m.groupAssumed ? 'tarif pending' : m.employee.rateHistory?.length ? 'tarif harian' : money.format(m.rate)}</b><small>{m.groupAssumed ? 'Kelompok belum diketahui' : `Kelompok ${m.group}`}</small></td>
          <td><div className="day-strip">{m.days.filter(d => d.workday).map(d => { const o = classify(d); const c = o ? OUTCOME_COLOR[o] : 'transparent'; return <i key={d.date} className={o ? '' : 'future'} style={{ background: c }} title={`${formatID(d.date, { short: true })} · ${o ? OUTCOME_LABEL[o] : 'Belum berlangsung'}${d.meal.reason ? ` — ${d.meal.reason}` : ''}`} /> })}</div></td>
          <td className="num strong">{m.mealDays}{m.heldDays ? <small className="held">{m.heldDays} ditahan</small> : null}</td>
          <td className="num">{m.amountPendingDays ? 'Pending' : <strong className="money-final">{money.format(m.bruto)}</strong>}{m.estimateBruto > 0 && <small className="money-est">+ perkiraan {money.format(m.estimateBruto)}</small>}</td>
        </tr>)}{shown.length === 0 && <tr><td colSpan={5} className="muted">Tidak ada pegawai yang cocok. Ubah pencarian atau kantor{outcome ? ', atau hapus filter hasil di atas' : ''}.</td></tr>}</tbody>
        <tfoot><tr><td>Jumlah ({shown.length} pegawai)</td><td /><td /><td className="num">{fmt.format(shown.reduce((s, m) => s + m.mealDays, 0))}</td><td className="num">{money.format(shown.reduce((s, m) => s + m.bruto, 0))}</td></tr></tfoot>
      </table></div>
    </Panel>

    <AnimatePresence>{detail && <Drawer wide label="Rincian uang makan" onClose={() => setDetail(null)}>{(() => { const current = months.find(m => m.employee.id === detail.employee.id); return current ? <MealDetail month={current} /> : <p className="muted">Pegawai ini tidak lagi ada pada roster aktif periode ini setelah perubahan sumber. Tutup rincian untuk memeriksa perhitungan terbaru.</p> })()}</Drawer>}</AnimatePresence>
  </div>
}

function MealDetail({ month }: { month: EmployeeMonth }) {
  const [open, setOpen] = useState<string | null>(null)
  return <>
    <div className="drawer-head"><span className="page-kicker">Rincian uang makan</span><h2>{month.employee.nama}</h2><p>{month.employee.nip || 'Tanpa NIP'} · {month.employee.kantor} · gol. {month.employee.golongan || `Belum diketahui`}</p></div>
    <div className="mini-kpis"><div><span>Hari UM</span><strong>{month.mealDays}</strong></div><div><span>Ditahan</span><strong>{month.heldDays}</strong></div><div><span>Bruto</span><strong>{month.amountPendingDays ? 'Pending' : money.format(month.bruto)}</strong></div><div><span>Netto</span><strong>{month.amountPendingDays ? 'Pending' : !month.nettoReady ? 'Belum ditetapkan' : money.format(month.netto)}</strong></div></div>
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
  const { user } = useAuth()
  const p = hr.policy
  const canEdit = user.role === 'superadmin'
  const toggle = (k: keyof MealPolicy, label: string, help: string) => <label className="toggle-row"><input type="checkbox" disabled={!canEdit} checked={p[k] as boolean} onChange={e => hr.setPolicy({ [k]: e.target.checked } as Partial<MealPolicy>)} /><span><strong>{label}</strong><small>{help}</small></span></label>
  return <Panel title="Aturan & tarif" sub="Tarif bruto mengikuti ketetapan pengguna. PPh dan netto tetap belum ditetapkan sampai parameter pajak disahkan terpisah.">
    <div className="policy-grid">
      <div className="toggles">
        <Note>Aturan selain tarif dan hak WFA tetap mengikuti parameter yang perlu disahkan.</Note>
        <label className="toggle-row"><span><strong>Batas kedatangan pukul 08:00</strong><small>{p.arrivalBoundary ? 'Diterapkan ke semua hari dengan waktu masuk.' : 'Belum ditetapkan.'}</small></span><select className="select" aria-label="Batas kedatangan pukul 08:00" disabled={!canEdit} value={p.arrivalBoundary ?? ''} onChange={e => hr.setPolicy({ arrivalBoundary: e.target.value ? e.target.value as NonNullable<MealPolicy['arrivalBoundary']> : undefined })}><option value="">Belum ditetapkan</option><option value="exclusive">Harus sebelum 08:00 (&lt;)</option><option value="inclusive">Termasuk tepat pukul 08:00 (≤ 08:00:00)</option></select></label>
        {!p.arrivalBoundary && <Note tone="warn">Pengesahan parameter tetap nonaktif sampai operator batas 08:00 dipilih.</Note>}
        {toggle('parametersApproved', 'Parameter uang makan telah diverifikasi', 'Sahkan setelah operator batas 08:00, jadwal kerja, tarif bruto dan kalender dikonfirmasi.')}
        {toggle('taxParametersApproved', 'Parameter PPh/netto telah disahkan', 'PPh dan netto baru dihitung setelah aturan pajak resmi disahkan; angka awal tidak digunakan otomatis.')}
        {toggle('requireNoEarlyLeave', 'Pulang sebelum jadwal menggugurkan', 'Sen–Kam 16:00, Jumat 16:30.')}
        {toggle('countWfa', 'WFA dihitung hadir', 'Presensi WFA lewat aplikasi yang disetujui.')}
        {toggle('holdOnIssues', 'Tahan hari yang punya isu terbuka', 'Mis. dinas luar tapi scan di kantor, jam diisi manual.')}
        {toggle('includeNonAsn', 'Bayar pegawai non-ASN', 'NIP placeholder (0000…) di aplikasi HP.')}
      </div>
      <div className="rates">
        <p className="muted small">Tarif UM mengikuti ketetapan KPPU.</p>
        <details className="meal-how"><summary>Cara kerja PPh</summary><p className="muted small">PPh tidak termasuk ketetapan tersebut. Nilai awal 0% hanyalah kolom draf dan tidak dipakai sampai diubah sesuai aturan resmi lalu disahkan.</p></details>
        <table className="data"><thead><tr><th>Kelompok</th><th className="num">Tarif / hari</th><th className="num">PPh % (draf)</th></tr></thead>
          <tbody>{(['I', 'II', 'III', 'IV'] as GolGroup[]).map(g => <tr key={g}><td>Golongan {g}</td>
            <td className="num"><input disabled={!canEdit} type="number" step={1000} value={p.rates[g]} onChange={e => hr.setPolicy({ rates: { ...p.rates, [g]: Number(e.target.value) } })} /></td>
            <td className="num"><input disabled={!canEdit} type="number" step={1} value={p.pph[g]} onChange={e => hr.setPolicy({ pph: { ...p.pph, [g]: Number(e.target.value) } })} /></td></tr>)}</tbody></table>
        <label className="holidays"><span>Hari libur nasional & cuti bersama (draf, cocokkan dengan SKB)</span><textarea disabled={!canEdit} rows={3} value={p.holidays.join(', ')} onChange={e => hr.setPolicy({ holidays: e.target.value.split(/[\s,]+/).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v)) })} /></label>
      </div>
    </div>
  </Panel>
}
