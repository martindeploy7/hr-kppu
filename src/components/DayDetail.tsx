import { FileText, MapPin } from 'lucide-react'
import type { DayRecord } from '../engine/reconcile.ts'
import { formatID } from '../engine/dates.ts'
import { DAY_CODE_LABEL } from '../engine/parsers/common.ts'
import { useHr } from '../state/HrData.tsx'
import { SourceChip, StatusChip } from './ui.tsx'

const NOTE_LABEL: Record<string, string> = {
  'jadwal-puasa': 'jadwal puasa', 'jam-sama-hari-sebelumnya': 'jam identik hari sebelumnya', 'jam-manual-absen-error': 'jam diketik manual', 'tanpa-jam': 'tanpa jam',
}

export function DayDetail({ day, showMeal = true }: { day: DayRecord; showMeal?: boolean }) {
  const hr = useHr()
  const fileName = (id: string) => hr.files.find(f => f.id === id)?.fileName ?? 'file dihapus'
  return <div className="day-detail">
    <div className="day-head">
      <div><strong>{formatID(day.date, { day: true })}</strong><span>{day.basis}</span></div>
      <StatusChip status={day.status} />
    </div>
    {day.evidence.length > 0 ? <div className="table-wrap"><table className="evidence">
      <thead><tr><th>Sumber</th><th>Masuk</th><th>Pulang</th><th>Keterangan</th><th>Rujukan</th></tr></thead>
      <tbody>{day.evidence.map(e => <tr key={e.id}>
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
        <td><small title={fileName(e.fileId)}>{fileName(e.fileId)}</small><small>{e.ref}</small></td>
      </tr>)}</tbody>
    </table></div> : <p className="muted small">Tidak ada catatan absensi pada tanggal ini.</p>}
    {day.evidence.some(e => e.present) && <p className="muted small">* Sumber hanya mencatat kode "Normal" tanpa jam.</p>}
    {day.assignments.length > 0 && <div className="st-list">{day.assignments.map(a => <div key={a.id}>
      <FileText size={14} />
      <div><strong>ST {a.letterNo ?? '(tanpa nomor)'}{a.local ? ' · lokal' : ''}</strong><span>{a.rawDate} → {a.destination ?? 'tujuan tidak tercatat'}</span><small>Ditulis "{a.name}" · {a.unit ?? a.office} · {a.ref}</small></div>
    </div>)}</div>}
    <div className="day-facts">
      <span>Masuk <b>{day.clockIn ?? '—'}</b></span><span>Pulang <b>{day.clockOut ?? '—'}</b></span>
      {day.lateMin > 0 && <span>Terlambat <b>{day.lateMin} mnt</b></span>}
      {day.earlyMin > 0 && <span>Pulang cepat <b>{day.earlyMin} mnt</b></span>}
      {day.overtimeMin > 0 && <span>Lembur <b>{Math.round(day.overtimeMin / 6) / 10} jam</b></span>}
      {showMeal && <span className={`meal-tag m-${day.meal.state}`}>Uang makan: {day.meal.state === 'eligible' ? 'dibayar' : day.meal.state === 'held' ? 'ditahan' : 'tidak'} · {day.meal.reason}</span>}
    </div>
    {day.resolved.length > 0 && <div className="audit">{day.resolved.map(r => <p key={r.issueId}>✓ {r.reviewer} · {new Date(r.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} · {r.decision.replace('-', ' ')}{r.note ? ` — "${r.note}"` : ''}</p>)}</div>}
  </div>
}
