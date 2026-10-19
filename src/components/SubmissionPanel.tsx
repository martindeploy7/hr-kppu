import { useEffect, useRef, useState } from 'react'
import { useHr } from '../state/HrData.tsx'
import { useAuth } from '../state/Auth.tsx'
import { api } from '../lib/api.ts'
import { Panel } from './ui.tsx'
type Submission = { id: string; period: string; office: string; status: 'submitted' | 'approved' | 'locked' | 'cancelled'; revision: number; workspaceRevision: number; creator: string }
export function SubmissionPanel() {
  const hr = useHr(), { user } = useAuth()
  const [items, setItems] = useState<Submission[]>([]), [office, setOffice] = useState(user.offices?.[0] ?? 'Semua'), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const id = useRef(crypto.randomUUID())
  const load = async () => setItems((await api<{ submissions: Submission[] }>('/meal-submissions')).submissions)
  useEffect(() => { void load().catch(e => setError(e.message)) }, [])
  const action = async (s?: Submission, action?: string) => {
    setBusy(true); setError('')
    try {
      await api(s ? `/meal-submissions/${s.id}/${action}` : '/meal-submissions', { method: 'POST', body: JSON.stringify(s ? { expectedRevision: s.revision, reason: note } : { id: id.current, office, period: hr.activePeriod, expectedRevision: hr.revision }) })
      if (!s) id.current = crypto.randomUUID()
      await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <Panel title="Pengajuan & snapshot periode" sub="Pengajuan memakai perhitungan server. SDM mengajukan, akun Keuangan yang berbeda menyetujui dan mengunci. Snapshot tidak berubah ketika sumber direvisi.">
    <div className="toolbar"><label>Kantor pengajuan <select className="select" value={office} onChange={e => setOffice(e.target.value)}>{!user.offices?.length && <option>Semua</option>}{[...new Set(hr.roster.employees.map(e => e.kantor))].filter(Boolean).map(o => <option key={o}>{o}</option>)}</select></label>
      {['admin', 'hr'].includes(user.role) && <button className="btn primary" disabled={busy || hr.saveStatus !== 'saved'} onClick={() => action()}>Ajukan {hr.activePeriod}</button>}
      <button className="btn secondary" onClick={() => void load().catch(e => setError(e.message))}>Muat pengajuan</button>
    </div>
    <label className="inline-num">Catatan tindakan <input value={note} onChange={e => setNote(e.target.value)} placeholder="Alasan persetujuan, penguncian atau pembatalan" maxLength={2000} /></label>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="table-wrap"><table className="data"><thead><tr><th>Periode</th><th>Kantor</th><th>Status</th><th>Pengaju</th><th>Data r</th><th>Tindakan</th></tr></thead><tbody>{items.map(s => <tr key={s.id}><td>{s.period}</td><td>{s.office}</td><td>{s.status}</td><td>{s.creator}</td><td>{s.workspaceRevision}</td><td><a className="link" href={`/api/meal-submissions/${s.id}/export`}>Unduh snapshot Excel</a>{['admin', 'finance'].includes(user.role) && s.status === 'submitted' && <button className="link" disabled={busy || note.trim().length < 3} onClick={() => action(s, 'approve')}>Setujui</button>}{['admin', 'finance'].includes(user.role) && s.status === 'approved' && <button className="link" disabled={busy || note.trim().length < 3} onClick={() => action(s, 'lock')}>Kunci</button>}{['admin', 'hr', 'finance'].includes(user.role) && ['submitted', 'approved'].includes(s.status) && <button className="link" disabled={busy || note.trim().length < 3} onClick={() => action(s, 'cancel')}>Batalkan pengajuan</button>}</td></tr>)}</tbody></table></div>
    {!items.length && <p className="muted">Belum ada pengajuan. Lengkapi seluruh bukti, review, tarif dan coverage ST sebelum mengajukan.</p>}
  </Panel>
}
