import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { User } from '../../shared/workspace.ts'
import { api, ApiError } from '../lib/api.ts'
const Auth = createContext<{ user: User; logout: () => Promise<void> } | null>(null)
export function useAuth() { const value = useContext(Auth); if (!value) throw new Error('Auth provider missing'); return value }
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true)
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { api<{ user: User }>('/auth/me').then(r => setUser(r.user)).catch(() => {}).finally(() => setLoading(false)) }, [])
  const login = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { const r = await api<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); setPassword(''); setUser(r.user) }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  if (loading) return <main className="auth-shell"><p role="status">Memeriksa sesi…</p></main>
  if (!user) return <main className="auth-shell"><section className="auth-panel">
    <img src="/kppu-logo.png" alt="KPPU" width="72" />
    <p className="auth-caption">Sistem Kepegawaian KPPU</p><h1>Masuk ke ruang kerja SDM</h1>
    <p>Kelola sumber absensi, rekonsiliasi, dan usulan uang makan dalam satu ruang kerja bersama.</p>
    <form onSubmit={login}>
      <label>Email akun<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Memeriksa akun…' : 'Masuk'}</button>
    </form>
    <small>Akses diberikan oleh administrator SDM. Hubungi administrator untuk pembuatan akun atau pemulihan password.</small>
  </section></main>
  return <Auth.Provider value={{ user, logout: async () => { try { await api('/auth/logout', { method: 'POST' }) } catch (e) { if (!(e instanceof ApiError) || e.status !== 401) throw e }; setUser(null) } }}>{children}</Auth.Provider>
}
