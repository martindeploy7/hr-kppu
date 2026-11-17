import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ArrowRight, CheckCircle2, ClipboardCheck, Cpu, Database, FileText, Globe, PartyPopper, RotateCcw, Search, ShieldCheck, Swords, UploadCloud, Wallet } from 'lucide-react'
import { useHr } from '../state/HrData.tsx'
import { useAuth } from '../state/Auth.tsx'
import type { Issue, IssueType, Resolution, Severity } from '../engine/types.ts'
import { ISSUE_LABEL, STATUS_LABEL, type DayRecord, type EmployeeMonth } from '../engine/reconcile.ts'
import { addDays, dayName, eachDay, formatID, isWeekend } from '../engine/dates.ts'
import { fmt, money } from '../lib/format.ts'
import { DayDetail } from '../components/DayDetail.tsx'
import { WeekPicker } from '../components/WeekPicker.tsx'
import { Drawer, Empty, Note, PageHeader, Panel, Seg, SeverityPill, STATUS_SHORT } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'
import './reconcile.css'

type Case = { id: string; type: IssueType; severity: Severity; month: EmployeeMonth; issues: Issue[]; dates: string[]; resolved: boolean }
const SEV_RANK: Record<Severity, number> = { tinggi: 0, sedang: 1, rendah: 2 }

const ACTIONS: Partial<Record<IssueType, { decision: Resolution['decision']; label: string; tone?: 'primary' }[]>> = {
  'scan-berbeda': [{ decision: 'akui-hadir', label: 'Pakai jam mesin offline', tone: 'primary' }, { decision: 'akui-dinas', label: 'Dinas yang valid (tanpa UM)' }, { decision: 'tidak-hadir', label: 'Tidak hadir / tidak sah' }],
  'status-berbeda': [{ decision: 'akui-dinas', label: 'ST/dinas yang valid (tanpa UM)', tone: 'primary' }, { decision: 'akui-hadir', label: 'Absensi hadir yang valid' }, { decision: 'tidak-hadir', label: 'Tidak hadir / tidak sah' }],
  'dinas-vs-scan-kantor': [{ decision: 'akui-dinas', label: 'Akui dinas (scan tidak dihitung)', tone: 'primary' }, { decision: 'akui-hadir', label: 'Akui hadir di kantor' }],
  'cuti-vs-hadir': [{ decision: 'valid', label: 'Tetap cuti/sakit', tone: 'primary' }, { decision: 'akui-hadir', label: 'Akui hadir (cuti dibatalkan)' }],
  'st-tumpang-tindih': [{ decision: 'valid', label: 'Sudah diklarifikasi: satu ST berlaku', tone: 'primary' }, { decision: 'akui-dinas', label: 'Keduanya sah (ST berurutan)' }],
  'pd-tanpa-st': [{ decision: 'valid', label: 'ST ada / dinas sah', tone: 'primary' }, { decision: 'tidak-hadir', label: 'Tidak sah → tanpa keterangan' }],
  'wfo-di-luar-kantor': [{ decision: 'valid', label: 'Lokasi dapat diterima', tone: 'primary' }, { decision: 'tidak-hadir', label: 'Presensi tidak sah' }],
  'jam-duplikat': [{ decision: 'valid', label: 'Jam sudah diverifikasi', tone: 'primary' }, { decision: 'tidak-hadir', label: 'Tidak sah' }],
  'jam-manual': [{ decision: 'valid', label: 'Bukti pendukung ada', tone: 'primary' }, { decision: 'tidak-hadir', label: 'Tidak sah' }],
  'st-tanpa-nomor': [{ decision: 'valid', label: 'Nomor ST sudah dikonfirmasi', tone: 'primary' }],
}

const TYPE_TONE: Partial<Record<IssueType, string>> = {
  'dinas-vs-scan-kantor': 'tone-duty', 'status-berbeda': 'tone-danger', 'scan-berbeda': 'tone-warn', 'cuti-vs-hadir': 'tone-leave', 'st-tumpang-tindih': 'tone-duty',
}
const typeTone = (t: IssueType) => TYPE_TONE[t] ?? 'tone-idle'

