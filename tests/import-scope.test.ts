import { describe, expect, test } from 'vitest'
import { previewImport } from '../server/imports.ts'
import { createCoverageLookup } from '../src/engine/monthlyFlow.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { buildRoster, blankEmployee } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import { emptyWorkspace, type User } from '../shared/workspace.ts'
import { groupAssignments } from '../shared/imports.ts'
import { sourceRecordState } from '../src/engine/recordReviews.ts'
import type { Assignment, Evidence, SourceFile } from '../src/engine/types.ts'

const admin: User = { id: 'admin', name: 'Superadmin Uji', email: 'admin@example.test', role: 'superadmin', offices: null }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const basis = 'PIC mengonfirmasi snapshot lengkap untuk tanggal ini'
const declaration = (status: 'complete' | 'nil', start: string, end = start) => [{ start, end, status, basis, actorId: admin.id, at: '2026-10-28T00:00:00.000Z' }]

function file(args: { id: string; kind: SourceFile['kind']; office: string; start: string; end: string; evidence?: Evidence[]; assignments?: Assignment[]; coverage?: SourceFile['coverageDeclarations'] }): SourceFile {
  return {
    id: args.id, fileName: `${args.id}.xlsx`, kind: args.kind, label: args.kind, office: args.office, importedAt: '2026-10-28T00:00:00.000Z',
    period: { start: args.start, end: args.end }, evidence: args.evidence ?? [], assignments: args.assignments ?? [], coverageDeclarations: args.coverage,
    warnings: [], stats: { rows: (args.evidence?.length ?? 0) + (args.assignments?.length ?? 0), people: 1 }, active: true,
  }
}

function evidence(args: { id: string; fileId: string; date: string; nip: string; name: string; clockIn?: string; clockOut?: string }): Evidence {
  return { id: args.id, fileId: args.fileId, kind: 'mesin', office: 'Pusat', name: args.name, ids: { nip: args.nip }, date: args.date, clockIn: args.clockIn ?? '07:50', clockOut: args.clockOut ?? '16:00', ref: `Sheet1 · ${args.id}` }
}

function intent(uploadId: string, expectedRevision: number, patch: Record<string, unknown>) {
  return { uploadId, expectedRevision, office: 'Pusat', reason: 'Revisi sintetis untuk acceptance test', ...patch } as never
}

