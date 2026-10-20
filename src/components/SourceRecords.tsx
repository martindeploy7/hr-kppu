import { useMemo, useState } from 'react'
import type { SourceFile } from '../engine/types.ts'
import { sourceRecordState } from '../engine/recordReviews.ts'
import { RecordReview } from './RecordReview.tsx'

export function SourceRecords({ file }: { file: SourceFile }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const entries = useMemo(() => [
    ...file.assignments.map(a => ({ record: a, kind: 'assignment' as const, date: `${a.start}—${a.end}`, detail: `ST ${a.letterNo ?? '(tanpa nomor)'} · ${a.destination ?? ''}` })),
    ...file.evidence.map(e => ({ record: e, kind: 'evidence' as const, date: e.date, detail: `${e.clockIn ?? '—'}–${e.clockOut ?? '—'} · ${e.code ?? e.mode ?? ''}` })),
  ].filter(row => `${row.record.name} ${row.record.ref} ${row.detail} ${row.date}`.toLowerCase().includes(query.trim().toLowerCase())), [file, query])
  return <section className="source-records" aria-label={`Catatan sumber ${file.fileName}`}>
    <h4>Catatan sumber & koreksi</h4>
    <p>Baris asli tetap tersedia. Keputusan mengeluarkan catatan hanya mengubah bukti aktif; peserta dan bukti lain tetap diperiksa.</p>
    <label>Cari catatan {file.fileName}<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} placeholder="Nama, tanggal, nomor ST atau referensi" /></label>
    <p>{entries.length} catatan ditemukan</p>
    <div className="table-wrap"><table className="data"><thead><tr><th>Nama & tanggal</th><th>Catatan asli</th><th>Review</th></tr></thead><tbody>{entries.slice(page * 10, (page + 1) * 10).map(row => { const status = sourceRecordState(file, row.kind, row.record.id); const label = status === 'active' ? 'Aktif' : status === 'excluded' ? 'Dikeluarkan dari bukti aktif' : status === 'superseded' ? 'Diganti oleh revisi register' : 'Diarsipkan; tidak dipilih saat impor'; return <tr key={`${row.kind}-${row.record.id}`}><td>{row.record.name}<br />{row.date}</td><td>{row.detail}<br />{row.record.ref}<p>{label}</p></td><td><RecordReview file={file} kind={row.kind} recordId={row.record.id} /></td></tr> })}</tbody></table></div>
    {entries.length > 10 && <div className="form-actions"><button className="btn secondary" disabled={!page} onClick={() => setPage(p => p - 1)}>Sebelumnya</button><span>Halaman {page + 1}/{Math.ceil(entries.length / 10)}</span><button className="btn secondary" disabled={(page + 1) * 10 >= entries.length} onClick={() => setPage(p => p + 1)}>Berikutnya</button></div>}
  </section>
}
