import { useState } from 'react'
import type { Employee } from '../engine/types.ts'
import { useHr } from '../state/HrData.tsx'
import { useAuth } from '../state/Auth.tsx'
export function EmploymentPeriods({ employee }: { employee: Employee }) {
  const hr = useHr(), { user } = useAuth()
  const [kind, setKind] = useState<'tugas-belajar' | 'diperbantukan'>('tugas-belajar'), [start, setStart] = useState(''), [end, setEnd] = useState(''), [basis, setBasis] = useState('')
  const [rateStart, setRateStart] = useState(''), [rateEnd, setRateEnd] = useState(''), [rate, setRate] = useState(''), [pph, setPph] = useState(''), [rateBasis, setRateBasis] = useState(''), [error, setError] = useState('')
  return <>
    <section className="profile-block"><h3>Status kerja bertanggal</h3><p>Tugas belajar dan diperbantukan ke instansi lain menggugurkan UM hanya pada rentang efektif yang dicatat.</p>
      <ul>{employee.workStatusPeriods?.map((p, i) => <li key={i}>{p.kind}: {p.start} — {p.end} · {p.basis} {['admin', 'hr'].includes(user.role) && <button className="link" onClick={() => hr.updateEmployee(employee.id, { workStatusPeriods: employee.workStatusPeriods!.filter((_, n) => n !== i) })}>Cabut periode</button>}</li>)}</ul>
      {['admin', 'hr'].includes(user.role) && <form onSubmit={e => { e.preventDefault(); setError(''); if (start > end) { setError('Tanggal akhir harus setelah tanggal awal'); return }; hr.updateEmployee(employee.id, { workStatusPeriods: [...(employee.workStatusPeriods ?? []), { kind, start, end, basis }] }); setBasis('') }}>
        <div className="import-preview-fields"><label>Status<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="tugas-belajar">Tugas belajar</option><option value="diperbantukan">Diperbantukan ke instansi lain</option></select></label><label>Mulai<input type="date" required value={start} onChange={e => setStart(e.target.value)} /></label><label>Sampai<input type="date" required min={start} value={end} onChange={e => setEnd(e.target.value)} /></label><label>Dasar dokumen<input required minLength={3} value={basis} onChange={e => setBasis(e.target.value)} /></label></div><button className="btn secondary" disabled={hr.saveStatus === 'saving'}>Tambahkan periode status</button>
      </form>}
    </section>
    <section className="profile-block"><h3>Tarif efektif pegawai</h3><p>Diisi Keuangan bila tarif/pajak berubah. Rentang tidak boleh tumpang tindih. Hari di luar profil efektif tetap pending.</p>
      <ul>{employee.rateHistory?.map((p, i) => <li key={i}>{p.start} — {p.end}: Rp{p.rate.toLocaleString('id-ID')} · PPh {p.pph}% · {p.basis} {['admin', 'finance'].includes(user.role) && <button className="link" onClick={() => hr.updateEmployee(employee.id, { rateHistory: employee.rateHistory!.filter((_, n) => n !== i) })}>Cabut tarif</button>}</li>)}</ul>
      {['admin', 'finance'].includes(user.role) && <form onSubmit={e => { e.preventDefault(); setError(''); if (rateStart > rateEnd || employee.rateHistory?.some(p => p.start <= rateEnd && p.end >= rateStart)) { setError('Rentang tarif terbalik atau tumpang tindih'); return }; hr.updateEmployee(employee.id, { rateHistory: [...(employee.rateHistory ?? []), { start: rateStart, end: rateEnd, rate: Number(rate), pph: Number(pph), basis: rateBasis }] }); setRateBasis('') }}>
        <div className="import-preview-fields"><label>Tarif mulai<input type="date" required value={rateStart} onChange={e => setRateStart(e.target.value)} /></label><label>Tarif sampai<input type="date" required min={rateStart} value={rateEnd} onChange={e => setRateEnd(e.target.value)} /></label><label>Tarif rupiah<input type="number" required min={0} max={10000000} step={1} value={rate} onChange={e => setRate(e.target.value)} /></label><label>PPh persen<input type="number" required min={0} max={100} step="any" value={pph} onChange={e => setPph(e.target.value)} /></label><label>Dasar tarif<input required minLength={3} value={rateBasis} onChange={e => setRateBasis(e.target.value)} /></label></div><button className="btn secondary" disabled={hr.saveStatus === 'saving'}>Tambahkan tarif efektif</button>
      </form>}
    </section>
    {error && <p role="alert" className="form-error">{error}</p>}
  </>
}