export function ReconcilePage({ nav, toast, focus }: { nav: Nav; toast: (m: string) => void; focus?: string }) {
  const hr = useHr()
  const { user } = useAuth()
  const [tab, setTab] = useState<'issues' | 'matrix'>('issues')
  const [scope, setScope] = useState<'clash' | 'all'>('clash')
  const [state, setState] = useState<'open' | 'resolved'>('open')
  const [type, setType] = useState<'all' | IssueType>('all')
  const [office, setOffice] = useState('Semua')
  const [q, setQ] = useState(focus ?? '')
  const [limit, setLimit] = useState(20)
  const [openCase, setOpenCase] = useState<string | null>(null)
  const [openDay, setOpenDay] = useState<{ emp: string; date: string } | null>(null)
  const queueHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => setLimit(20), [state, type, office, q, scope])

  const resolvedIds = useMemo(() => new Set(hr.resolutions.map(r => r.issueId)), [hr.resolutions])
  const monthById = useMemo(() => new Map(hr.weekRecon.months.map(m => [m.employee.id, m])), [hr.weekRecon.months])
  const clashCases = useMemo(() => buildCases(clashIssues(hr.weekRecon.issues), monthById, resolvedIds, false), [hr.weekRecon.issues, monthById, resolvedIds])
  const allCases = useMemo(() => buildCases(hr.weekRecon.issues, monthById, resolvedIds, true), [hr.weekRecon.issues, monthById, resolvedIds])
  const cases = scope === 'clash' ? clashCases : allCases
  const editable = user.role === 'superadmin' || user.role === 'admin'
  const { autoValid, noData, nameHeld } = useMemo(() => hr.weekRecon.months.reduce((n, m) => {
    for (const d of m.days) {
      if (d.autoValidated) n.autoValid++
      if (d.workday && d.reviewState === 'not-found') n.noData++
      // Tertahan karena nama peserta ST belum dicocokkan: tidak ada isu pemblokir, jadi tidak muncul di antrean clash.
      if (d.workday && d.reviewState === 'flag' && !d.issues.some(i => i.blocksMeal) && d.meal.reason.startsWith('Nama "')) n.nameHeld++
    }
    return n
  }, { autoValid: 0, noData: 0, nameHeld: 0 }), [hr.weekRecon.months])
  const offices = [...new Set(hr.weekRecon.months.map(m => m.employee.kantor))].sort()

  const clashTotal = clashCases.length
  const clashDone = clashCases.filter(c => c.resolved).length
  const clashOpen = clashTotal - clashDone
  const pctDone = clashTotal ? Math.round(clashDone / clashTotal * 100) : 100

  const scoped = cases.filter(c => (office === 'Semua' || c.month.employee.kantor === office) && (!q || `${c.month.employee.nama} ${c.month.employee.nip} ${c.month.employee.unit}`.toLowerCase().includes(q.toLowerCase())) && (state === 'open' ? !c.resolved : c.resolved))
  const typeCounts = scoped.reduce<Record<string, number>>((acc, c) => { acc[c.type] = (acc[c.type] ?? 0) + 1; return acc }, {})
  const filtered = scoped.filter(c => type === 'all' || c.type === type)
  const selected = cases.find(c => c.id === openCase)

  if (!hr.files.length) return <div className="page"><Empty icon={UploadCloud} title="Belum ada data untuk direkonsiliasi" action={<button className="btn primary" onClick={() => nav('import')}>Impor file sumber</button>}>Clash muncul setelah file absensi diunggah. Unggah setoran pekan ini di Setoran &amp; Review.</Empty></div>

  const next = clashTotal === 0
    ? { tone: 'ok', text: 'Tidak ada clash pada pekan ini. Semua hari yang punya bukti sudah valid otomatis.', cta: 'Lihat Uang Makan', go: () => nav('meal') }
    : clashOpen > 0
      ? { tone: 'warn', text: `Putuskan ${fmt.format(clashOpen)} clash di bawah. Uang makan hari-hari ini tertahan sampai ada keputusan.`, cta: '', go: undefined }
      : { tone: 'ok', text: 'Semua clash sudah diputuskan. Lanjutkan ke perhitungan uang makan.', cta: 'Lihat Uang Makan', go: () => nav('meal') }

  return <div className="page recon">
    <PageHeader kicker={`Rekonsiliasi · ${formatID(hr.weekRecon.period.start, { short: true })}–${formatID(hr.weekRecon.period.end, { short: true })}`} title="Rekonsiliasi absensi" actions={<><WeekPicker /><Seg label="Tampilan" value={tab} onChange={setTab} options={[{ value: 'issues', label: 'Antrean clash' }, { value: 'matrix', label: 'Matriks harian' }]} /></>}>
      Mesin Offline, Mesin Online, dan ST berkedudukan setara. Hari tanpa pertentangan antar sumber valid otomatis; Anda hanya memutuskan hari yang bertentangan.
    </PageHeader>

    <div className="rc-tiles">
      <div className="rc-tile t-ok"><ShieldCheck size={18} /><div><strong>{fmt.format(autoValid)}</strong><span>Valid otomatis</span><small>tanpa clash antar sumber</small></div></div>
      <div className={`rc-tile ${clashOpen ? 't-warn' : 't-ok'}`}><Swords size={18} /><div><strong>{fmt.format(clashOpen)}</strong><span>Clash menunggu</span><small>{clashOpen ? 'menahan uang makan' : 'tidak ada yang tertunda'}</small></div></div>
      <div className="rc-tile t-info"><CheckCircle2 size={18} /><div><strong>{fmt.format(clashDone)}</strong><span>Sudah diputuskan</span><small>tercatat di jejak audit</small></div></div>
      <div className="rc-tile t-idle"><Database size={18} /><div><strong>{fmt.format(noData)}</strong><span>Tanpa data</span><small>hari kerja belum ada bukti</small></div></div>
    </div>

    <div className="rc-progress" role="group" aria-label="Progres keputusan clash">
      <div className="rc-progress-top"><b>{fmt.format(clashDone)} dari {fmt.format(clashTotal)} clash diputuskan</b><span>{pctDone}%</span></div>
      <div className="rc-bar" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pctDone}%` }} /></div>
    </div>

    {nameHeld > 0 && <Note tone="warn">{fmt.format(nameHeld)} hari tertahan karena nama panggilan di Rekap ST belum dicocokkan ke pegawai (mis. "Andi", "Devi"). <button type="button" className="link" onClick={() => nav('identity')}>Cocokkan di Pencocokan Identitas <ArrowRight size={12} /></button></Note>}

    <div className={`rc-next n-${next.tone}`}>
      <span className="rc-next-k">Langkah berikutnya</span>
      <p>{next.text}</p>
      {next.go && <button className="btn primary" onClick={next.go}>{next.cta} <ArrowRight size={14} /></button>}
    </div>

    {tab === 'issues' ? <Panel>
      <h3 ref={queueHeading} tabIndex={-1} className="rc-queue-title">Antrean clash<span>{fmt.format(filtered.length)} {state === 'open' ? 'menunggu' : 'sudah diputuskan'}</span></h3>
      <div className="toolbar">
        <label className="search"><Search size={15} /><input placeholder="Cari nama, NIP, unit…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <select className="select" value={office} onChange={e => setOffice(e.target.value)} aria-label="Kantor"><option>Semua</option>{offices.map(o => <option key={o}>{o}</option>)}</select>
        <Seg label="Cakupan kasus" value={scope} onChange={setScope} options={[{ value: 'clash', label: 'Clash (menahan UM)' }, { value: 'all', label: 'Semua catatan' }]} />
        <Seg label="Status isu" value={state} onChange={setState} options={[{ value: 'open', label: 'Menunggu' }, { value: 'resolved', label: 'Sudah diputuskan' }]} />
      </div>
      <div className="rc-chips" role="group" aria-label="Jenis clash">
        <button className={`rc-chip tone-chip tone-idle ${type === 'all' ? 'on' : ''}`} aria-pressed={type === 'all'} onClick={() => setType('all')}>Semua <b>{fmt.format(scoped.length)}</b></button>
        {(Object.keys(ISSUE_LABEL) as IssueType[]).filter(t => typeCounts[t]).map(t => <button key={t} className={`rc-chip tone-chip ${typeTone(t)} ${type === t ? 'on' : ''}`} aria-pressed={type === t} onClick={() => setType(type === t ? 'all' : t)}>{ISSUE_LABEL[t]} <b>{typeCounts[t]}</b></button>)}
      </div>
      {filtered.length === 0
        ? (state === 'open' && clashTotal > 0 && clashOpen === 0 && scope === 'clash' && !q && office === 'Semua')
          ? <div className="rc-celebrate"><PartyPopper size={30} /><strong>Semua clash pekan ini sudah diputuskan</strong><p>Status hari dan uang makan sudah dihitung ulang dari keputusan Anda.</p><button className="btn primary" onClick={() => nav('meal')}>Lihat Uang Makan <ArrowRight size={14} /></button></div>
          : <Empty icon={CheckCircle2} title={state === 'open' ? 'Tidak ada kasus menunggu pada filter ini' : 'Belum ada keputusan pada filter ini'}>{q || office !== 'Semua' || type !== 'all' ? 'Ubah kata kunci, kantor, atau jenis clash untuk melihat kasus lain.' : state === 'open' ? 'Pilih "Semua catatan" di atas untuk melihat catatan yang tidak menahan uang makan.' : 'Keputusan yang Anda simpan akan muncul di sini.'}</Empty>
        : <div className="rc-cards">{filtered.slice(0, limit).map(c => <ClashCard key={c.id} c={c} toast={toast} editable={editable} onOpen={() => setOpenCase(c.id)} afterAction={card => { const next = card.nextElementSibling?.querySelector<HTMLElement>('.rc-decide .rc-btn, .rc-decided .btn'); (next ?? queueHeading.current)?.focus() }} />)}</div>}
      {filtered.length > limit && <button className="btn secondary more" onClick={() => setLimit(l => l + 20)}>Tampilkan {Math.min(20, filtered.length - limit)} kasus lagi</button>}
    </Panel> : <Matrix months={hr.weekRecon.months} range={hr.weekRecon.period} onOpen={(emp, date) => setOpenDay({ emp, date })} />}

    <AnimatePresence>
      {selected && <Drawer wide label="Detail kasus" onClose={() => setOpenCase(null)}><CaseReview c={selected} toast={toast} onDone={() => setOpenCase(null)} /></Drawer>}
      {openDay && (() => {
        const m = monthById.get(openDay.emp)
        const d = m?.days.find(x => x.date === openDay.date)
        return m && <Drawer wide label="Detail hari" onClose={() => setOpenDay(null)}>
          <div className="drawer-head"><span className="page-kicker">Bukti kehadiran</span><h2>{m.employee.nama}</h2><p>{m.employee.nip || 'Tanpa NIP'} · {m.employee.kantor} · {m.employee.unit}</p></div>
          {d ? <><DayDetail day={d} canReview />{d.issues.length > 0 && <IssueActions issues={d.issues} toast={toast} editable={editable} />}</> : <p className="muted">Tidak ada catatan pada tanggal ini. Periksa setoran pekan ini di Setoran &amp; Review.</p>}
        </Drawer>
      })()}
    </AnimatePresence>
  </div>
}

const onTime = (t?: string) => !!t && t <= '08:00'
/** Dampak keputusan terhadap uang makan, ditulis dari bukti hari itu bila bisa. */
function umImpact(decision: Resolution['decision'], type: IssueType, day: DayRecord | undefined, rate: number): string {
  if (decision === 'akui-dinas' || decision === 'tidak-hadir') return 'tanpa UM'
  if (decision === 'valid' && type === 'cuti-vs-hadir') return 'tanpa UM'
  if (decision === 'akui-hadir') {
    const machine = (day?.evidence ?? []).filter(e => e.kind !== 'daring' && (e.clockIn || e.clockOut))
    const timed = type === 'scan-berbeda' && machine.length ? machine : (day?.evidence ?? []).filter(e => e.clockIn || e.clockOut)
    if (!timed.length) return 'tanpa UM (tidak ada jam masuk/pulang)'
    // Jadwal resmi KPPU: Sen–Kam pulang 16:00, Jumat 16:30.
    const end = day && new Date(`${day.date}T00:00:00Z`).getUTCDay() === 5 ? '16:30' : '16:00'
    const verdict = (i?: string, o?: string) => !i || !o ? 'tanpa UM (scan tidak lengkap)' : !onTime(i) ? 'tanpa UM (terlambat)' : o < end ? 'tanpa UM (pulang sebelum jadwal)' : `dapat UM ${money.format(rate)}`
    const verdicts = [...new Set(timed.map(e => verdict(e.clockIn, e.clockOut)))]
    return verdicts.length === 1 ? verdicts[0] : `tergantung bukti yang dipakai (${verdicts.join(' / ')})`
  }
  return ''
}

function defaultNote(decision: Resolution['decision'], type: IssueType, day?: DayRecord): string {
  const st = day?.assignments[0]
  switch (decision) {
    case 'akui-dinas': return st ? `ST ${st.letterNo ?? '(tanpa nomor)'}${st.destination ? ` (${st.destination})` : ''} diakui sah; scan kantor tidak dihitung.` : 'Dinas diakui sah; scan kantor tidak dihitung.'
    case 'akui-hadir': return type === 'scan-berbeda' ? 'Jam scan mesin offline dipakai sebagai bukti yang berlaku.' : 'Absensi hadir di kantor diakui valid; dinas/ST pada tanggal ini tidak dipakai.'
    case 'tidak-hadir': return 'Bukti tidak sah; hari dicatat tidak hadir.'
    default: return type === 'cuti-vs-hadir' ? 'Cuti/sakit tetap berlaku; absen hadir tidak dihitung.' : 'Sudah ditinjau dan dinyatakan valid.'
  }
}

type Src = { icon: typeof Cpu; name: string; cls: string; lines: string[] }
function sources(day: DayRecord | undefined): Src[] {
  const ev = day?.evidence ?? []
  const line = (e: DayRecord['evidence'][number]) => {
    const parts: string[] = []
    if (e.code) parts.push(`Kode ${e.code}${e.codeLabel ? ` · ${e.codeLabel}` : ''}`)
    if (e.clockIn || e.clockOut) parts.push(`${e.clockIn ?? '—'}–${e.clockOut ?? '—'}`)
    else if (e.present) parts.push('Hadir (tanpa jam)')
    if (e.mode) parts.push(e.mode)
    if (e.approvalStatus && e.kind === 'daring') parts.push(e.approvalStatus === 'approved' ? 'Approved' : e.approvalStatus === 'rejected' ? 'Ditolak' : 'Belum approved')
    if (e.location) parts.push(e.location)
    return parts.join(' · ') || 'Ada catatan tanpa jam'
  }
  const off = ev.filter(e => e.kind !== 'daring' && e.kind !== 'surat-tugas'), on = ev.filter(e => e.kind === 'daring')
  const st = day?.assignments ?? []
  return [
    { icon: Cpu, name: 'Mesin Offline', cls: 'offline', lines: off.map(line) },
    { icon: Globe, name: 'Mesin Online', cls: 'online', lines: on.map(line) },
    { icon: FileText, name: 'Surat Tugas', cls: 'st', lines: st.map(a => `ST ${a.letterNo ?? '(tanpa nomor)'}${a.destination ? ` · ${a.destination}` : ''} · ${a.start === a.end ? formatID(a.start, { short: true }) : `${formatID(a.start, { short: true, year: false })}–${formatID(a.end, { short: true })}`}${a.local ? ' · lokal' : ''}`) },
  ]
}

function ClashCard({ c, toast, editable, onOpen, afterAction }: { c: Case; toast: (m: string) => void; editable: boolean; onOpen: () => void; afterAction: (card: HTMLElement) => void }) {
  const hr = useHr()
  const e = c.month.employee
  const day = c.month.days.find(d => d.date === c.dates[0])
  const actions = ACTIONS[c.type] ?? [{ decision: 'valid' as const, label: 'Tandai sudah ditinjau', tone: 'primary' as const }]
  // Catatan hanya berubah karena diketik pengguna. Kosong = diisi otomatis sesuai pilihan saat tombol ditekan.
  const [typed, setTyped] = useState('')
  const card = useRef<HTMLElement>(null)
  // Satu keputusan berlaku untuk seluruh isu pemblokir pada pegawai-hari tersebut (mis. dinas-vs-scan + status berbeda),
  // jika tidak hari itu tetap tertahan oleh isu lain yang belum diputuskan.
  const caseDays = c.dates.map(date => c.month.days.find(d => d.date === date)).filter(Boolean) as DayRecord[]
  const ids = [...new Set([...c.issues.map(i => i.id), ...caseDays.flatMap(d => d.issues.filter(i => i.blocksMeal).map(i => i.id))])]
  const dayCount = new Set(c.dates).size
  const decided = c.issues.map(i => hr.resolutions.find(r => r.issueId === i.id)).filter(Boolean) as Resolution[]
  const decide = (d: Resolution['decision']) => {
    const text = typed.trim() ? typed : defaultNote(d, c.type, day)
    if (text.trim().length < 3) { toast('Isi catatan keputusan minimal 3 karakter'); return }
    // Fokus dipindah ke kartu berikutnya sebelum kartu ini hilang dari antrean, agar pengguna keyboard tidak kehilangan posisi.
    if (card.current) afterAction(card.current)
    hr.resolve(ids, d, text); toast(`Keputusan disimpan untuk ${dayCount} hari`)
  }
  // Hasil UM dari keputusan yang sudah tersimpan, bukan tarif harian yang terkesan berlaku.
  const outcome = decided[0] ? umImpact(decided[0].decision, c.type, day, c.month.rate) : ''
  return <article ref={card} className={`rc-card ${c.resolved ? 'is-done' : ''}`}>
    <header className="rc-card-head">
      <div className="rc-who"><strong>{e.nama}</strong><small>{e.nip || 'Tanpa NIP'} · {e.kantor} · {e.unit?.replace(/ - Sekretaris Jenderal$/, '') || 'unit belum diisi'}</small></div>
      <div className="rc-meta"><span className={`tone-chip ${typeTone(c.type)}`}>{ISSUE_LABEL[c.type]}</span><span className="tone-chip tone-idle">{rangeLabel(c.dates)}{c.dates.length > 1 ? ` · ${c.dates.length} hari` : ''}</span><SeverityPill severity={c.severity} /></div>
    </header>
    <p className="rc-detail">{c.issues[0].detail}</p>
    <div className="rc-compare" aria-label="Perbandingan sumber">
      {sources(day).map(s => <div key={s.name} className={`rc-src s-${s.cls}`}>
        <h4><s.icon size={13} /> {s.name}</h4>
        {s.lines.length ? s.lines.map((l, i) => <p key={i}>{l}</p>) : <p className="none">tidak ada catatan</p>}
      </div>)}
    </div>
    {c.resolved ? <div className="rc-decided"><CheckCircle2 size={16} /><div><b>Sudah diputuskan: {decided[0] ? DECISION_LABEL[decided[0].decision] : ''}</b>{decided[0] && <small>{decided[0].reviewer} · “{decided[0].note}”</small>}</div>
      {editable && <button className="btn danger" onClick={() => { if (card.current) afterAction(card.current); hr.unresolve(ids); toast('Keputusan dibatalkan') }}><RotateCcw size={14} /> Batalkan keputusan</button>}</div>
    : editable ? <div className="rc-decide">
      <label><span>Catatan keputusan (jejak audit). Kosongkan untuk memakai catatan otomatis sesuai pilihan.</span><textarea rows={2} value={typed} placeholder="Mis. sudah dikonfirmasi ke sekretaris Direktorat." onChange={ev => setTyped(ev.target.value)} /></label>
      <div className="rc-btns">{actions.map(a => {
        const impact = umImpact(a.decision, c.type, day, c.month.rate)
        return <button key={a.decision + a.label} className={`btn rc-btn ${a.tone === 'primary' ? 'primary' : 'secondary'}`} onClick={() => decide(a.decision)}>{a.label}{impact && <small> → {impact}</small>}</button>
      })}</div>
    </div> : <div className="rc-decided wait"><span>Keputusan kasus ini memerlukan akun Admin atau Superadmin.</span></div>}
    <footer><button className="rc-link" onClick={onOpen}><ClipboardCheck size={13} /> Buka bukti lengkap</button><span><Wallet size={12} /> {c.resolved ? <>UM {e.nama.split(' ')[0]}: {outcome || 'mengikuti keputusan'}</> : <>UM {e.nama.split(' ')[0]}: {money.format(c.month.rate)}/hari jika hadir sah</>}</span></footer>
  </article>
}

const DECISION_LABEL: Record<Resolution['decision'], string> = { 'akui-dinas': 'dinas/ST diakui', 'akui-hadir': 'hadir diakui', 'tidak-hadir': 'tidak hadir', valid: 'ditinjau valid' }

/** Satu kasus per pegawai-hari untuk clash: isu pemblokir paling spesifik mewakili hari tersebut. */
const CLASH_PRIORITY: IssueType[] = ['dinas-vs-scan-kantor', 'cuti-vs-hadir', 'st-tumpang-tindih', 'status-berbeda', 'scan-berbeda', 'jam-manual', 'jadwal-tidak-sesuai']
function clashIssues(issues: Issue[]) {
  const byDay = new Map<string, Issue>()
  for (const issue of issues) {
    if (!issue.blocksMeal) continue
    const key = `${issue.employeeId}|${issue.date}`, current = byDay.get(key)
    const rank = (i: Issue) => { const r = CLASH_PRIORITY.indexOf(i.type); return r < 0 ? CLASH_PRIORITY.length : r }
    if (!current || rank(issue) < rank(current)) byDay.set(key, issue)
  }
  return [...byDay.values()]
}

function rangeLabel(dates: string[]) {
  if (dates.length === 1) return formatID(dates[0], { short: true })
  return `${formatID(dates[0], { short: true, year: false })} – ${formatID(dates[dates.length - 1], { short: true })}`
}

function buildCases(issues: Issue[], months: Map<string, EmployeeMonth>, resolved: Set<string>, merge: boolean): Case[] {
  const sorted = [...issues].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.type.localeCompare(b.type) || a.date.localeCompare(b.date))
  const out: Case[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    const month = months.get(i.employeeId)
    if (!month) continue
    const isResolved = resolved.has(i.id)
    if (merge && last && last.month.employee.id === i.employeeId && last.type === i.type && last.resolved === isResolved && addDays(last.dates[last.dates.length - 1], 4) >= i.date && gapIsWeekend(last.dates[last.dates.length - 1], i.date)) {
      last.issues.push(i); last.dates.push(i.date)
      if (SEV_RANK[i.severity] < SEV_RANK[last.severity]) last.severity = i.severity
    } else out.push({ id: i.id, type: i.type, severity: i.severity, month, issues: [i], dates: [i.date], resolved: isResolved })
  }
  return out.sort((a, b) => Number(a.resolved) - Number(b.resolved) || SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.dates[0].localeCompare(b.dates[0]))
}
const gapIsWeekend = (a: string, b: string) => eachDay(addDays(a, 1), addDays(b, -1)).every(isWeekend)

function CaseReview({ c, toast, onDone }: { c: Case; toast: (m: string) => void; onDone: () => void }) {
  const { user } = useAuth()
  const days = c.dates.map(d => c.month.days.find(x => x.date === d)).filter(Boolean) as DayRecord[]
  return <>
    <div className="drawer-head">
      <span className="page-kicker"><ClipboardCheck size={13} /> {ISSUE_LABEL[c.type]}</span>
      <h2>{c.month.employee.nama}</h2>
      <p>{c.month.employee.nip || 'Tanpa NIP'} · {c.month.employee.kantor} · {c.month.employee.unit || 'unit belum diisi'} · {rangeLabel(c.dates)}</p>
      <div className="head-tags"><SeverityPill severity={c.severity} />{c.issues.some(i => i.blocksMeal) && <span className="tag">Menahan uang makan</span>}</div>
    </div>
    <Note>{c.issues[0].detail}</Note>
    <IssueActions issues={[...new Map([...c.issues, ...days.flatMap(d => d.issues.filter(i => i.blocksMeal))].map(i => [i.id, i])).values()]} toast={toast} onDone={onDone} type={c.type} editable={user.role === 'superadmin' || user.role === 'admin'} />
    <h3 className="section-title">Bukti per tanggal ({days.length})</h3>
    {days.map(d => <DayDetail key={d.date} day={d} canReview />)}
  </>
}

function IssueActions({ issues, toast, onDone, type, editable }: { issues: Issue[]; toast: (m: string) => void; onDone?: () => void; type?: IssueType; editable: boolean }) {
  const hr = useHr()
  const [note, setNote] = useState('')
  const t = type ?? issues[0].type
  const done = issues.every(i => hr.resolutions.some(r => r.issueId === i.id))
  const actions = ACTIONS[t] ?? [{ decision: 'valid' as const, label: 'Tandai sudah ditinjau', tone: 'primary' as const }]
  const ids = issues.map(i => i.id)
  const days = new Set(issues.map(i => `${i.employeeId}|${i.date}`)).size
  if (!editable) return <div className={`decision ${done ? 'done' : ''}`}><span>{done ? 'Keputusan sudah tercatat; status hari dan uang makan mengikuti keputusan tersebut.' : 'Keputusan kasus ini memerlukan akun Admin atau Superadmin.'}</span></div>
  if (done) return <div className="decision done"><CheckCircle2 size={16} /><span>Sudah diputuskan. Status hari dan uang makan dihitung ulang memakai keputusan ini.</span><button className="btn danger" onClick={() => { hr.unresolve(ids); toast('Keputusan dibatalkan') }}><RotateCcw size={14} /> Batalkan keputusan</button></div>
  return <div className="decision">
    <label><span>Catatan keputusan (tersimpan sebagai jejak audit)</span><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Mis. sudah dikonfirmasi ke sekretaris Direktorat; ST 640 dibatalkan." /></label>
    <div className="decision-buttons">{actions.map(a => <button key={a.decision + a.label} className={`btn ${a.tone === 'primary' ? 'primary' : 'secondary'}`} onClick={() => { if (note.trim().length < 3) { toast('Isi catatan keputusan minimal 3 karakter'); return } hr.resolve(ids, a.decision, note); toast(`Keputusan disimpan untuk ${days} hari`); onDone?.() }}>{a.label}</button>)}</div>
    <small>Berlaku untuk {days} hari pada kasus ini · reviewer: {hr.reviewer}</small>
  </div>
}

function Matrix({ months, range, onOpen }: { months: EmployeeMonth[]; range: { start: string; end: string }; onOpen: (emp: string, date: string) => void }) {
  const [office, setOffice] = useState('Semua')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'attention' | 'flag' | 'not-found'>('attention')
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [office, q, only])
  const dates = eachDay(range.start, range.end)
  const offices = [...new Set(months.map(m => m.employee.kantor))].sort()
  const rows = months.filter(m => (office === 'Semua' || m.employee.kantor === office) && (!q || `${m.employee.nama} ${m.employee.unit} ${m.employee.nip}`.toLowerCase().includes(q.toLowerCase())) && (only === 'all' || (only === 'attention' ? m.flaggedDays + m.notFoundDays > 0 : only === 'flag' ? m.flaggedDays > 0 : m.notFoundDays > 0)))
  const PER = 50
  const view = rows.slice(page * PER, page * PER + PER)
  const coverage = months.reduce((sum, m) => ({ valid: sum.valid + m.reviewedDays, flag: sum.flag + m.flaggedDays, missing: sum.missing + m.notFoundDays, total: sum.total + m.workdays }), { valid: 0, flag: 0, missing: 0, total: 0 })
  return <Panel>
    <div className="toolbar">
      <label className="search"><Search size={15} /><input placeholder="Cari pegawai…" value={q} onChange={e => setQ(e.target.value)} /></label>
      <select className="select" value={office} onChange={e => setOffice(e.target.value)} aria-label="Kantor"><option>Semua</option>{offices.map(o => <option key={o}>{o}</option>)}</select>
      <Seg label="Saring" value={only} onChange={setOnly} options={[{ value: 'attention', label: 'Perlu tindakan' }, { value: 'flag', label: 'Flag' }, { value: 'not-found', label: 'Tidak ditemukan' }, { value: 'all', label: 'Semua' }]} />
    </div>
    <div className="review-progress"><span><b>{fmt.format(coverage.valid)}</b> valid</span><span><b>{fmt.format(coverage.flag)}</b> flag</span><span><b>{fmt.format(coverage.missing)}</b> tidak ditemukan</span><span><b>{fmt.format(coverage.total)}</b> target hari-orang</span></div>
    <div className="legend rc-legend" role="group" aria-label="Legenda kode matriks">{[['ok', 'Hadir'], ['online', 'WFA'], ['duty', 'Dinas / ST / diklat'], ['leave', 'Cuti / sakit / izin'], ['danger', 'Tanpa keterangan / terlambat'], ['warn', 'Tidak lengkap / menunggu keputusan'], ['idle', 'Tidak ada data']].map(([k, l]) => <span key={k}><i className={`sw sw-${k}`} /> {l}</span>)}<span><i className="dot-issue" /> isu terbuka</span><span><b>!</b> menunggu keputusan · <b>?</b> tidak ditemukan</span></div>
    <div className="matrix-wrap">
      <table className="matrix">
        <thead><tr><th className="sticky">Pegawai</th>{dates.map(d => <th key={d} className={isWeekend(d) ? 'we' : ''}><span>{dayName(d, true)}</span>{Number(d.slice(8))}</th>)}<th>H</th><th>TK</th></tr></thead>
        <tbody>{view.map(m => {
          const byDate = new Map(m.days.map(d => [d.date, d]))
          return <tr key={m.employee.id}>
            <th className="sticky" scope="row"><strong>{m.employee.nama}</strong><small>{m.employee.kantor}</small></th>
            {dates.map(date => {
              const d = byDate.get(date)
              if (!d) return <td key={date} className={isWeekend(date) ? 'we' : 'nd'} />
              const issue = d.issues.some(i => !d.resolved.some(r => r.issueId === i.id))
              const cell = d.reviewState === 'valid' ? STATUS_SHORT[d.status] : d.reviewState === 'flag' ? '!' : d.reviewState === 'not-found' ? '?' : '·'
              const reviewLabel = d.reviewState === 'valid' ? 'Valid' : d.reviewState === 'flag' ? 'Flag, menunggu keputusan' : d.reviewState === 'not-found' ? 'Tidak ditemukan' : 'Belum berlangsung'
              return <td key={date} className={`${isWeekend(date) && d.status === 'hadir' ? 'we' : ''} rv-${d.reviewState}`}><button className={`cell st-${d.status} rv-${d.reviewState} ${d.lateMin > 0 && d.status === 'hadir' ? 'late' : ''}`} onClick={() => onOpen(m.employee.id, date)} title={`${formatID(date)}${d.lateMin > 0 ? ' · terlambat' : ''} · ${reviewLabel} · ${STATUS_LABEL[d.status]} · ${d.basis}`} aria-label={`${m.employee.nama} ${formatID(date)}: ${reviewLabel}; ${STATUS_LABEL[d.status]}`}>{cell}{issue && <i className="dot-issue" />}</button></td>
            })}
            <td className="num">{m.present}</td><td className={`num ${m.absent ? 'bad' : ''}`}>{m.absent}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    {rows.length === 0 && <Empty icon={Search} title="Tidak ada pegawai pada filter ini">{only === 'attention' ? 'Semua hari pada pekan ini sudah valid. Pilih "Semua" untuk melihat seluruh pegawai.' : 'Ubah kata kunci, kantor, atau filter untuk melihat pegawai lain.'}</Empty>}
    <div className="pager"><span>{fmt.format(rows.length)} pegawai</span>{rows.length > PER && <><button className="btn secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Sebelumnya</button><span>Hal. {page + 1} / {Math.ceil(rows.length / PER)}</span><button className="btn secondary" disabled={(page + 1) * PER >= rows.length} onClick={() => setPage(p => p + 1)}>Berikutnya</button></>}</div>
  </Panel>
}
