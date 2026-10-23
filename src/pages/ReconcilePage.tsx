import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { CheckCircle2, ChevronRight, ClipboardCheck, RotateCcw, Search, UploadCloud } from 'lucide-react'
import { useHr } from '../state/HrData.tsx'
import type { Issue, IssueType, Resolution, Severity } from '../engine/types.ts'
import { ISSUE_LABEL, STATUS_LABEL, type DayRecord, type EmployeeMonth } from '../engine/reconcile.ts'
import { addDays, dayName, eachDay, formatID, isWeekend, monthBounds, monthLabel } from '../engine/dates.ts'
import { fmt } from '../lib/format.ts'
import { DayDetail } from '../components/DayDetail.tsx'
import { Drawer, Empty, Note, PageHeader, Panel, Seg, SeverityPill, StatusChip, STATUS_SHORT } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'

type Case = { id: string; type: IssueType; severity: Severity; month: EmployeeMonth; issues: Issue[]; dates: string[]; resolved: boolean }
const SEV_RANK: Record<Severity, number> = { tinggi: 0, sedang: 1, rendah: 2 }

const ACTIONS: Partial<Record<IssueType, { decision: Resolution['decision']; label: string; tone?: 'primary' }[]>> = {
  'dinas-vs-scan-kantor': [{ decision: 'akui-dinas', label: 'Akui dinas (scan tidak dihitung)', tone: 'primary' }, { decision: 'akui-hadir', label: 'Akui hadir di kantor' }],
  'cuti-vs-hadir': [{ decision: 'valid', label: 'Tetap cuti/sakit', tone: 'primary' }, { decision: 'akui-hadir', label: 'Akui hadir (cuti dibatalkan)' }],
  'st-tumpang-tindih': [{ decision: 'valid', label: 'Sudah diklarifikasi — satu ST berlaku', tone: 'primary' }, { decision: 'akui-dinas', label: 'Keduanya sah (ST berurutan)' }],
  'pd-tanpa-st': [{ decision: 'valid', label: 'ST ada / dinas sah', tone: 'primary' }, { decision: 'tidak-hadir', label: 'Tidak sah → tanpa keterangan' }],
  'wfo-di-luar-kantor': [{ decision: 'valid', label: 'Lokasi dapat diterima', tone: 'primary' }, { decision: 'tidak-hadir', label: 'Presensi tidak sah' }],
  'jam-duplikat': [{ decision: 'valid', label: 'Jam sudah diverifikasi', tone: 'primary' }, { decision: 'tidak-hadir', label: 'Tidak sah' }],
  'jam-manual': [{ decision: 'valid', label: 'Bukti pendukung ada', tone: 'primary' }, { decision: 'tidak-hadir', label: 'Tidak sah' }],
  'st-tanpa-nomor': [{ decision: 'valid', label: 'Nomor ST sudah dikonfirmasi', tone: 'primary' }],
}

