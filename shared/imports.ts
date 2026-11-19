import type { Assignment, SourceFile, SourceKind } from '../src/engine/types.ts'
import { sourceRecordState } from '../src/engine/recordReviews.ts'

const norm = (value: string | undefined) => (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, ' ').trim()

/** A register key is deliberately conservative; number, unit, office and year keep reused numbers separate. */
export function assignmentRegisterKey(a: Assignment) {
  const year = a.letterDate?.slice(0, 4) || a.start.slice(0, 4)
  return JSON.stringify([a.office, norm(a.unit), norm(a.letterNo), year])
}

export type AssignmentRegisterGroup = {
  key: string
  office: string
  unit: string
  letterNo: string
  year: string
  label: string
  replaceable: boolean
  assignments: Assignment[]
}

export function groupAssignments(assignments: Assignment[]): AssignmentRegisterGroup[] {
  const groups = new Map<string, AssignmentRegisterGroup>()
  for (const a of assignments) {
    const key = assignmentRegisterKey(a)
    let group = groups.get(key)
    if (!group) {
      const year = a.letterDate?.slice(0, 4) || a.start.slice(0, 4)
      const unit = a.unit?.trim() ?? ''
      const letterNo = a.letterNo?.trim() ?? ''
      group = {
        key, office: a.office, unit, letterNo, year,
        label: `${unit || 'Unit tidak terbaca'} · ${letterNo || 'nomor ST tidak terbaca'} · ${year}`,
        replaceable: !!unit && !!letterNo,
        assignments: [],
      }
      groups.set(key, group)
    }
    group.assignments.push(a)
  }
  return [...groups.values()].map(g => ({ ...g, assignments: [...g.assignments].sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name) || a.ref.localeCompare(b.ref)) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'id'))
}

export function importedAssignments(file: SourceFile) {
  return file.assignments.filter(a => sourceRecordState(file, 'assignment', a.id) === 'active')
}

export type ImportMode = 'add' | 'replace-file' | 'replace-registers'
export type ImportTarget = { sourceId: string; registerKey: string }
export type ImportSelection = { incomingKey: string; targets: ImportTarget[] }
export type ImportProposal = {
  uploadId: string; expectedRevision: number; office: string; mode: ImportMode; replaces?: string; completeThrough?: string
  resolveUnmappedOffice?: boolean
  range?: { start: string; end: string }
  coverage?: { start: string; end: string; status: 'complete' | 'partial'; basis: string }
  selections?: ImportSelection[]; reason?: string; completeSnapshot?: boolean; offset?: number; limit?: number
}
export type ImportCounts = { added: number; changed: number; removed: number; ambiguous: number; duplicate: number; unchanged: number }
export type ImportValue = { name: string; office: string; start: string; end: string; detail: string; ref: string }
export type ImportChange = { kind: 'presensi' | 'surat-tugas' | 'master'; status: 'added' | 'changed' | 'removed' | 'ambiguous' | 'duplicate'; before?: ImportValue; after?: ImportValue; changedFields: string[]; countBefore?: number; countAfter?: number }
export type ImportDaySummary = { status: string; mealState: string; amount: number; amountReady: boolean; clockIn: string; clockOut: string; issues: number }
export type ImportReviewImpact = { computed: boolean; touchedDates: number; changedDays: number; newlyHeld: number; changedAmounts: number; issuesBefore: number; issuesAfter: number; examples: { employeeId: string; name: string; date: string; before: ImportDaySummary; after: ImportDaySummary }[]; note?: string
  /** Changed days and amounts split by the calendar month of the date (a date belongs to its own month, whichever weekly file brought it). */
  byMonth?: Record<string, { changedDays: number; newlyHeld: number; changedAmounts: number }> }
/** Impact of one upload on one calendar month. `submission` is set when that month already has a meal submission that is not cancelled. */
export type ImportMonthImpact = { month: string; added: number; duplicate: number; changedDays: number; newlyHeld: number; changedAmounts: number; submission?: { id: string; status: string; version: number } }
export type ImportImpactResponse = {
  checksum: string; revision: number; mode: ImportMode
  /** Set when a 'complete' coverage claim extends past the last date in the uploaded attendance file. */
  coverageNote?: string
  /** Rows and changed days per calendar month, in month order. */
  byMonth?: ImportMonthImpact[]
  /** Warnings that do not block the upload, e.g. a month that already has a locked meal submission. */
  warnings?: string[]
  source: { id: string; kind: SourceKind; office: string; parsedRows: number; selectedRows: number; omittedMasterCount: number }
  counts: ImportCounts; changes: ImportChange[]; offset: number; limit: number; totalChanges: number; hasMore: boolean
  registers?: { incomingKey: string; label: string; selectedRows: number; targetCount: number; counts: ImportCounts }[]
  replacedScopes: { sourceId: string; registerKey: string; label: string; rows: number }[]
  review: ImportReviewImpact
}
