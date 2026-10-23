import { expect, test } from 'vitest'
import { randomUUID } from 'node:crypto'
import { emptyWorkspace } from '../shared/workspace.ts'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import { effectiveSource } from '../src/engine/recordReviews.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { previewRecordReview } from '../server/recordReviews.ts'
import { scopeWorkspace } from '../server/scope.ts'
import { migrateWorkspace } from '../shared/validation.ts'
const actor = { id: 'actor', name: 'HR Uji', email: 'hr@test.invalid', role: 'hr' as const, offices: ['Pusat'] }
function fixture() {
  const state = emptyWorkspace(), person = { ...blankEmployee('person'), nama: 'Uji', nip: '198001012020011001', kantor: 'Pusat', golongan: 'III/a', statusKepegawaian: 'PNS' as const }
  state.master = [person]; state.policy = { ...DEFAULT_POLICY, parametersApproved: true, arrivalBoundary: 'inclusive' }
  state.files = [{ id: 'attendance', fileName: 'Synthetic', kind: 'mesin', label: 'Test', office: 'Pusat', importedAt: '2026-10-20T00:00:00Z', period: { start: '2026-10-05', end: '2026-10-05' }, evidence: [{ id: 'good', fileId: 'attendance', kind: 'mesin', office: 'Pusat', name: person.nama, ids: { nip: person.nip }, date: '2026-10-05', clockIn: '08:00', clockOut: '16:00', ref: 'Sheet1 A2' }, { id: 'bad', fileId: 'attendance', kind: 'daring', office: 'Pusat', name: person.nama, ids: { nip: person.nip }, date: '2026-10-05', clockIn: '09:00', clockOut: '16:00', approved: true, mode: 'WFO', ref: 'Sheet1 A3' }], assignments: [], warnings: [], stats: { rows: 2, people: 1 } }]
  authorizeDay(state, ['good'])
  return state
}
function authorizeDay(state: ReturnType<typeof emptyWorkspace>, evidenceIds: string[]) {
  const period = { start: '2026-10-05', end: '2026-10-05' }
  const roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
  const day = reconcile(state.files, roster, period, state.policy, [], '2026-10-20', state.dayReviews).months[0].days[0]
  state.dayReviews = [{ employeeId: day.employeeId, date: day.date, status: 'hadir', evidenceIds, assignmentIds: [], note: 'Bukti ditinjau oleh admin', reviewer: actor.name, actorId: actor.id, at: '2026-10-20T00:00:00Z', signature: day.reviewSignature }]
}
test('source record review expires the daily decision and retains originals', () => {
  const state = fixture(), input = { id: randomUUID(), expectedRevision: 3, kind: 'evidence' as const, recordId: 'bad', disposition: 'excluded' as const, reason: 'Bukti salah dikonfirmasi pada dokumen sumber' }
  const result = previewRecordReview(state, 3, 'attendance', input, actor)
  expect(result.preview.affected).toHaveLength(1)
  expect(result.preview.affected[0]).toMatchObject({ before: { mealState: 'eligible', amount: 37000 }, after: { mealState: 'held', amount: 0, clockIn: '08:00', clockOut: '16:00' } })
  expect(state.files[0].recordReviews).toBeUndefined(); expect(result.next.files[0].evidence).toHaveLength(2); expect(effectiveSource(result.next.files[0]).evidence.map(e => e.id)).toEqual(['good'])
  expect(result.next.files[0].recordReviews![0]).toMatchObject({ actorId: actor.id, reviewer: actor.name, recordId: 'bad' })
  const restored = migrateWorkspace(result.next); expect(restored.files[0].recordReviews).toEqual(result.next.files[0].recordReviews)
  const orphaned = structuredClone(result.next); orphaned.files[0].recordReviews![0].recordId = 'missing'
  expect(() => migrateWorkspace(orphaned)).toThrow('tidak ada')
  const reactivated = previewRecordReview(result.next, 4, 'attendance', { ...input, id: randomUUID(), expectedRevision: 4, disposition: 'active', reason: 'Dokumen perbaikan mengaktifkan kembali bukti' }, actor)
  expect(reactivated.next.files[0].recordReviews).toHaveLength(2); expect(effectiveSource(reactivated.next.files[0]).evidence).toHaveLength(2); expect(reactivated.preview.affected[0].after.mealState).toBe('held')
})
test('excluded unmapped ST stops holding unrelated employees while other ST remains active', () => {
  const state = fixture(); state.files[0].evidence = state.files[0].evidence.slice(0, 1)
  authorizeDay(state, ['good'])
  state.files.push({ ...state.files[0], id: 'st', kind: 'surat-tugas', evidence: [], assignments: [{ id: 'unknown', fileId: 'st', office: 'Pusat', name: 'Peserta tidak relevan', start: '2026-10-05', end: '2026-10-05', rawDate: '5 Oktober 2026', local: true, ref: 'ST A2' }] })
  const result = previewRecordReview(state, 1, 'st', { id: randomUUID(), expectedRevision: 1, kind: 'assignment', recordId: 'unknown', disposition: 'excluded', reason: 'Peserta salah dan bukan pegawai dalam scope ini' }, actor)
  expect(result.preview.affected[0]).toMatchObject({ before: { mealState: 'held' }, after: { mealState: 'eligible' } })
  expect(buildRoster(result.next.files, result.next.master, {}, []).identity.some(i => i.name === 'Peserta tidak relevan')).toBe(false)
})
test('office filtering removes foreign review reasons from mixed sources', () => {
  const state = fixture(), file = state.files[0]
  file.office = 'Semua kantor'; file.kind = 'daring'; file.evidence[1].office = 'Kanwil I'
  file.recordReviews = [{ id: randomUUID(), kind: 'evidence', recordId: 'bad', disposition: 'excluded', reason: 'Private review of another office', actorId: 'foreign', reviewer: 'Foreign', at: '2026-10-20T00:00:00Z' }]
  const scoped = scopeWorkspace(state, actor)
  expect(scoped.files[0].recordReviews).toHaveLength(0);expect(JSON.stringify(scoped)).not.toContain('Private review')
  expect(() => previewRecordReview(state, 1, file.id, { id: randomUUID(), expectedRevision: 1, kind: 'evidence', recordId: 'bad', disposition: 'active', reason: 'Unauthorized reactivation of foreign record' }, actor)).toThrow('cakupan')
})
test('removing the sole evidence of a provisional employee previews removal from the active roster', () => {
  const state = fixture();state.master=[];state.files[0].evidence=state.files[0].evidence.slice(0,1)
  authorizeDay(state, ['good'])
  const result=previewRecordReview(state,1,'attendance',{id:randomUUID(),expectedRevision:1,kind:'evidence',recordId:'good',disposition:'excluded',reason:'Bukan pegawai dalam cakupan, dibuktikan dokumen asal'},actor)
  expect(result.preview.affected[0]).toMatchObject({before:{mealState:'eligible'},after:{status:'tidak-dalam-roster',mealState:'excluded',amount:0}})
  expect(buildRoster(result.next.files,[],{},[]).employees).toHaveLength(0)
  expect(buildRoster(result.next.files,[],{},[],true).employees).toHaveLength(1)
})