export function ReconcilePage({ nav, toast, focus }: { nav: Nav; toast: (m: string) => void; focus?: string }) {
  const hr = useHr()
  const [tab, setTab] = useState<'issues' | 'matrix'>('matrix')
  const [state, setState] = useState<'open' | 'resolved' | 'all'>('open')
  const [sev, setSev] = useState<'all' | Severity>('all')
  const [type, setType] = useState<'all' | IssueType>('all')
  const [office, setOffice] = useState('Semua')
  const [q, setQ] = useState(focus ?? '')
  const [limit, setLimit] = useState(40)
  const [openCase, setOpenCase] = useState<string | null>(null)
  const [openDay, setOpenDay] = useState<{ emp: string; date: string } | null>(null)
  useEffect(() => setLimit(40), [state, sev, type, office, q])

  const resolvedIds = useMemo(() => new Set(hr.resolutions.map(r => r.issueId)), [hr.resolutions])
  const monthById = useMemo(() => new Map(hr.recon.months.map(m => [m.employee.id, m])), [hr.recon.months])
  const cases = useMemo(() => buildCases(hr.recon.issues, monthById, resolvedIds), [hr.recon.issues, monthById, resolvedIds])
  const offices = [...new Set(hr.recon.months.map(m => m.employee.kantor))].sort()

  const filtered = cases.filter(c =>
    (state === 'all' || (state === 'open' ? !c.resolved : c.resolved)) && (sev === 'all' || c.severity === sev) && (type === 'all' || c.type === type) &&
    (office === 'Semua' || c.month.employee.kantor === office) &&
    (!q || `${c.month.employee.nama} ${c.month.employee.nip} ${c.month.employee.unit}`.toLowerCase().includes(q.toLowerCase())))
  const typeCounts = cases.filter(c => !c.resolved).reduce<Record<string, number>>((acc, c) => { acc[c.type] = (acc[c.type] ?? 0) + 1; return acc }, {})
  const sevCounts = cases.filter(c => !c.resolved).reduce<Record<string, number>>((acc, c) => { acc[c.severity] = (acc[c.severity] ?? 0) + 1; return acc }, {})
  const selected = cases.find(c => c.id === openCase)

  if (!hr.monthlyPackage.ready) return <div className="page">
    <PageHeader kicker="Langkah 2 · Rekonsiliasi" title="Lengkapi paket bulan ini">Rekonsiliasi baru dibuka setelah sumber absensi bulan yang sama tersedia dan register ST dinyatakan lengkap untuk semua kantor.</PageHeader>
    <Panel title={`Paket ${monthLabel(hr.activePeriod)} · seluruh KPPU`} sub="Pusat dan Kanwil diproses dalam satu periode. Untuk kantor tanpa ST, buat pernyataan nihil dengan alasan dan konfirmasi kelengkapan register.">
      <div className="package-checks">
        <PackageCheck label="Mesin Offline" ready={hr.monthlyPackage.offline.ready} detail={`${hr.monthlyPackage.offline.files} file pada periode ini`} />
        <PackageCheck label="Mesin Online" ready={hr.monthlyPackage.online.ready} detail={`${hr.monthlyPackage.online.files} file pada periode ini`} />
        {hr.monthlyPackage.suratTugas.filter(x => !x.ready).map(x => <PackageCheck key={x.office} label={`ST · ${x.office}`} ready={false} detail="Belum ada register lengkap atau pernyataan nihil" />)}
      </div>
      <button className="btn primary" onClick={() => nav('import')}><UploadCloud size={15} /> Buka impor sumber</button>
    </Panel>
  </div>
  if (!hr.files.length) return <div className="page"><Empty icon={UploadCloud} title="Belum ada data untuk direkonsiliasi" action={<button className="btn primary" onClick={() => nav('import')}>Impor file sumber</button>} /></div>

  return <div className="page">
    <PageHeader kicker="Langkah 2 · Validasi" title="Rekonsiliasi absensi" actions={<Seg label="Tampilan" value={tab} onChange={setTab} options={[{ value: 'matrix', label: 'Matriks harian' }, { value: 'issues', label: 'Detail isu' }]} />}>
      Bukti Mesin Offline, Mesin Online, dan ST berkedudukan setara. Pada setiap hari berbukti, admin memilih catatan yang dipakai dan menetapkan status aktivitas; hasil UM muncul bertahap hanya setelah keputusan hari itu sah.
    </PageHeader>

    {tab === 'issues' ? <>
      <div className="sev-strip">
        {(['tinggi', 'sedang', 'rendah'] as Severity[]).map(s => <button key={s} className={`sev-card s-${s} ${sev === s ? 'on' : ''}`} onClick={() => setSev(sev === s ? 'all' : s)}>
          <SeverityPill severity={s} /><strong>{fmt.format(sevCounts[s] ?? 0)}</strong>
          <small>{s === 'tinggi' ? 'Berisiko pembayaran ganda / klaim tidak sah' : s === 'sedang' ? 'Menahan uang makan sampai diputuskan' : 'Informasi, tidak menahan pembayaran'}</small>
        </button>)}
      </div>
      <Panel>
        <div className="toolbar">
          <label className="search"><Search size={15} /><input placeholder="Cari nama, NIP, unit…" value={q} onChange={e => setQ(e.target.value)} /></label>
          <select className="select" value={type} onChange={e => setType(e.target.value as IssueType | 'all')} aria-label="Jenis isu"><option value="all">Semua jenis isu</option>{(Object.keys(ISSUE_LABEL) as IssueType[]).filter(t => typeCounts[t]).map(t => <option key={t} value={t}>{ISSUE_LABEL[t]} ({typeCounts[t]})</option>)}</select>
          <select className="select" value={office} onChange={e => setOffice(e.target.value)} aria-label="Kantor"><option>Semua</option>{offices.map(o => <option key={o}>{o}</option>)}</select>
          <Seg label="Status isu" value={state} onChange={setState} options={[{ value: 'open', label: 'Terbuka' }, { value: 'resolved', label: 'Selesai' }, { value: 'all', label: 'Semua' }]} />
        </div>
        <p className="count-line">{fmt.format(filtered.length)} kasus · hari berurutan dengan isu yang sama digabung menjadi satu kasus</p>
        {filtered.length === 0 ? <Empty icon={CheckCircle2} title="Tidak ada kasus pada filter ini" /> :
          <div className="case-list">{filtered.slice(0, limit).map(c => <button key={c.id} className={`case ${c.resolved ? 'done' : ''}`} onClick={() => setOpenCase(c.id)}>
            <SeverityPill severity={c.severity} />
            <div className="case-main">
              <strong>{ISSUE_LABEL[c.type]}</strong>
              <span>{c.issues[0].detail}</span>
            </div>
            <div className="case-who"><strong>{c.month.employee.nama}</strong><small>{c.month.employee.kantor} · {c.month.employee.unit?.replace(/ - Sekretaris Jenderal$/, '') || 'unit belum diisi'}</small></div>
            <div className="case-when">{rangeLabel(c.dates)}<small>{c.dates.length} hari</small></div>
            {c.resolved ? <span className="done-tag"><CheckCircle2 size={13} /> Selesai</span> : <ChevronRight size={16} />}
          </button>)}</div>}
        {filtered.length > limit && <button className="btn secondary more" onClick={() => setLimit(l => l + 60)}>Tampilkan {Math.min(60, filtered.length - limit)} kasus lagi</button>}
      </Panel>
    </> : <Matrix months={hr.recon.months} period={hr.activePeriod} onOpen={(emp, date) => setOpenDay({ emp, date })} />}

    <AnimatePresence>
      {selected && <Drawer wide label="Detail kasus" onClose={() => setOpenCase(null)}><CaseReview c={selected} toast={toast} onDone={() => setOpenCase(null)} /></Drawer>}
      {openDay && (() => {
        const m = monthById.get(openDay.emp)
        const d = m?.days.find(x => x.date === openDay.date)
        return m && <Drawer wide label="Detail hari" onClose={() => setOpenDay(null)}>
          <div className="drawer-head"><span className="page-kicker">Bukti kehadiran</span><h2>{m.employee.nama}</h2><p>{m.employee.nip || 'Tanpa NIP'} · {m.employee.kantor} · {m.employee.unit}</p></div>
          {d ? <><DayDetail day={d} canReview />{d.issues.length > 0 && <IssueActions issues={d.issues} toast={toast} />}</> : <p className="muted">Tidak ada catatan pada tanggal ini.</p>}
        </Drawer>
      })()}
    </AnimatePresence>
  </div>
}

