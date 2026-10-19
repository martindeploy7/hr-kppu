import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Employee, Resolution, SourceFile } from '../engine/types.ts'
import { buildRoster, type Roster } from '../engine/roster.ts'
import { reconcile, type Reconciliation } from '../engine/reconcile.ts'
import { enforcePolicy, type MealPolicy } from '../engine/policy.ts'
import { eachDay, monthBounds } from '../engine/dates.ts'
import { api, ApiError, downloadJson } from '../lib/api.ts'
import { useAuth } from './Auth.tsx'
import { emptyWorkspace, upsertEmployees, type Workspace, type WorkspaceResponse } from '../../shared/workspace.ts'

export type ImportResult = { name: string; ok: boolean; message: string }
type Preview = { duplicate: boolean; file: SourceFile }
type Ctx = Workspace & {
  ready: boolean; roster: Roster; recon: Reconciliation; periods: string[]; activePeriod: string
  revision: number; saveStatus: 'loading' | 'saved' | 'saving' | 'error'; saveError: string
  retrySave: () => void; reload: () => Promise<void>; backup: () => void
  previewFiles: (files: File[], dateOrder?: 'DMY' | 'MDY') => Promise<{ previews: Preview[]; results: ImportResult[] }>
  commitImport: (file: SourceFile, office: string, replaces?: string, completeThrough?: string) => Promise<void>
  declareNilSt: (office: string, period: string, basis: string) => Promise<void>
  restoreBackup: (state: Workspace) => Promise<void>
  removeFile: (id: string) => Promise<void>; setFileOffice: (id: string, office: string) => Promise<void>; clearAll: () => void
  upsertMaster: (rows: Partial<Employee>[]) => { added: number; updated: number }
  updateEmployee: (id: string, patch: Partial<Employee>) => void
  decide: (key: string, employeeId: string | null) => void; undoDecision: (key: string) => void
  resolve: (ids: string[], decision: Resolution['decision'], note: string) => void; unresolve: (ids: string[]) => void
  setPolicy: (patch: Partial<MealPolicy>) => void; setPeriod: (period: string) => void; setReviewer: (name: string) => void
}
const HrContext = createContext<Ctx | null>(null)
export function useHr() { const ctx = useContext(HrContext); if (!ctx) throw new Error('useHr outside provider'); return ctx }
const editableKeys = ['master', 'overrides', 'decisions', 'resolutions', 'policy'] as const

