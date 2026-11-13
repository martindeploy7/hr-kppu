import { useEffect, useState } from 'react'
import { ListSkeleton } from '../components/Skeleton.tsx'
import { useHr } from '../state/HrData.tsx'
import { useAuth } from '../state/Auth.tsx'
import { api, downloadJson } from '../lib/api.ts'
import { idbGet } from '../state/idb.ts'
import { Panel, PageHeader, Note } from '../components/ui.tsx'
import { OFFICES } from '../engine/ids.ts'
import { ROLE_LABEL, roles, type Workspace, type Role } from '../../shared/workspace.ts'
type Preview = { state: Workspace; files: number; master: number; reviews: number; warnings: string[] }
type Audit = { id: string; action: string; actorName: string; revision: number; reason: string; at: string }
type Account = { id: string; name: string; email: string; role: Role; offices: string[] | null; active: boolean }
export function WorkspaceSettings() {
  const hr = useHr(), { user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [ack, setAck] = useState(false)
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [events, setEvents] = useState<Audit[]>([]), [accounts, setAccounts] = useState<Account[]>([]), [drafts, setDrafts] = useState<Record<string, { role: Role; office: string }>>({})
  const [email, setEmail] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState(''), [role, setRole] = useState<Role>('admin'), [accountOffice, setAccountOffice] = useState('')
  const loadAccounts = async () => {
    const response = await api<{ users: Account[] }>('/users')
    setAccounts(response.users); setAccountsLoaded(true)
    setDrafts(Object.fromEntries(response.users.map(account => [account.id, { role: account.role, office: account.offices?.[0] ?? '' }])))
  }
  useEffect(() => { if (user.role === 'superadmin') void loadAccounts().catch(e => setError((e as Error).message)) }, [user.role])
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
    <PageHeader title="Ruang kerja & akses">{user.name} · {ROLE_LABEL[user.role]} · {user.offices?.join(', ') || 'Semua kantor'} · revisi server {hr.revision}. Keputusan dicatat menggunakan akun yang masuk.</PageHeader>
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
    <Panel title="Password akun" sub="Ganti password melalui akun sendiri. Sesi lain akan dicabut setelah perubahan berhasil.">
      <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await api('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }); setCurrentPassword(''); setNewPassword(''); setMessage('Password diperbarui; sesi lain telah dicabut.') } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>
        <div className="import-preview-fields"><label>Password saat ini<input type="password" required autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label><label>Password baru<input type="password" required minLength={14} maxLength={256} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label></div><button className="btn primary" disabled={busy}>Ganti password</button>
      </form>
    </Panel>
    <Panel title="Backup dan pemulihan" sub="JSON berisi data personal. Simpan di lokasi privat. Workbook asli memerlukan backup database tersendiri.">
      <button className="btn secondary" onClick={hr.backup}>Unduh backup ruang kerja</button>
      {user.role === 'superadmin' && <>
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
    {user.role === 'superadmin' && <>
      <Panel title="Buat akun" sub="Admin dapat melihat semua kantor dan menyelesaikan rekonsiliasi. Operator Rekap ST dibatasi ke satu kantor. Superadmin mempunyai akses pengelolaan penuh.">
        <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await api('/users', { method: 'POST', body: JSON.stringify({ email, name, password, role, offices: role === 'operator_st' && accountOffice ? [accountOffice] : null }) }); setPassword(''); setEmail(''); setName(''); setMessage('Akun dibuat. Sampaikan akses melalui kanal privat yang disepakati.'); await loadAccounts() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>
          <div className="import-preview-fields"><label>Nama akun<input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password awal<input type="password" required minLength={14} maxLength={256} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><label>Peran<select value={role} onChange={e => { const next = e.target.value as Role; setRole(next); setAccountOffice(next === 'operator_st' ? 'Pusat' : '') }}>{roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
            <label>Kantor cakupan<select required={role === 'operator_st'} disabled={role !== 'operator_st'} value={accountOffice} onChange={e => setAccountOffice(e.target.value)}><option value="">Semua kantor</option>{OFFICES.map(o => <option key={o}>{o}</option>)}</select></label></div>
          <button className="btn primary" disabled={busy}>Buat akun</button>
        </form>
      </Panel>
      <Panel title={`Akun terdaftar (${accounts.length})`} sub="Perubahan peran mencabut sesi akun tersebut. Akun Superadmin terakhir tidak dapat diturunkan atau dinonaktifkan.">
        {!accountsLoaded && !error ? <ListSkeleton rows={3} cols={5} label="Memuat akun…" /> : <div className="table-wrap"><table className="data"><thead><tr><th>Akun</th><th>Peran</th><th>Kantor</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>{accounts.map(account => {
          const draft = drafts[account.id] ?? { role: account.role, office: account.offices?.[0] ?? '' }
          return <tr key={account.id}><td>{account.name}<small>{account.email}</small></td><td><select aria-label={`Peran ${account.email}`} disabled={account.id === user.id || busy} value={draft.role} onChange={e => setDrafts(current => ({ ...current, [account.id]: { ...draft, role: e.target.value as Role, office: e.target.value === 'operator_st' ? draft.office || 'Pusat' : '' } }))}>{roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td><td>{draft.role === 'operator_st' ? <select aria-label={`Kantor ${account.email}`} disabled={account.id === user.id || busy} value={draft.office} onChange={e => setDrafts(current => ({ ...current, [account.id]: { ...draft, office: e.target.value } }))}>{OFFICES.map(o => <option key={o}>{o}</option>)}</select> : 'Semua kantor'}</td><td>{account.active ? 'Aktif' : 'Nonaktif'}</td><td className="account-actions">
            {account.id !== user.id && account.active && <><button className="link" disabled={busy || (draft.role === account.role && (draft.role !== 'operator_st' || draft.office === (account.offices?.[0] ?? '')))} onClick={async () => { setBusy(true); setError(''); try { await api(`/users/${account.id}/role`, { method: 'POST', body: JSON.stringify({ role: draft.role, offices: draft.role === 'operator_st' ? [draft.office] : null }) }); setMessage(`Peran ${account.email} diperbarui.`); await loadAccounts() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>Simpan peran</button><button className="link danger" disabled={busy} onClick={async () => { const reason = window.prompt(`Alasan menonaktifkan ${account.email} (minimal 3 karakter):`); if (!reason || reason.trim().length < 3) return; setBusy(true); setError(''); try { await api(`/users/${account.id}/disable`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }); setMessage(`Akun ${account.email} dinonaktifkan.`); await loadAccounts() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}>Nonaktifkan</button></>}
          </td></tr>
        })}</tbody></table></div>}
      </Panel>
    </>}
    {!user.offices?.length && ['admin', 'superadmin'].includes(user.role) && <Panel title="Riwayat perubahan server" sub="100 perubahan material terakhir. Riwayat ini terpisah dari label reviewer yang dipulihkan dari backup lama.">
      <button className="btn secondary" onClick={async () => { try { setEvents((await api<{ events: Audit[] }>('/audit')).events) } catch (e) { setError((e as Error).message) } }}>Muat riwayat</button>
      <div className="table-wrap"><table className="data"><thead><tr><th>Waktu</th><th>Aktor</th><th>Tindakan</th><th>Revisi</th><th>Alasan</th></tr></thead><tbody>{events.map(e => <tr key={e.id}><td>{new Date(e.at).toLocaleString('id-ID')}</td><td>{e.actorName}</td><td>{e.action}</td><td>{e.revision}</td><td>{e.reason}</td></tr>)}</tbody></table></div>
    </Panel>}
  </div>
}