function PackageCheck({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return <div className={`package-check ${ready ? 'ready' : 'missing'}`}><span>{ready ? <CheckCircle2 size={16} /> : <UploadCloud size={16} />}</span><div><strong>{label}</strong><small>{detail}</small></div><b>{ready ? 'Siap' : 'Belum lengkap'}</b></div>
}

function rangeLabel(dates: string[]) {
  if (dates.length === 1) return formatID(dates[0], { short: true })
  return `${formatID(dates[0], { short: true, year: false })} – ${formatID(dates[dates.length - 1], { short: true })}`
}

function buildCases(issues: Issue[], months: Map<string, EmployeeMonth>, resolved: Set<string>): Case[] {
  const sorted = [...issues].sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.type.localeCompare(b.type) || a.date.localeCompare(b.date))
  const out: Case[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    const month = months.get(i.employeeId)
    if (!month) continue
    const isResolved = resolved.has(i.id)
    if (last && last.month.employee.id === i.employeeId && last.type === i.type && last.resolved === isResolved && addDays(last.dates[last.dates.length - 1], 4) >= i.date && gapIsWeekend(last.dates[last.dates.length - 1], i.date)) {
      last.issues.push(i); last.dates.push(i.date)
      if (SEV_RANK[i.severity] < SEV_RANK[last.severity]) last.severity = i.severity
    } else out.push({ id: i.id, type: i.type, severity: i.severity, month, issues: [i], dates: [i.date], resolved: isResolved })
  }
  return out.sort((a, b) => Number(a.resolved) - Number(b.resolved) || SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.dates[0].localeCompare(b.dates[0]))
}
const gapIsWeekend = (a: string, b: string) => eachDay(addDays(a, 1), addDays(b, -1)).every(isWeekend)

