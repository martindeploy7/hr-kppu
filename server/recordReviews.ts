import { createHash } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { User, Workspace } from '../shared/workspace.ts'
import type { RecordReviewPreview, ReviewDay } from '../shared/recordReviews.ts'
import { recordDisposition } from '../src/engine/recordReviews.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { reconcile, type DayRecord } from '../src/engine/reconcile.ts'
import { requireOffice, scopeWorkspace } from './scope.ts'

export const recordReviewInput = z.object({ id: z.uuid(), expectedRevision: z.number().int().nonnegative(), kind: z.enum(['evidence', 'assignment']), recordId: z.string().min(1).max(2000), disposition: z.enum(['excluded', 'active']), reason: z.string().trim().min(10).max(2000), confirmedImpact: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()
export type RecordReviewInput = z.infer<typeof recordReviewInput>
export function previewRecordReview(state: Workspace, revision: number, sourceId: string, input: RecordReviewInput, actor: User) {
  if (!['admin', 'hr'].includes(actor.role)) throw new HTTPException(403)
  if (input.expectedRevision !== revision) throw new HTTPException(409, { message: 'Data berubah; muat ulang dan tinjau dampak kembali' })
  const file = state.files.find(f => f.id === sourceId && f.active !== false)
  if (!file) throw new HTTPException(404)
  const evidence = input.kind === 'evidence' ? file.evidence.find(e => e.id === input.recordId) : undefined
  const assignment = input.kind === 'assignment' ? file.assignments.find(a => a.id === input.recordId) : undefined
  const record = evidence ?? assignment
  if (!record) throw new HTTPException(404)
  requireOffice(actor, record.office)
  const rawRoster = buildRoster(state.files, state.master, state.overrides, state.decisions, true)
  const employeeId = (input.kind === 'evidence' ? rawRoster.evidenceLink : rawRoster.assignmentLink).get(record.id)
  const employee = employeeId ? rawRoster.byId.get(employeeId) : undefined
  if (employee) requireOffice(actor, employee.kantor)
  if ((recordDisposition(file, input.kind, input.recordId)?.disposition ?? 'active') === input.disposition) throw new HTTPException(409, { message: 'Status catatan sudah sama; muat ulang riwayat terbaru' })
  if ((file.recordReviews?.length ?? 0) >= 10000) throw new HTTPException(422, { message: 'Batas riwayat sumber tercapai; gunakan revisi sumber baru' })
  if (state.files.some(f => f.recordReviews?.some(r => r.id === input.id))) throw new HTTPException(409, { message: 'ID keputusan sudah digunakan' })
  const period = { start: evidence?.date ?? assignment!.start, end: evidence?.date ?? assignment!.end }
  if ((Date.parse(period.end) - Date.parse(period.start)) / 86400000 >= 400) throw new HTTPException(422, { message: 'Rentang penugasan melebihi 400 hari; perbaiki tanggal melalui revisi sumber dahulu' })
  const next = structuredClone(state), target = next.files.find(f => f.id === sourceId)!
  target.recordReviews = [...target.recordReviews ?? [], { id: input.id, kind: input.kind, recordId: input.recordId, disposition: input.disposition, reason: input.reason, actorId: actor.id, reviewer: actor.name, at: new Date().toISOString() }]
  target.revision = (target.revision ?? 1) + 1
  const calculate = (workspace: Workspace) => {
    const own = scopeWorkspace(workspace, actor)
    return reconcile(own.files, buildRoster(own.files, own.master, own.overrides, own.decisions), period, own.policy, own.resolutions)
  }
  const before = calculate(state), after = calculate(next)
  const byId = new Map(after.months.map(m => [m.employee.id, m]))
  const summarize = (day?: DayRecord): ReviewDay => ({ status: day?.status ?? 'tidak-dalam-roster', mealState: day?.meal.state ?? 'excluded', amount: day?.meal.amount ?? 0, amountReady: day?.meal.amountReady ?? false, clockIn: day?.clockIn ?? '', clockOut: day?.clockOut ?? '', issues: day?.issues.filter(i => !day.resolved.some(r => r.issueId === i.id)).length ?? 0 })
  const affected: RecordReviewPreview['affected'] = []
  const months = new Map(before.months.map(m => [m.employee.id, m]))
  for (const m of after.months) if (!months.has(m.employee.id)) months.set(m.employee.id, m)
  for (const [id, m] of months) {
    const prior = before.months.find(old => old.employee.id === id)
    const current = byId.get(id), days = new Set([...(prior?.days ?? []), ...(current?.days ?? [])].map(d => d.date))
    for (const date of days) {
      const old = summarize(prior?.days.find(d => d.date === date)), now = summarize(current?.days.find(d => d.date === date))
      if (JSON.stringify(old) !== JSON.stringify(now)) affected.push({ employeeId: id, name: current?.employee.nama ?? m.employee.nama, date, before: old, after: now })
    }
  }
  const checksum = createHash('sha256').update(JSON.stringify({ actorId: actor.id, sourceId, revision, id: input.id, kind: input.kind, recordId: input.recordId, disposition: input.disposition, reason: input.reason, affected })).digest('hex')
  return { next, preview: { checksum, revision, affected, record: { name: record.name, ref: record.ref, ...period }, disposition: input.disposition } satisfies RecordReviewPreview }
}
