import { HTTPException } from 'hono/http-exception'
import type { User, Workspace } from '../shared/workspace.ts'
import { buildRoster } from '../src/engine/roster.ts'
export const globalAccess = (user: User) => !user.offices?.length
export const officeAllowed = (user: User, office: string) => globalAccess(user) || user.offices!.includes(office)
export function requireOffice(user: User, office: string) { if (!officeAllowed(user, office)) throw new HTTPException(403, { message: 'Kantor berada di luar cakupan akun' }) }
export function decisionOwned(user: User, decision: { key: string; employeeId: string | null }, ids: Set<string>) {
  if (decision.employeeId && !ids.has(decision.employeeId)) return false
  if (decision.key.startsWith('merge|')) return ids.has(decision.key.slice(6))
  if (decision.key.startsWith('konflik|')) return decision.key.slice(8).split('|').every(id => ids.has(id))
  return user.offices!.some(o => decision.key.startsWith(`${o}|`) || decision.key.startsWith(`konfirmasi|${o}|`))
}
export function sourceAllowed(user: User, source: Workspace['files'][number]) {
  return globalAccess(user) || ((officeAllowed(user, source.office) || (source.office === 'Semua kantor' && source.evidence.length > 0)) && source.evidence.every(e => officeAllowed(user, e.office)) && source.assignments.every(a => officeAllowed(user, a.office)))
}
export function scopeWorkspace(state: Workspace, user: User): Workspace {
  if (globalAccess(user)) return state
  const roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
  const ids = new Set(roster.employees.filter(e => officeAllowed(user, e.kantor)).map(e => e.id))
  const files = state.files.flatMap(f => {
    const evidence = f.evidence.filter(e => officeAllowed(user, e.office)), assignments = f.assignments.filter(a => officeAllowed(user, a.office)), master = f.master?.filter(e => officeAllowed(user, e.kantor ?? f.office))
    if (!evidence.length && !assignments.length && !master?.length && !officeAllowed(user, f.office)) return []
    return [{ ...f, evidence, assignments, master, summaries: sourceAllowed(user, f) ? f.summaries : undefined, quarantined: sourceAllowed(user, f) ? f.quarantined : undefined, warnings: sourceAllowed(user, f) ? f.warnings : ['Sumber lintas kantor; hanya catatan dalam cakupan akun ditampilkan.'], stats: { rows: evidence.length + assignments.length, people: new Set([...evidence.map(e => e.name), ...assignments.map(a => a.name)]).size } }]
  })
  return { ...state, files, master: state.master.filter(e => ids.has(e.id)), overrides: Object.fromEntries(Object.entries(state.overrides).filter(([id]) => ids.has(id))), decisions: state.decisions.filter(d => decisionOwned(user, d, ids)), resolutions: state.resolutions.filter(r => ids.has(r.issueId.split('|')[0])) }
}