function CaseReview({ c, toast, onDone }: { c: Case; toast: (m: string) => void; onDone: () => void }) {
  const days = c.dates.map(d => c.month.days.find(x => x.date === d)).filter(Boolean) as DayRecord[]
  return <>
    <div className="drawer-head">
      <span className="page-kicker"><ClipboardCheck size={13} /> {ISSUE_LABEL[c.type]}</span>
      <h2>{c.month.employee.nama}</h2>
      <p>{c.month.employee.nip || 'Tanpa NIP'} · {c.month.employee.kantor} · {c.month.employee.unit || 'unit belum diisi'} · {rangeLabel(c.dates)}</p>
      <div className="head-tags"><SeverityPill severity={c.severity} />{c.issues.some(i => i.blocksMeal) && <span className="tag">Menahan uang makan</span>}</div>
    </div>
    <Note>{c.issues[0].detail}</Note>
    <IssueActions issues={c.issues} toast={toast} onDone={onDone} type={c.type} />
    <h3 className="section-title">Bukti per tanggal ({days.length})</h3>
    {days.map(d => <DayDetail key={d.date} day={d} canReview />)}
  </>
}

function IssueActions({ issues, toast, onDone, type }: { issues: Issue[]; toast: (m: string) => void; onDone?: () => void; type?: IssueType }) {
  const hr = useHr()
  const [note, setNote] = useState('')
  const t = type ?? issues[0].type
  const done = issues.every(i => hr.resolutions.some(r => r.issueId === i.id))
  const actions = ACTIONS[t] ?? [{ decision: 'valid' as const, label: 'Tandai sudah ditinjau', tone: 'primary' as const }]
  const ids = issues.map(i => i.id)
  if (done) return <div className="decision done"><CheckCircle2 size={16} /><span>Sudah diputuskan. Status hari dan uang makan dihitung ulang memakai keputusan ini.</span><button className="btn secondary" onClick={() => { hr.unresolve(ids); toast('Keputusan dibatalkan') }}><RotateCcw size={14} /> Batalkan</button></div>
  return <div className="decision">
    <label><span>Catatan keputusan (tersimpan sebagai jejak audit)</span><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Mis. sudah dikonfirmasi ke sekretaris Direktorat; ST 640 dibatalkan." /></label>
    <div className="decision-buttons">{actions.map(a => <button key={a.decision + a.label} className={`btn ${a.tone === 'primary' ? 'primary' : 'secondary'}`} onClick={() => { hr.resolve(ids, a.decision, note); toast(`Keputusan disimpan untuk ${ids.length} hari`); onDone?.() }}>{a.label}</button>)}</div>
    <small>Berlaku untuk {ids.length} hari pada kasus ini · reviewer: {hr.reviewer}</small>
  </div>
}

