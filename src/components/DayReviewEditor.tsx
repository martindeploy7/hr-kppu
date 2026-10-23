import { useMemo, useState } from 'react'
import { CheckCircle2, Save } from 'lucide-react'
import { useAuth } from '../state/Auth.tsx'
import { useHr } from '../state/HrData.tsx'
import { STATUS_LABEL, type DayRecord } from '../engine/reconcile.ts'
import { dayReviewProblem, unresolvedIdentityEvidence } from '../engine/dayReview.ts'
import type { DayReview, ValidatedDayStatus } from '../engine/types.ts'
import { SourceChip } from './ui.tsx'

const STATUSES: ValidatedDayStatus[] = ['hadir', 'hadir-wfa', 'dinas-lokal', 'dinas-luar', 'diklat', 'cuti', 'sakit', 'izin', 'tanpa-keterangan']

export function DayReviewEditor({ day }: { day: DayRecord }) {
  const hr = useHr(), { user } = useAuth()
  const old = useMemo(() => hr.dayReviews.find(r => r.employeeId === day.employeeId && r.date === day.date), [hr.dayReviews, day.employeeId, day.date])
  const stale = !!old && (!day.decision || old.signature !== day.reviewSignature)
  const [status, setStatus] = useState<ValidatedDayStatus | ''>(day.decision?.status ?? '')
  const [evidenceIds, setEvidenceIds] = useState<string[]>(day.decision?.evidenceIds ?? [])
  const [assignmentIds, setAssignmentIds] = useState<string[]>(day.decision?.assignmentIds ?? [])
  const [note, setNote] = useState(day.decision?.note ?? '')
  const [error, setError] = useState('')
  const canReview = ['admin', 'hr', 'reviewer'].includes(user.role)
  const current = day.decision

  const toggle = (ids: string[], id: string, set: (value: string[]) => void) => set(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])
  const save = () => {
    setError('')
    if (!status) { setError('Pilih status aktivitas yang akan disahkan.'); return }
    const review: DayReview = { employeeId: day.employeeId, date: day.date, status, evidenceIds, assignmentIds, note, reviewer: user.name, actorId: user.id, at: new Date().toISOString(), signature: day.reviewSignature }
    const problem = dayReviewProblem(review, day.evidence, day.assignments)
    if (problem) { setError(problem); return }
    if (unresolvedIdentityEvidence(day.evidence.filter(e => evidenceIds.includes(e.id)), day.employeeId, hr.roster.identity).length) { setError('Selesaikan pencocokan identitas bukti terpilih sebelum menetapkan hari valid.'); return }
    hr.reviewDay(review)
  }

  return <section className="day-review" aria-label="Keputusan validasi harian">
    <div className="day-review-head"><div><strong>Keputusan hari</strong><span>{day.reviewState === 'valid' ? `Valid · ${current?.reviewer ?? 'Admin'}` : day.reviewState === 'future' ? 'Belum berlangsung' : day.reviewState === 'not-found' ? 'Tidak ditemukan' : 'Flag · menunggu keputusan'}</span></div>
      {day.reviewState === 'valid' && <span className="review-valid"><CheckCircle2 size={15} /> Ditetapkan admin</span>}
    </div>
    {current && <p className="muted small">{STATUS_LABEL[current.status]} · {current.note} · {new Date(current.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</p>}
    {stale && <p className="form-error" role="status">Bukti atau identitas berubah sejak keputusan terakhir. Tinjau ulang sebelum UM dihitung.</p>}
    {!canReview || day.reviewState === 'future' ? <p className="muted small">{!canReview ? 'Akun ini hanya dapat melihat keputusan.' : 'Hari yang belum berlangsung belum dapat divalidasi.'}</p> : <>
      <p className="muted small">Pilih catatan yang dipakai dan tetapkan statusnya. Catatan dari sumber lain tetap terlihat untuk audit; sumber tidak saling mengesahkan.</p>
      {day.evidence.length > 0 ? <div className="table-wrap"><table className="evidence"><thead><tr><th>Gunakan</th><th>Sumber & kantor</th><th>Masuk–pulang</th><th>Keterangan</th><th>Rujukan</th></tr></thead><tbody>{day.evidence.map(e => <tr key={e.id}>
        <td><input type="checkbox" checked={evidenceIds.includes(e.id)} onChange={() => toggle(evidenceIds, e.id, setEvidenceIds)} aria-label={`Gunakan bukti ${e.kind} ${e.ref}`} /></td>
        <td><SourceChip kind={e.kind} /><small>{e.office}</small></td>
        <td className="mono">{e.clockIn ?? '—'} – {e.clockOut ?? '—'}</td>
        <td>{e.code ?? e.mode ?? (e.present ? 'Hadir tanpa jam' : '—')}</td>
        <td><small>{hr.files.find(f => f.id === e.fileId)?.fileName ?? 'Sumber tidak aktif'}</small><small>{e.ref}</small></td>
      </tr>)}</tbody></table></div> : <p className="muted small">Tidak ada catatan absensi untuk tanggal ini.</p>}
      {day.assignments.length > 0 && <div className="st-review-list"><strong>Surat Tugas (ST)</strong>{day.assignments.map(a => <label key={a.id}>
        <input type="checkbox" checked={assignmentIds.includes(a.id)} onChange={() => toggle(assignmentIds, a.id, setAssignmentIds)} />
        <span><b>{a.letterNo ?? 'Nomor tidak tercatat'}</b> · {a.local ? 'Dinas lokal' : 'Dinas luar'}<small>{a.rawDate} · {a.destination ?? 'Tujuan tidak tercatat'} · {a.office} · {a.ref}</small></span>
      </label>)}</div>}
      <label className="review-field">Status yang ditetapkan<select value={status} onChange={e => setStatus(e.target.value as ValidatedDayStatus | '')}>
        <option value="">Pilih status harian</option>{STATUSES.map(value => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
      </select></label>
      <label className="review-field">Alasan / dasar keputusan<textarea rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="Contoh: bukti WFA disahkan setelah konfirmasi kepada pegawai." /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="btn primary" disabled={hr.saveStatus === 'saving' || hr.saveStatus === 'loading'} onClick={save}><Save size={14} /> {current ? 'Simpan perubahan keputusan' : 'Sahkan hari ini'}</button>
        {old && <button className="btn secondary" disabled={hr.saveStatus === 'saving'} onClick={() => hr.unreviewDay(day.employeeId, day.date)}>Hapus keputusan</button>}
      </div>
      <small className="muted">Reviewer: {user.name} · Perubahan tersimpan bersama revisi workspace.</small>
      {hr.saveStatus === 'saving' && <p className="muted small" role="status">Menyimpan keputusan…</p>}
      {hr.saveStatus === 'saved' && current && <p className="muted small" role="status">Keputusan tersimpan di server.</p>}
    </>}
  </section>
}
