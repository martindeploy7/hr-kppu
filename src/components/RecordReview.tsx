import { useEffect, useRef, useState } from 'react'
import type { RecordReview as Review, SourceFile } from '../engine/types.ts'
import { recordDisposition } from '../engine/recordReviews.ts'
import { STATUS_LABEL } from '../engine/reconcile.ts'
import type { RecordReviewPreview, ReviewDay } from '../../shared/recordReviews.ts'
import { api } from '../lib/api.ts'
import { useAuth } from '../state/Auth.tsx'
import { useHr } from '../state/HrData.tsx'
const stateLabel: Record<string, string> = { eligible: 'hari memenuhi syarat', held: 'ditahan', excluded: 'tidak memenuhi syarat' }
const facts = (day: ReviewDay) => `${STATUS_LABEL[day.status as keyof typeof STATUS_LABEL] ?? 'Tidak dalam roster aktif'} · ${day.clockIn || '—'}–${day.clockOut || '—'} · ${stateLabel[day.mealState]}${day.mealState === 'eligible' && !day.amountReady ? ', nominal pending' : ''} · ${day.amountReady ? `Rp${day.amount.toLocaleString('id-ID')}` : 'nominal belum siap'} · ${day.issues} isu terbuka`

export function RecordReview({ file, kind, recordId }: { file: SourceFile; kind: Review['kind']; recordId: string }) {
  const hr = useHr(), { user } = useAuth(), latest = recordDisposition(file, kind, recordId)
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [preview, setPreview] = useState<RecordReviewPreview | null>(null), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [page, setPage] = useState(0)
  const id = useRef(crypto.randomUUID())
  const record = (kind === 'evidence' ? file.evidence : file.assignments).find(r => r.id === recordId)
  const editable = ['admin', 'hr'].includes(user.role) && (!user.offices?.length || user.offices.includes(record?.office ?? ''))
  const excluded = latest?.disposition === 'excluded'
  useEffect(() => { setPreview(null); setConfirmed(false) }, [reason, hr.revision, latest?.id])
  if (!record) return null
  const request = { id: id.current, expectedRevision: hr.revision, recordId, kind, reason, disposition: excluded ? 'active' as const : 'excluded' as const }
  const inspect = async () => {
    setBusy(true); setError(''); setPreview(null); setConfirmed(false); setPage(0)
    try { setPreview(await api<RecordReviewPreview>(`/sources/${file.id}/record-review/preview`, { method: 'POST', body: JSON.stringify(request) })) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const save = async () => {
    if (!preview || !confirmed) return
    setBusy(true); setError('')
    try { await hr.reviewRecord(file.id, { ...request, confirmedImpact: preview.checksum }); setOpen(false); setReason(''); setPreview(null); id.current = crypto.randomUUID() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="record-review">
    {excluded && <span className="tag warn">Dikeluarkan dari bukti aktif</span>}
    <button className="link" onClick={() => setOpen(v => !v)} aria-expanded={open}>Tinjau {kind === 'assignment' ? 'peserta ST' : 'bukti'} · {record.ref}</button>
    {open && <section className="import-preview" aria-label={`Review ${record.ref}`}>
      <p><strong>{record.name}</strong> · {file.fileName} · {record.ref}</p>
      {latest && <p>Keputusan terakhir: {excluded ? 'dikeluarkan' : 'diaktifkan kembali'} oleh {latest.reviewer} · {new Date(latest.at).toLocaleString('id-ID')} · {latest.reason}</p>}
      {editable && <><p>{excluded ? 'Aktifkan kembali catatan asli. Bukti lain dan aturan UM tetap diperiksa.' : kind === 'assignment' ? 'Keluarkan peserta ST ini bila batal atau salah peserta/tanggal. Peserta lain tetap aktif.' : 'Tolak bukti ini bila tidak sah; pasangan jam dari bukti lain tetap diperiksa tanpa menggabungkan jam antarbaris.'} Catatan asli tetap diarsipkan.</p>
        <label>Dasar koreksi {record.ref}<textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} placeholder="Alasan dan rujukan dokumen pendukung, minimal 10 karakter" disabled={busy} /></label>
        <button className="btn secondary" disabled={busy || reason.trim().length < 10 || hr.saveStatus !== 'saved'} onClick={() => void inspect()}>Preview dampak</button>
        {preview && <div>
          <p><strong>{preview.affected.length} hari pegawai berubah</strong> · {preview.record.start}–{preview.record.end}</p>
          <p>Perubahan berikut berlaku pada kalkulasi ruang kerja. Snapshot terkunci tetap utuh dan memerlukan pengajuan versi koreksi.</p>
          {preview.affected.length > 0 ? <><div className="table-wrap"><table className="data"><thead><tr><th>Pegawai / tanggal</th><th>Sebelum</th><th>Sesudah</th></tr></thead><tbody>{preview.affected.slice(page * 10, (page + 1) * 10).map(row => <tr key={`${row.employeeId}|${row.date}`}><td>{row.name}<br />{row.date}</td><td>{facts(row.before)}</td><td>{facts(row.after)}</td></tr>)}</tbody></table></div>
            {preview.affected.length > 10 && <div className="form-actions"><button className="btn secondary" disabled={!page} onClick={() => setPage(p => p - 1)}>Sebelumnya</button><span>Halaman {page + 1}/{Math.ceil(preview.affected.length / 10)}</span><button className="btn secondary" disabled={(page + 1) * 10 >= preview.affected.length} onClick={() => setPage(p => p + 1)}>Berikutnya</button></div>}</> : <p>Tidak ada perubahan status, jam atau hak terhitung. Keputusan tetap dicatat untuk sumber ini.</p>}
          <label className="review-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy} /> Saya telah memeriksa dampak dan dasar koreksi.</label>
          <button className="btn primary" disabled={busy || !confirmed || hr.saveStatus !== 'saved'} onClick={() => void save()}>{busy ? 'Menyimpan…' : excluded ? 'Aktifkan kembali catatan' : kind === 'assignment' ? 'Keluarkan peserta ST' : 'Tolak bukti ini'}</button>
        </div>}
      </>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <details><summary>Riwayat keputusan ({file.recordReviews?.filter(r => r.kind === kind && r.recordId === recordId).length ?? 0})</summary>{file.recordReviews?.filter(r => r.kind === kind && r.recordId === recordId).map(r => <p key={r.id}>{r.disposition === 'excluded' ? 'Dikeluarkan' : 'Diaktifkan kembali'} · {r.reviewer} · {new Date(r.at).toLocaleString('id-ID')} · {r.reason}</p>)}</details>
    </section>}
  </div>
}
