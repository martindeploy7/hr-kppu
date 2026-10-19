import { useState } from 'react'
import { useHr } from '../state/HrData.tsx'
import { useAuth } from '../state/Auth.tsx'
import { api, downloadJson } from '../lib/api.ts'
import { idbGet } from '../state/idb.ts'
import { Panel, PageHeader, Note } from '../components/ui.tsx'
import { OFFICES } from '../engine/ids.ts'
import { roles, type Workspace, type Role } from '../../shared/workspace.ts'
type Preview = { state: Workspace; files: number; master: number; reviews: number; warnings: string[] }
type Audit = { id: string; action: string; actorName: string; revision: number; reason: string; at: string }
export function WorkspaceSettings() {
  const hr = useHr(), { user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [ack, setAck] = useState(false)
  const [nilOffice, setNilOffice] = useState(user.offices?.[0] ?? 'Pusat'), [nilPeriod, setNilPeriod] = useState(hr.activePeriod), [nilBasis, setNilBasis] = useState('')
  const [events, setEvents] = useState<Audit[]>([]), [email, setEmail] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState(''), [role, setRole] = useState<Role>('viewer'), [accountOffice, setAccountOffice] = useState('')
  const check = async (input: unknown) => {
    setBusy(true); setError(''); setAck(false)
    try { setPreview(await api<Preview>('/backup/preview', { method: 'POST', body: JSON.stringify({ state: input }) })) }
    catch (e) { setError((e as Error).message); setPreview(null) } finally { setBusy(false) }
  }
  const restore = async () => {
    if (!preview || !ack) return
    setBusy(true); setError(''); hr.backup()
    try { await hr.restoreBackup(preview.state); setPreview(null); setAck(false); setMessage('Backup dipulihkan. Restore point versi sebelumnya disimpan oleh server.') }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="page">
    <PageHeader title="Ruang kerja & akses">{user.name} · {user.role} · {user.offices?.join(', ') || 'Semua kantor'} · revisi server {hr.revision}. Keputusan dicatat menggunakan akun yang masuk.</PageHeader>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    <Panel title="Password akun" sub="Ganti password melalui akun sendiri. Sesi lain akan dicabut setelah perubahan berhasil.">
      <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); setCurrentPassword(''); setNewPassword(''); setMessage('Password diperbarui; sesi lain telah dicabut.') } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>
        <div className="import-preview-fields"><label>Password saat ini<input type="password" required autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label><label>Password baru<input type="password" required minLength={14} maxLength={256} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label></div><button className="btn primary" disabled={busy}>Ganti password</button>
      </form>
    </Panel>
    <Panel title="Backup dan pemulihan" sub="JSON berisi data personal. Simpan di lokasi privat. Workbook asli memerlukan backup database tersendiri.">
      <button className="btn secondary" onClick={hr.backup}>Unduh backup ruang kerja</button>
      {user.role === 'admin' && <>
        <div className="import-preview-fields">
          <label>Periksa backup JSON<input type="file" accept=".json" disabled={busy} onChange={async e => {
            const file = e.target.files?.[0]; if (!file) return
            try { if (file.size > 20 * 1024 * 1024) throw new Error('Backup maksimal 20 MB'); const data = JSON.parse(await file.text()); await check(data.state ?? data) } catch (err) { setError((err as Error).message) }
            e.target.value = ''
          }} /></label>
        </div>
        <button className="btn secondary" disabled={busy} onClick={async () => {
          try { const legacy = await idbGet<unknown>('state-v1'); if (!legacy) { setMessage('Tidak ada workspace prototype pada browser/origin ini. Gunakan backup dari browser asal.'); return }; downloadJson('KPPU_HR_prototype_sebelum_migrasi.json', legacy); await check(legacy) }
          catch (e) { setError(`Data lokal gagal dibaca: ${(e as Error).message}. Data lama tidak dihapus.`) }
        }}>Periksa data prototype lokal</button>
        {preview && <div className="import-preview">
          <h3>Preview pemulihan</h3><p>{preview.files} sumber · {preview.master} master · {preview.reviews} keputusan.</p>
          {preview.warnings.map(w => <p key={w}>{w}</p>)}
          <Note tone="warn">Seluruh ruang kerja server akan diganti dengan isi backup. Backup versi saat ini diunduh sebelum restore dan disimpan sebagai restore point di server.</Note>
          <label className="toggle-row"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /><span>Saya memahami ruang kerja bersama akan diganti.</span></label>
          <button className="btn primary" disabled={!ack || busy || hr.saveStatus === 'saving'} onClick={restore}>{busy ? 'Memulihkan…' : 'Pulihkan backup'}</button> <button className="btn secondary" onClick={() => setPreview(null)}>Batalkan</button>
        </div>}
      </>}
    </Panel>
    {['admin', 'hr'].includes(user.role) && <Panel title="Pernyataan nihil ST" sub="Gunakan hanya bila kantor mengonfirmasi tidak ada penugasan pada seluruh bulan yang telah selesai. Ini pernyataan eksplisit, bukan kesimpulan dari file yang kosong.">
      <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await hr.declareNilSt(nilOffice, nilPeriod, nilBasis); setMessage('Pernyataan nihil ST dicatat dengan aktor dan dasar konfirmasi.'); setNilBasis('') } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>
        <div className="import-preview-fields"><label>Kantor<select value={nilOffice} onChange={e => setNilOffice(e.target.value)}>{OFFICES.filter(o => !user.offices?.length || user.offices.includes(o)).map(o => <option key={o}>{o}</option>)}</select></label><label>Bulan<input type="month" required value={nilPeriod} onChange={e => setNilPeriod(e.target.value)} /></label><label>Dasar konfirmasi<input required minLength={10} maxLength={2000} value={nilBasis} onChange={e => setNilBasis(e.target.value)} /></label></div><button className="btn primary" disabled={busy || hr.saveStatus !== 'saved'}>Catat pernyataan nihil</button>
      </form>
    </Panel>}
    {user.role === 'admin' && <Panel title="Buat akun" sub="Pilih peran dan cakupan kantor. Administrator mengelola seluruh kantor; akun lain dapat dibatasi ke satu kantor.">
      <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await api('/users', { method: 'POST', body: JSON.stringify({ email, name, password, role, offices: accountOffice && role !== 'admin' ? [accountOffice] : null }) }); setPassword(''); setEmail(''); setName(''); setMessage('Akun dibuat. Sampaikan akses melalui kanal privat yang disepakati.') } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>
        <div className="import-preview-fields"><label>Nama akun<input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password awal<input type="password" required minLength={14} maxLength={256} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><label>Peran<select value={role} onChange={e => { setRole(e.target.value as Role); if (e.target.value === 'admin') setAccountOffice('') }}>{roles.map(r => <option key={r}>{r}</option>)}</select></label><label>Cakupan kantor<select disabled={role === 'admin'} value={accountOffice} onChange={e => setAccountOffice(e.target.value)}><option value="">Semua kantor</option>{OFFICES.map(o => <option key={o}>{o}</option>)}</select></label></div>
        <button className="btn primary" disabled={busy}>Buat akun</button>
      </form>
    </Panel>}
    {!user.offices?.length && ['admin', 'reviewer', 'finance'].includes(user.role) && <Panel title="Riwayat perubahan server" sub="100 perubahan material terakhir. Riwayat ini terpisah dari label reviewer yang dipulihkan dari backup lama.">
      <button className="btn secondary" onClick={async () => { try { setEvents((await api<{ events: Audit[] }>('/audit')).events) } catch (e) { setError((e as Error).message) } }}>Muat riwayat</button>
      <div className="table-wrap"><table className="data"><thead><tr><th>Waktu</th><th>Aktor</th><th>Tindakan</th><th>Revisi</th><th>Alasan</th></tr></thead><tbody>{events.map(e => <tr key={e.id}><td>{new Date(e.at).toLocaleString('id-ID')}</td><td>{e.actorName}</td><td>{e.action}</td><td>{e.revision}</td><td>{e.reason}</td></tr>)}</tbody></table></div>
    </Panel>}
  </div>
}
