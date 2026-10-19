import { FileText, MapPin } from 'lucide-react'
import type { DayRecord } from '../engine/reconcile.ts'
import { formatID } from '../engine/dates.ts'
import { DAY_CODE_LABEL } from '../engine/parsers/common.ts'
import { useHr } from '../state/HrData.tsx'
import { SourceChip, StatusChip } from './ui.tsx'
import { RecordReview } from './RecordReview.tsx'
import { recordDisposition } from '../engine/recordReviews.ts'

const NOTE_LABEL: Record<string, string> = {
  'jadwal-puasa': 'jadwal puasa', 'jam-sama-hari-sebelumnya': 'jam identik hari sebelumnya', 'jam-manual-absen-error': 'jam diketik manual', 'tanpa-jam': 'tanpa jam',
}

export function DayDetail({ day, showMeal = true }: { day: DayRecord; showMeal?: boolean }) {
  const hr = useHr()
  const fileName = (id: string) => hr.files.find(f => f.id === id)?.fileName ?? 'sumber tidak aktif'
  const excludedEvidence = hr.files.flatMap(f => f.evidence.filter(e => e.date === day.date && hr.recordRoster.evidenceLink.get(e.id) === day.employeeId && recordDisposition(f, 'evidence', e.id)?.disposition === 'excluded'))
  const excludedAssignments = hr.files.flatMap(f => f.assignments.filter(a => a.start <= day.date && a.end >= day.date && hr.recordRoster.assignmentLink.get(a.id) === day.employeeId && recordDisposition(f, 'assignment', a.id)?.disposition === 'excluded'))
  const evidence = [...day.evidence, ...excludedEvidence], assignments = [...day.assignments, ...excludedAssignments]
  return <div className="day-detail">
    <div className="day-head">
      <div><strong>{formatID(day.date, { day: true })}</strong><span>{day.basis}</span></div>
      <StatusChip status={day.status} />
    </div>
    {evidence.length > 0 ? <div className="table-wrap"><table className="evidence">
      <thead><tr><th>Sumber</th><th>Masuk</th><th>Pulang</th><th>Keterangan</th><th>Rujukan</th></tr></thead>
      <tbody>{evidence.map(e => <tr key={e.id}>
        <td><SourceChip kind={e.kind} /><small>{e.office}</small></td>
        <td className="mono">{e.clockIn ?? (e.present ? 'hadir*' : '—')}</td>
        <td className="mono">{e.clockOut ?? (e.present && !e.incomplete ? 'hadir*' : '—')}</td>
        <td>
          {e.code && <span className="code">{DAY_CODE_LABEL[e.code]}{e.codeLabel && e.codeLabel !== e.code ? ` · "${e.codeLabel}"` : ''}</span>}
          {e.mode && <span className="code">{e.mode}{e.approved === false ? ' · Reject' : e.approved ? ' · Approved' : ''}</span>}
          {e.location && <span className="loc"><MapPin size={11} /> {e.location}{e.coordIn ? ` (${e.coordIn[0].toFixed(4)}, ${e.coordIn[1].toFixed(4)})` : ''}</span>}
          {e.schedule && <small>Jadwal {e.schedule.start}–{e.schedule.end}{e.schedule.label ? ` · ${e.schedule.label}` : ''}</small>}
          {e.lateMin ? <small>Terlambat {e.lateMin} mnt (sumber)</small> : null}
          {e.notes?.map(n => <span key={n} className="flag">{NOTE_LABEL[n] ?? n}</span>)}
        </td>
        <td><small title={fileName(e.fileId)}>{fileName(e.fileId)}</small><small>{e.ref}</small>{hr.files.find(f => f.id === e.fileId) && <RecordReview file={hr.files.find(f => f.id === e.fileId)!} kind="evidence" recordId={e.id} />}</td>
      </tr>)}</tbody>
    </table></div> : <p className="muted small">Tidak ada catatan absensi pada tanggal ini.</p>}
    {day.evidence.some(e => e.present) && <p className="muted small">* Sumber hanya mencatat kode "Normal" tanpa jam.</p>}
    {assignments.length > 0 && <div className="st-list">{assignments.map(a => <div key={a.id}>
      <FileText size={14} />
      <div><strong>ST {a.letterNo ?? '(tanpa nomor)'}{a.local ? ' · lokal' : ''}</strong><span>{a.rawDate} → {a.destination ?? 'tujuan tidak tercatat'}</span><small>Ditulis "{a.name}" · {a.unit ?? a.office} · {a.ref}</small>{hr.files.find(f => f.id === a.fileId) && <RecordReview file={hr.files.find(f => f.id === a.fileId)!} kind="assignment" recordId={a.id} />}</div>
    </div>)}</div>}
    <div className="day-facts">
      <span>Masuk <b>{day.clockIn ?? '—'}</b></span><span>Pulang <b>{day.clockOut ?? '—'}</b></span>
      {day.lateMin > 0 && <span>Terlambat <b>{day.lateMin} mnt</b></span>}
      {day.earlyMin > 0 && <span>Pulang cepat <b>{day.earlyMin} mnt</b></span>}
      {day.overtimeMin > 0 && <span>Lembur <b>{Math.round(day.overtimeMin / 6) / 10} jam</b></span>}
      {showMeal && <span className={`meal-tag m-${day.meal.state}`}>Uang makan: {day.meal.state === 'eligible' ? day.meal.amountReady ? 'hari memenuhi syarat' : 'hari memenuhi syarat, nominal pending' : day.meal.state === 'held' ? 'ditahan' : 'tidak memenuhi syarat'} · {day.meal.reason}</span>}
    </div>
    {day.resolved.length > 0 && <div className="audit">{day.resolved.map(r => <p key={r.issueId}>✓ {r.reviewer} · {new Date(r.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} · {r.decision.replace('-', ' ')}{r.note ? ` — "${r.note}"` : ''}</p>)}</div>}
  </div>
}
