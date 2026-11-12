import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, Clock3, Globe2, Hourglass, Printer, ScrollText, Upload, WalletCards, CalendarCheck2 } from 'lucide-react'
import { useAuth } from '../state/Auth.tsx'
import { useHr } from '../state/HrData.tsx'
import { formatID, monthLabel, weeksInMonth } from '../engine/dates.ts'
import { createCoverageLookup, inspectSourceCoverage, type CoverageSource } from '../engine/monthlyFlow.ts'
import { reconcile } from '../engine/reconcile.ts'
import { money, fmt } from '../lib/format.ts'
import { Note, PageHeader, Seg } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'
import { ImportPage, type UploadRequest } from './ImportPage.tsx'
import { WeekPicker } from '../components/WeekPicker.tsx'

const SOURCES: CoverageSource[] = ['offline', 'online', 'surat-tugas']
const SRC_LABEL: Record<CoverageSource, string> = { offline: 'Mesin Offline', online: 'Mesin Online', 'surat-tugas': 'Rekap ST' }
const SRC_ICON = { offline: Printer, online: Globe2, 'surat-tugas': ScrollText } as const
type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'idle'

export function AttendanceOverview({ nav, toast }: { nav: Nav; toast: (message: string) => void }) {
  const hr = useHr()
  const { user } = useAuth()
  const [request, setRequest] = useState<UploadRequest>()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const weeks = useMemo(() => weeksInMonth(hr.activePeriod), [hr.activePeriod])
  const lookup = useMemo(() => createCoverageLookup(hr.files), [hr.files])
  const rows = useMemo(() => weeks.map(slice => {
    const coverage = inspectSourceCoverage(hr.files, slice.displayStart, slice.displayEnd)
    const calc = reconcile(hr.files, hr.roster, { start: slice.displayStart, end: slice.displayEnd }, hr.policy, hr.resolutions, undefined, hr.dayReviews, lookup)
    const clashes = calc.months.reduce((n, e) => n + e.days.filter(d => d.workday && d.reviewState === 'flag').length, 0)
    const final = calc.months.reduce((n, e) => n + e.bruto, 0)
    const estimate = calc.months.reduce((n, e) => n + (e.estimateBruto ?? 0), 0)
    const elapsed = slice.displayEnd < today
    const future = slice.displayStart > today
    const complete = coverage.every(c => c.ready)
    const missing = coverage.filter(c => !c.ready).map(c => c.source)
    const status: { label: string; tone: Tone } = future ? { label: 'Belum dimulai', tone: 'idle' }
      : !elapsed ? { label: 'Berjalan', tone: 'info' }
      : !complete ? { label: 'Perlu setoran', tone: 'danger' }
      : clashes ? { label: 'Perlu keputusan', tone: 'warn' }
      : { label: 'Selesai', tone: 'ok' }
    return { slice, coverage, clashes, final, estimate, elapsed, future, complete, missing, status }
  }), [weeks, hr.files, hr.roster, hr.policy, hr.resolutions, hr.dayReviews, lookup, today])

  const selected = rows.find(r => r.slice.weekStart === hr.weekSlice.weekStart) ?? rows[0]
  const elapsedRows = rows.filter(r => r.elapsed)
  const completeCount = elapsedRows.filter(r => r.complete).length
  const totalClash = rows.reduce((n, r) => n + r.clashes, 0)
  const totalFinal = hr.recon.months.reduce((n, e) => n + e.bruto, 0)
  const totalEstimate = rows.reduce((n, r) => n + r.estimate, 0)
  const pct = elapsedRows.length ? Math.round(completeCount / elapsedRows.length * 100) : 0
  const dateLabel = (start: string, end: string) => `${formatID(start, { short: true, year: false })}–${formatID(end, { short: true })}`

  const openSource = (weekStart: string, source: CoverageSource) => {
    hr.selectWeek(weekStart)
    setRequest({ source, nonce: Date.now() })
  }

  const lateRow = rows.find(r => r.elapsed && !r.complete)
  const banner = lateRow
    ? { tone: 'danger' as Tone, icon: AlertTriangle, title: `Pekan ${lateRow.slice.index} (${dateLabel(lateRow.slice.displayStart, lateRow.slice.displayEnd)}) belum lengkap`, text: `Belum disetor: ${lateRow.missing.map(s => SRC_LABEL[s]).join(', ')}.`, label: `Unggah ${SRC_LABEL[lateRow.missing[0]]}`, icon2: Upload, act: () => openSource(lateRow.slice.weekStart, lateRow.missing[0]), hide: user.role !== 'superadmin' }
    : selected.clashes
      ? { tone: 'warn' as Tone, icon: Clock3, title: `${fmt.format(selected.clashes)} clash menunggu keputusan di pekan ${selected.slice.index}`, text: 'Putuskan clash agar uang makan pekan ini final.', label: 'Buka Rekonsiliasi', icon2: ArrowRight, act: () => nav('reconcile') }
      : totalClash
        ? { tone: 'warn' as Tone, icon: Clock3, title: `${fmt.format(totalClash)} clash menunggu keputusan di bulan ini`, text: 'Pekan lain masih punya clash. Buka Rekonsiliasi untuk memutuskannya.', label: 'Buka Rekonsiliasi', icon2: ArrowRight, act: () => nav('reconcile') }
        : rows.some(r => !r.elapsed && !r.future)
          ? { tone: 'info' as Tone, icon: Hourglass, title: 'Pekan berjalan', text: 'Setor tiga file setelah pekan ini selesai. Semua pekan yang sudah lewat lengkap.', label: 'Lihat Uang Makan', icon2: ArrowRight, act: () => nav('meal') }
          : { tone: 'ok' as Tone, icon: CheckCircle2, title: 'Semua setoran lengkap, tidak ada clash', text: 'Uang makan bulan ini siap ditinjau.', label: 'Lihat Uang Makan', icon2: ArrowRight, act: () => nav('meal') }
  const BannerIcon = banner.icon
  const BannerAct = banner.icon2

  const sourceChip = (row: typeof rows[number], source: CoverageSource) => {
    const c = row.coverage.find(x => x.source === source)!
    let tone: Tone, text: string
    if (c.ready) { tone = c.state === 'complete' ? 'ok' : 'info'; text = c.state === 'complete' ? `Disetor${c.files ? ` (${c.files})` : ''}` : c.state === 'nil' ? 'Nihil' : 'Tidak ada data' }
    else if (c.state === 'missing') { tone = row.elapsed ? 'danger' : 'idle'; text = row.elapsed ? 'Belum disetor' : '—' }
    else { tone = 'warn'; text = c.state === 'partial' ? 'Sebagian' : 'Belum dinyatakan' }
    return { tone, text, ready: c.ready }
  }

  return <div className="page submission-workspace setoran-page">
    <PageHeader kicker={monthLabel(hr.activePeriod)} title="Setoran & review" actions={<button className="btn secondary" onClick={() => nav('reconcile')}>Lanjutkan rekonsiliasi</button>}>
      Pantau tiga setoran mingguan seluruh KPPU, lalu lanjutkan ke rekonsiliasi dan uang makan.
    </PageHeader>

    <section className="hero-tiles" aria-label={`Ringkasan ${monthLabel(hr.activePeriod)}`}>
      <div className="hero-tile tile-info"><span className="tile-label"><CalendarCheck2 size={15} /> Pekan lengkap</span>
        <strong>{completeCount}/{elapsedRows.length}</strong><div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Pekan lengkap"><i style={{ width: `${pct}%` }} /></div><small>dari {rows.length} pekan bulan ini · {rows.length - elapsedRows.length} belum lewat</small></div>
      <button type="button" className={`hero-tile tile-${totalClash ? 'warn' : 'ok'}`} onClick={() => nav('reconcile')}><span className="tile-label"><Clock3 size={15} /> Clash menunggu</span>
        <strong>{fmt.format(totalClash)}</strong><small>{totalClash ? 'Buka Rekonsiliasi' : 'Tidak ada yang menunggu'} <ArrowRight size={12} /></small></button>
      <button type="button" className="hero-tile tile-ok" onClick={() => nav('meal')}><span className="tile-label"><WalletCards size={15} /> UM final</span>
        <strong>{money.format(totalFinal)}</strong><small>Hari yang sudah sah <ArrowRight size={12} /></small></button>
      <div className="hero-tile tile-warn"><span className="tile-label"><Hourglass size={15} /> UM perkiraan</span>
        <strong>{money.format(totalEstimate)}</strong><small>Menunggu setoran pekan terkait</small></div>
    </section>

    <section className={`next-banner tone-${banner.tone}`} aria-label="Langkah berikutnya">
      <BannerIcon size={22} />
      <div><span className="next-kicker">Langkah berikutnya</span><strong>{banner.title}</strong><p>{banner.text}</p></div>
      {!banner.hide && <button type="button" className="btn primary" onClick={banner.act}>{banner.label} <BannerAct size={15} /></button>}
    </section>

    <section className="month-board" aria-label="Papan setoran bulan">
      <div className="board-head"><h3>Papan {monthLabel(hr.activePeriod)}</h3><span className="muted small">Klik sumber untuk membuka unggah pekan itu</span></div>
      <div className="board-scroll">
        <div className="board-row board-cols board-th" role="row"><span>Pekan</span><span>Offline</span><span>Online</span><span>ST</span><span>Clash</span><span>UM</span></div>
        {rows.map(row => {
          const isSel = row.slice.weekStart === hr.weekSlice.weekStart
          return <div key={row.slice.weekStart} className={`board-row board-cols ${isSel ? 'selected' : ''}`}>
            <button type="button" className="week-cell" onClick={() => hr.selectWeek(row.slice.weekStart)} aria-pressed={isSel}>
              <strong>Pekan {row.slice.index}</strong>
              <small>{dateLabel(row.slice.displayStart, row.slice.displayEnd)}{row.slice.crossesMonth ? ' · lintas bulan' : ''}</small>
              <span className={`tone-chip tone-${row.status.tone}`}>{row.status.label}</span>
            </button>
            {SOURCES.map(source => {
              const chip = sourceChip(row, source)
              const Icon = SRC_ICON[source]
              return <button type="button" key={source} className={`src-cell src-${source}`} onClick={() => openSource(row.slice.weekStart, source)} aria-label={`${SRC_LABEL[source]} pekan ${row.slice.index}: ${chip.text}`}>
                <span className={`tone-chip tone-${chip.tone}`}><Icon size={12} /> {chip.text}</span>
              </button>
            })}
            <span className="num-cell" data-label="Clash">{row.future ? <span className="muted">—</span> : <span className={`tone-chip tone-${row.clashes ? 'warn' : 'ok'}`}>{row.clashes ? `${row.clashes} menunggu` : 'Nol'}</span>}</span>
            <span className="num-cell" data-label="UM"><strong>{money.format(row.final)}</strong>{row.estimate > 0 && <small>+ {money.format(row.estimate)} perkiraan</small>}</span>
          </div>
        })}
      </div>
    </section>

    <div className="toolbar"><WeekPicker /><Seg label="Cakupan tampilan" value={hr.weekScope} onChange={value => hr.setWeekScope(value as 'month-part' | 'full')} options={[{ value: 'month-part', label: 'Bagian bulan' }, { value: 'full', label: 'Pekan penuh' }]} /></div>
    {hr.roster.employees.length === 0 && <Note tone="warn"><CircleHelp size={14} /> Impor master pegawai terlebih dahulu agar roster dan denominator review sesuai pegawai aktif.</Note>}

    <ImportPage nav={nav} toast={toast} request={request} clashCount={selected.clashes} />
  </div>
}