describe('date-scoped source replacement', () => {
  test('W13 replaces week two while week one remains active', () => {
    const state = emptyWorkspace()
    const weekOne = file({ id: id(1), kind: 'mesin', office: 'Pusat', start: '2026-10-05', end: '2026-10-09', evidence: [evidence({ id: 'old-week-one-row', fileId: id(1), date: '2026-10-05', nip: '198001012020011001', name: 'Pegawai Satu' })] })
    const weekTwo = file({ id: id(2), kind: 'mesin', office: 'Pusat', start: '2026-10-12', end: '2026-10-16', evidence: [evidence({ id: 'old-week-two-row', fileId: id(2), date: '2026-10-12', nip: '198001012020011001', name: 'Pegawai Satu' })] })
    const replacement = file({ id: id(3), kind: 'mesin', office: 'Pusat', start: '2026-10-12', end: '2026-10-16', evidence: [evidence({ id: 'new-week-two-row', fileId: id(3), date: '2026-10-12', nip: '198001012020011001', name: 'Pegawai Satu', clockIn: '08:00' })] })
    state.files = [weekOne, weekTwo]
    const result = previewImport(state, 4, replacement, admin, intent(replacement.id, 4, {
      mode: 'replace-file', replaces: weekTwo.id, completeSnapshot: true,
      coverage: { start: '2026-10-12', end: '2026-10-16', status: 'complete', basis },
    }))
    expect(result.next.files.find(source => source.id === weekOne.id)?.active).toBe(true)
    expect(result.next.files.find(source => source.id === weekTwo.id)?.active).toBe(false)
    expect(result.next.files.find(source => source.id === replacement.id)?.active).toBe(true)
    expect(result.impact.review.touchedDates).toBe(1)
  })

  test('W14 holds register replacement when an existing ST crosses the declared week', () => {
    const state = emptyWorkspace(), oldId = id(10), newId = id(11)
    const oldAssignment: Assignment = { id: 'old-cross-week-st', fileId: oldId, office: 'Pusat', unit: 'Kesekjenan', letterNo: '001/ST/2025', letterDate: '2025-10-28', name: 'Pegawai Satu', nip: '198001012020011001', start: '2025-10-29', end: '2025-11-03', rawDate: '29 Oktober–3 November 2025', destination: 'Bandung', local: false, ref: 'ST lama' }
    const newAssignment: Assignment = { ...oldAssignment, id: 'new-partial-st', fileId: newId, end: '2025-10-31', rawDate: '29–31 Oktober 2025', ref: 'ST revisi parsial' }
    const oldFile = file({ id: oldId, kind: 'surat-tugas', office: 'Pusat', start: oldAssignment.start, end: oldAssignment.end, assignments: [oldAssignment] })
    const incoming = file({ id: newId, kind: 'surat-tugas', office: 'Pusat', start: newAssignment.start, end: newAssignment.end, assignments: [newAssignment] })
    state.files = [oldFile]
    const target = groupAssignments(oldFile.assignments)[0], incomingGroup = groupAssignments(incoming.assignments)[0]
    expect(() => previewImport(state, 1, incoming, admin, intent(incoming.id, 1, {
      mode: 'replace-registers', completeSnapshot: true,
      coverage: { start: '2025-10-29', end: '2025-10-31', status: 'complete', basis },
      selections: [{ incomingKey: incomingGroup.key, targets: [{ sourceId: oldId, registerKey: target.key }] }],
    }))).toThrow('ST lama melintasi batas rentang penggantian')
  })

  test('W14 replaces ST rows inside range and preserves separate rows after the range', () => {
    const state = emptyWorkspace(), oldId = id(12), newId = id(13)
    const base: Assignment = { id: 'old-inside-range', fileId: oldId, office: 'Pusat', unit: 'Kesekjenan', letterNo: '002/ST/2025', letterDate: '2025-10-28', name: 'Pegawai Satu', nip: '198001012020011001', start: '2025-10-29', end: '2025-10-29', rawDate: '29 Oktober 2025', destination: 'Bandung', local: false, ref: 'ST A2' }
    const outside: Assignment = { ...base, id: 'old-outside-range', start: '2025-11-02', end: '2025-11-02', rawDate: '2 November 2025', ref: 'ST A3' }
    const revised: Assignment = { ...base, id: 'new-inside-range', fileId: newId, destination: 'Surabaya', ref: 'ST revisi A2' }
    const oldFile = file({ id: oldId, kind: 'surat-tugas', office: 'Pusat', start: base.start, end: outside.end, assignments: [base, outside] })
    const incoming = file({ id: newId, kind: 'surat-tugas', office: 'Pusat', start: revised.start, end: revised.end, assignments: [revised] })
    state.files = [oldFile]
    const target = groupAssignments(oldFile.assignments)[0], incomingGroup = groupAssignments(incoming.assignments)[0]
    const result = previewImport(state, 2, incoming, admin, intent(incoming.id, 2, {
      mode: 'replace-registers', completeSnapshot: true,
      coverage: { start: '2025-10-29', end: '2025-10-31', status: 'complete', basis },
      selections: [{ incomingKey: incomingGroup.key, targets: [{ sourceId: oldId, registerKey: target.key }] }],
    }))
    const archived = result.next.files.find(source => source.id === oldId)!
    expect(archived.assignmentImport?.supersessions?.flatMap(item => item.recordIds)).toEqual(['old-inside-range'])
    expect(sourceRecordState(archived, 'assignment', 'old-inside-range')).toBe('superseded')
    expect(sourceRecordState(archived, 'assignment', 'old-outside-range')).toBe('active')
  })

  test('W16 relinks uniquely identical rows after reorder and carries source review history', () => {
    const state = emptyWorkspace(), oldId = id(20), newId = id(21), interval = { start: '2026-10-05', end: '2026-10-06' }
    const personA = { ...blankEmployee('person-a'), nama: 'Pegawai Satu', nip: '198001012020011001', kantor: 'Pusat', golongan: 'III/a', statusKepegawaian: 'PNS' as const }
    const personB = { ...blankEmployee('person-b'), nama: 'Pegawai Dua', nip: '198001012020011002', kantor: 'Pusat', golongan: 'III/a', statusKepegawaian: 'PNS' as const }
    const oldA = evidence({ id: 'old-row-a', fileId: oldId, date: '2026-10-05', nip: personA.nip, name: personA.nama })
    const oldB = evidence({ id: 'old-row-b', fileId: oldId, date: '2026-10-06', nip: personB.nip, name: personB.nama })
    const oldOffline = file({ id: oldId, kind: 'mesin', office: 'Pusat', ...interval, evidence: [oldA, oldB], coverage: declaration('complete', interval.start, interval.end) })
    oldOffline.recordReviews = [{ id: id(22), kind: 'evidence', recordId: oldB.id, disposition: 'excluded', reason: 'Catatan ganda yang dikeluarkan', actorId: 'hr', reviewer: 'HR', at: '2026-10-07T00:00:00.000Z' }]
    const online = file({ id: id(23), kind: 'daring', office: 'Semua kantor', ...interval, coverage: declaration('complete', interval.start, interval.end) })
    const st = file({ id: id(24), kind: 'surat-tugas', office: 'Pusat', ...interval, coverage: declaration('nil', interval.start, interval.end) })
    state.master = [personA, personB]
    state.files = [oldOffline, online, st]
    state.policy = { ...DEFAULT_POLICY, parametersApproved: true, arrivalBoundary: 'inclusive' }
    const oldRoster = buildRoster(state.files, state.master, state.overrides, state.decisions)
    const oldCalculation = reconcile(state.files, oldRoster, interval, state.policy, [], '2026-10-28', [], createCoverageLookup(state.files))
    const oldDay = oldCalculation.months.find(month => month.employee.id === personA.id)!.days.find(day => day.date === oldA.date)!
    state.dayReviews = [{ employeeId: personA.id, date: oldA.date, status: 'hadir', evidenceIds: [oldA.id], assignmentIds: [], note: 'Bukti hadir terverifikasi', reviewer: 'HR', actorId: 'hr', at: '2026-10-07T00:00:00.000Z', signature: oldDay.reviewSignature }]

    const newA = evidence({ id: 'new-row-a', fileId: newId, date: oldA.date, nip: personA.nip, name: personA.nama })
    const newB = evidence({ id: 'new-row-b', fileId: newId, date: oldB.date, nip: personB.nip, name: personB.nama })
    const replacement = file({ id: newId, kind: 'mesin', office: 'Pusat', ...interval, evidence: [newB, newA] })
    const result = previewImport(state, 8, replacement, admin, intent(replacement.id, 8, {
      mode: 'replace-file', replaces: oldId, completeSnapshot: true,
      coverage: { start: interval.start, end: interval.end, status: 'complete', basis },
    }))
    const replaced = result.next.files.find(source => source.id === newId)!
    expect(replaced.evidence.find(row => row.date === oldA.date)?.id).toBe(oldA.id)
    expect(replaced.evidence.find(row => row.date === oldB.date)?.id).toBe(oldB.id)
    expect(replaced.recordReviews?.some(review => review.recordId === oldB.id && review.disposition === 'excluded')).toBe(true)

    const nextRoster = buildRoster(result.next.files, result.next.master, result.next.overrides, result.next.decisions)
    const nextCalculation = reconcile(result.next.files, nextRoster, interval, result.next.policy, result.next.resolutions, '2026-10-28', result.next.dayReviews, createCoverageLookup(result.next.files))
    const nextDay = nextCalculation.months.find(month => month.employee.id === personA.id)!.days.find(day => day.date === oldA.date)!
    expect(nextDay.reviewSignature).toBe(oldDay.reviewSignature)
    expect(nextDay.decision?.evidenceIds).toEqual([oldA.id])
  })
})