function Matrix({ months, period, onOpen }: { months: EmployeeMonth[]; period: string; onOpen: (emp: string, date: string) => void }) {
  const [office, setOffice] = useState('Semua')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'attention' | 'flag' | 'not-found'>('attention')
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [office, q, only])
  const { start, end } = monthBounds(period)
  const dates = eachDay(start, end)
  const offices = [...new Set(months.map(m => m.employee.kantor))].sort()
  const rows = months.filter(m => (office === 'Semua' || m.employee.kantor === office) && (!q || `${m.employee.nama} ${m.employee.unit} ${m.employee.nip}`.toLowerCase().includes(q.toLowerCase())) && (only === 'all' || (only === 'attention' ? m.flaggedDays + m.notFoundDays > 0 : only === 'flag' ? m.flaggedDays > 0 : m.notFoundDays > 0)))
  const PER = 50
  const view = rows.slice(page * PER, page * PER + PER)
  const coverage = months.reduce((sum, m) => ({ valid: sum.valid + m.reviewedDays, flag: sum.flag + m.flaggedDays, missing: sum.missing + m.notFoundDays, total: sum.total + m.workdays }), { valid: 0, flag: 0, missing: 0, total: 0 })
  const legend: (keyof typeof STATUS_LABEL)[] = ['hadir', 'hadir-wfa', 'dinas-lokal', 'dinas-luar', 'diklat', 'cuti', 'sakit', 'izin', 'tidak-lengkap', 'tanpa-keterangan', 'tidak-ada-data']
  return <Panel>
    <div className="toolbar">
      <label className="search"><Search size={15} /><input placeholder="Cari pegawai…" value={q} onChange={e => setQ(e.target.value)} /></label>
      <select className="select" value={office} onChange={e => setOffice(e.target.value)} aria-label="Kantor"><option>Semua</option>{offices.map(o => <option key={o}>{o}</option>)}</select>
      <Seg label="Saring" value={only} onChange={setOnly} options={[{ value: 'attention', label: 'Perlu tindakan' }, { value: 'flag', label: 'Flag' }, { value: 'not-found', label: 'Tidak ditemukan' }, { value: 'all', label: 'Semua' }]} />
    </div>
    <div className="review-progress"><span><b>{fmt.format(coverage.valid)}</b> valid</span><span><b>{fmt.format(coverage.flag)}</b> flag</span><span><b>{fmt.format(coverage.missing)}</b> tidak ditemukan</span><span><b>{fmt.format(coverage.total)}</b> target hari-orang</span></div>
    <div className="legend">{legend.map(s => <span key={s}><StatusChip status={s} compact /> {STATUS_LABEL[s]}</span>)}<span><i className="dot-issue" /> isu terbuka</span><span><b>!</b> menunggu keputusan · <b>?</b> tidak ditemukan</span></div>
    <div className="matrix-wrap">
      <table className="matrix">
        <thead><tr><th className="sticky">Pegawai</th>{dates.map(d => <th key={d} className={isWeekend(d) ? 'we' : ''}><span>{dayName(d, true).slice(0, 2)}</span>{Number(d.slice(8))}</th>)}<th>H</th><th>TK</th></tr></thead>
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
              return <td key={date} className={`${isWeekend(date) && d.status === 'hadir' ? 'we' : ''} rv-${d.reviewState}`}><button className={`cell st-${d.status} rv-${d.reviewState}`} onClick={() => onOpen(m.employee.id, date)} title={`${formatID(date)} · ${reviewLabel} · ${STATUS_LABEL[d.status]} · ${d.basis}`} aria-label={`${m.employee.nama} ${formatID(date)}: ${reviewLabel}; ${STATUS_LABEL[d.status]}`}>{cell}{issue && <i className="dot-issue" />}</button></td>
            })}
            <td className="num">{m.present}</td><td className={`num ${m.absent ? 'bad' : ''}`}>{m.absent}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <div className="pager"><span>{fmt.format(rows.length)} pegawai</span>{rows.length > PER && <><button className="btn secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Sebelumnya</button><span>Hal. {page + 1} / {Math.ceil(rows.length / PER)}</span><button className="btn secondary" disabled={(page + 1) * PER >= rows.length} onClick={() => setPage(p => p + 1)}>Berikutnya</button></>}</div>
  </Panel>
}