export function HrDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [state, setState] = useState<Workspace>(emptyWorkspace), [ready, setReady] = useState(false)
  const [revision, setRevision] = useState(0), [saveStatus, setSaveStatus] = useState<Ctx['saveStatus']>('loading'), [saveError, setSaveError] = useState('')
  const [retry, setRetry] = useState(0), [period, setPeriod] = useState('')
  const base = useRef<Workspace>(emptyWorkspace()), inFlight = useRef(false), current = useRef(state)
  current.current = state
  const apply = useCallback((r: WorkspaceResponse) => { base.current = r.state; current.current = r.state; setState(r.state); setRevision(r.revision); setReady(true); setSaveStatus('saved'); setSaveError('') }, [])
  const reload = useCallback(async () => { try { apply(await api<WorkspaceResponse>('/workspace')) } catch (e) { setSaveError((e as Error).message); setSaveStatus('error') } }, [apply])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (!ready) return
    let polling = false, disposed = false
    const dirty = () => editableKeys.some(k => current.current[k] !== base.current[k] && JSON.stringify(current.current[k]) !== JSON.stringify(base.current[k]))
    const timer = window.setInterval(async () => {
      if (polling || inFlight.current || dirty()) return
      polling = true
      try {
        const remote = await api<{ revision: number }>('/workspace/revision')
        if (remote.revision !== revision && !disposed && !inFlight.current && !dirty()) {
          const response = await api<WorkspaceResponse>('/workspace')
          if (!disposed && !inFlight.current && !dirty()) apply(response)
        }
      } catch (e) { if (!disposed && e instanceof ApiError && e.status === 401) { setSaveError('Sesi berakhir. Backup pekerjaan lalu keluar dan masuk kembali.'); setSaveStatus('error') } }
      finally { polling = false }
    }, 15000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [ready, revision, apply])
  useEffect(() => {
    if (!ready || saveError) return
    const snapshot = state
    const patch = Object.fromEntries(editableKeys.filter(k => JSON.stringify(snapshot[k]) !== JSON.stringify(base.current[k])).map(k => [k, snapshot[k]]))
    if (!Object.keys(patch).length) return
    setSaveStatus('saving')
    const timer = window.setTimeout(async () => {
      if (inFlight.current) return
      inFlight.current = true
      try {
        const result = await api<WorkspaceResponse>('/workspace', { method: 'PUT', body: JSON.stringify({ expectedRevision: revision, patch, reason: 'Perubahan data melalui ruang kerja SDM' }) })
        base.current = result.state; setRevision(result.revision)
        setState(latest => {
          const merged = { ...result.state }
          for (const key of editableKeys) if (JSON.stringify(latest[key]) !== JSON.stringify(snapshot[key])) Object.assign(merged, { [key]: latest[key] })
          return merged
        })
        setSaveStatus('saved')
      } catch (e) { setSaveError((e as Error).message); setSaveStatus('error') }
      finally { inFlight.current = false; setRetry(n => n + 1) }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [state, revision, ready, retry, saveError])
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => { if (saveStatus === 'saving' || saveError) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard)
  }, [saveStatus, saveError])
  const patch = (fn: (s: Workspace) => Partial<Workspace>) => setState(s => ({ ...s, ...fn(s) }))
  const files = useMemo(() => state.files.filter(f => f.active !== false), [state.files])
  const roster = useMemo(() => buildRoster(files, state.master, state.overrides, state.decisions), [files, state.master, state.overrides, state.decisions])
  const periods = useMemo(() => [...new Set(files.flatMap(f => [...f.evidence.map(e => e.date.slice(0, 7)), ...f.assignments.flatMap(a => eachDay(a.start, a.end).map(d => d.slice(0, 7))) ]))].sort().reverse(), [files])
  const activePeriod = period || state.period || periods[0] || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).slice(0, 7)
  const recon = useMemo(() => reconcile(files, roster, monthBounds(activePeriod), state.policy, state.resolutions), [files, roster, activePeriod, state.policy, state.resolutions])
  const effectiveResolutions = useMemo(() => state.resolutions.filter(r => recon.issues.some(i => i.id === r.issueId && i.signature === r.signature)), [state.resolutions, recon])
  const serverAction = async (path: string, body: Record<string, unknown>) => {
    if (inFlight.current || editableKeys.some(k => JSON.stringify(current.current[k]) !== JSON.stringify(base.current[k]))) throw new Error('Tunggu sampai perubahan tersimpan, lalu ulangi tindakan')
    inFlight.current = true; setSaveStatus('saving')
    try { apply(await api<WorkspaceResponse>(path, { method: 'POST', body: JSON.stringify({ ...body, expectedRevision: revision }) })) }
    catch (e) { setSaveStatus('error'); setSaveError((e as Error).message); throw e }
    finally { inFlight.current = false }
  }
  const value: Ctx = {
    ...state, files, reviewer: user.name, resolutions: effectiveResolutions, ready, revision, saveStatus, saveError,
    retrySave: () => { setSaveError(''); setRetry(n => n + 1) }, reload,
    backup: () => downloadJson(`KPPU_HR_backup_r${revision}.json`, { application: 'kppu-hr', exportedAt: new Date().toISOString(), revision, state }),
    roster, recon, periods: [...new Set([activePeriod, ...periods])], activePeriod,
    previewFiles: async (files, dateOrder) => {
      const previews: Preview[] = [], results: ImportResult[] = []
      for (const file of files) {
        try { const data = new FormData(); data.set('file', file); if (dateOrder) data.set('dateOrder', dateOrder); const r = await api<Preview>('/imports/preview', { method: 'POST', body: data }); previews.push(r); results.push({ name: file.name, ok: true, message: r.duplicate ? 'Duplikat identik; tidak ditambahkan' : `${r.file.stats.rows} baris siap ditinjau` }) }
        catch (e) { results.push({ name: file.name, ok: false, message: (e as Error).message }) }
      }
      return { previews, results }
    },
    commitImport: (file, office, replaces, completeThrough) => serverAction('/imports/commit', { uploadId: file.id, office, replaces, completeThrough, reason: replaces ? 'Mengganti dataset yang dipilih pada preview' : 'Menambahkan sumber setelah preview' }),
    declareNilSt: (office, period, basis) => serverAction('/coverage/nil-st', { office, period, basis }),
    restoreBackup: state => serverAction('/backup/restore', { state, reason: 'Pemulihan workspace setelah preview dan konfirmasi admin' }),
    removeFile: id => serverAction(`/sources/${id}/withdraw`, { reason: 'Sumber ditarik dari perhitungan oleh SDM' }),
    setFileOffice: (id, office) => serverAction(`/sources/${id}/office`, { office, reason: 'Koreksi kantor sumber oleh SDM' }),
    clearAll: () => { setSaveError('Penghapusan massal dinonaktifkan; tarik sumber satu per satu agar jejak tetap tersedia') },
    upsertMaster: rows => { const result = upsertEmployees(state.master, roster.employees, state.overrides, rows, () => crypto.randomUUID()); patch(() => ({ master: result.master, overrides: result.overrides })); return result },
    updateEmployee: (id, p) => patch(s => ({ overrides: { ...s.overrides, [id]: { ...s.overrides[id], ...p } } })),
    decide: (key, employeeId) => patch(s => ({ decisions: [...s.decisions.filter(d => d.key !== key), { key, employeeId, reviewer: user.name, at: new Date().toISOString() }] })),
    undoDecision: key => patch(s => ({ decisions: s.decisions.filter(d => d.key !== key) })),
    resolve: (ids, decision, note) => {
      if (note.trim().length < 3) { setSaveError('Catatan keputusan wajib diisi minimal 3 karakter'); return }
      patch(s => ({ resolutions: [...s.resolutions.filter(r => !ids.includes(r.issueId)), ...ids.map(issueId => ({ issueId, decision, note, reviewer: user.name, at: new Date().toISOString(), signature: recon.issues.find(i => i.id === issueId)?.signature }))] }))
    },
    unresolve: ids => patch(s => ({ resolutions: s.resolutions.filter(r => !ids.includes(r.issueId)) })),
    setPolicy: p => patch(s => ({ policy: enforcePolicy({ ...s.policy, ...p }) })),
    setPeriod, setReviewer: () => {},
  }
  return <HrContext.Provider value={value}>{children}</HrContext.Provider>
}
