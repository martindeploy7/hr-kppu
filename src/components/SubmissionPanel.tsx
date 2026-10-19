import { useEffect, useRef, useState } from 'react'
import { useHr } from '../state/HrData.tsx'
import { useAuth } from '../state/Auth.tsx'
import { api } from '../lib/api.ts'
import type { MealSnapshot } from '../../shared/submissions.ts'
import { Panel } from './ui.tsx'
type Submission = { id: string; period: string; office: string; status: 'submitted' | 'approved' | 'locked' | 'cancelled'; revision: number; workspaceRevision: number; creator: string; version: number; supersedesId?: string; supersededBy?: string; correctionId?: string; correctionReason?: string; createdBy: string }
const money = (n: number) => n.toLocaleString('id-ID')
export function SubmissionPanel() {
  const hr = useHr(), { user } = useAuth()
  const [items, setItems] = useState<Submission[]>([]), [office, setOffice] = useState(user.offices?.[0] ?? 'Semua'), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<(Submission & { snapshot: MealSnapshot }) | null>(null)
  const id = useRef(crypto.randomUUID())
  const load = async () => setItems((await api<{ submissions: Submission[] }>('/meal-submissions')).submissions)
  useEffect(() => { void load().catch(e => setError(e.message)) }, [])
  const view = async (s: Submission) => {
    try { setDetail((await api<{ submission: Submission & { snapshot: MealSnapshot } }>(`/meal-submissions/${s.id}`)).submission) }
    catch (e) { setError((e as Error).message) }
  }
  const action = async (s?: Submission, action?: string) => {
    setBusy(true); setError('')
    try {
      const correcting = action === 'correct'
      const path = s && !correcting ? `/meal-submissions/${s.id}/${action}` : '/meal-submissions'
      const body = correcting && s ? { id: id.current, office: s.office, period: s.period, expectedRevision: hr.revision, supersedesId: s.id, reason: note } : s ? { expectedRevision: s.revision, reason: note } : { id: id.current, office, period: hr.activePeriod, expectedRevision: hr.revision }
      const response = await api<{ submission: Submission & { snapshot: MealSnapshot } }>(path, { method: 'POST', body: JSON.stringify(body) })
      if (!s || correcting) id.current = crypto.randomUUID()
      setDetail(response.submission); await load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const correction = detail?.snapshot.correction
  const delta = correction?.delta.reduce((s, d) => s + d.after.netto - d.before.netto, 0) ?? 0
  return <Panel title="Pengajuan & snapshot periode" sub="SDM mengajukan; akun Keuangan yang berbeda menyetujui dan mengunci. Koreksi menjadi versi pengganti dengan persetujuan ulang. Snapshot sebelumnya tetap diarsipkan.">
    <div className="toolbar"><label>Kantor pengajuan <select className="select" value={office} onChange={e => setOffice(e.target.value)}>{!user.offices?.length && <option>Semua</option>}{[...new Set(hr.roster.employees.map(e => e.kantor))].filter(Boolean).map(o => <option key={o}>{o}</option>)}</select></label>
      {['admin', 'hr'].includes(user.role) && <button className="btn primary" disabled={busy || hr.saveStatus !== 'saved'} onClick={() => action()}>Ajukan {hr.activePeriod}</button>}
      <button className="btn secondary" disabled={busy} onClick={() => void load().catch(e => setError(e.message))}>Muat pengajuan</button>
    </div>
    <label className="inline-num">Catatan tindakan <input value={note} onChange={e => setNote(e.target.value)} placeholder="Alasan tindakan; koreksi minimal 10 karakter" maxLength={2000} /></label>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="table-wrap"><table className="data"><thead><tr><th>Periode</th><th>Kantor</th><th>Versi & status</th><th>Pengaju</th><th>Data r</th><th>Tindakan</th></tr></thead><tbody>{items.map(s => <tr key={s.id}><td>{s.period}</td><td>{s.office}</td><td>v{s.version} · {s.supersededBy ? 'arsip digantikan' : s.status}{s.correctionId && !s.supersededBy && <p className="muted">Usulan koreksi sedang diproses</p>}</td><td>{s.creator}</td><td>{s.workspaceRevision}</td><td>
      <a className="link" href={`/api/meal-submissions/${s.id}/export`}>Unduh snapshot Excel</a>
      <button className="link" disabled={busy} onClick={() => void view(s)}>Lihat rincian v{s.version}</button>
      {['admin', 'finance'].includes(user.role) && s.createdBy !== user.id && s.status === 'submitted' && <button className="link" disabled={busy || note.trim().length < 3} onClick={() => action(s, 'approve')}>Setujui</button>}
      {['admin', 'finance'].includes(user.role) && s.createdBy !== user.id && s.status === 'approved' && <button className="link" disabled={busy || note.trim().length < 3} onClick={() => action(s, 'lock')}>Kunci</button>}
      {(['admin', 'finance'].includes(user.role) || (user.role === 'hr' && s.createdBy === user.id)) && ['submitted', 'approved'].includes(s.status) && <button className="link" disabled={busy || note.trim().length < 3} onClick={() => action(s, 'cancel')}>Batalkan pengajuan</button>}
      {['admin', 'hr'].includes(user.role) && s.status === 'locked' && !s.correctionId && <button className="link" disabled={busy || note.trim().length < 10 || hr.saveStatus !== 'saved'} onClick={() => action(s, 'correct')}>Ajukan koreksi v{s.version + 1}</button>}
    </td></tr>)}</tbody></table></div>
    {!items.length && <p className="muted">Belum ada pengajuan. Lengkapi seluruh bukti, review, tarif dan coverage ST sebelum mengajukan.</p>}
    {detail && <section className="import-preview" aria-label="Rincian snapshot pengajuan">
      <div className="preview-head"><div><strong>{detail.period} · {detail.office} · v{detail.version} · {detail.status}</strong><p>{detail.supersededBy ? 'Versi arsip telah digantikan. Gunakan versi terkunci terbaru.' : 'Nominatif merupakan versi penuh. Selisih koreksi menjadi bahan pemeriksaan, bukan pembayaran tambahan otomatis.'}</p></div><button className="btn secondary" onClick={() => setDetail(null)}>Tutup rincian</button></div>
      <p>{detail.snapshot.months.length} pegawai · netto nominatif Rp{money(detail.snapshot.months.reduce((s, m) => s + m.netto, 0))} · revisi data {detail.workspaceRevision}</p>
      {correction && <><p><strong>Alasan koreksi:</strong> {correction.reason}</p><p>Selisih netto terhadap versi sebelumnya: <strong>Rp{money(delta)}</strong> · {correction.delta.length} hari pegawai berubah.</p>
        <details><summary>Referensi versi sebelumnya</summary><p className="mono">{correction.parentId}</p><p className="mono">{correction.parentChecksum}</p></details>
        {correction.delta.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th>Pegawai</th><th>Tanggal</th><th>Netto lama</th><th>Netto baru</th><th>Selisih</th></tr></thead><tbody>{correction.delta.map(d => <tr key={d.key}><td>{d.name}</td><td>{d.date}</td><td>{money(d.before.netto)}</td><td>{money(d.after.netto)}</td><td>{money(d.after.netto - d.before.netto)}</td></tr>)}</tbody></table></div> : <p>Tidak ada perubahan hari/nominal terhadap versi sebelumnya. Periksa perubahan fakta pada snapshot dan sumber.</p>}
      </>}
    </section>}
  </Panel>
}
