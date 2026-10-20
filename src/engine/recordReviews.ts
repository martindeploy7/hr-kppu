import type { RecordReview, SourceFile } from './types.ts'

export function recordDisposition(file: SourceFile, kind: RecordReview['kind'], id: string) {
  for (let i = (file.recordReviews?.length ?? 0) - 1; i >= 0; i--) { const r = file.recordReviews![i]; if (r.kind === kind && r.recordId === id) return r }
}

export type SourceRecordState = 'active' | 'excluded' | 'superseded' | 'not-selected'
export function sourceRecordState(file: SourceFile, kind: RecordReview['kind'], id: string): SourceRecordState {
  if (kind === 'assignment' && file.assignmentImport?.selectedIds && !file.assignmentImport.selectedIds.includes(id)) return 'not-selected'
  if (kind === 'evidence' && file.evidenceImport?.selectedIds && !file.evidenceImport.selectedIds.includes(id)) return 'not-selected'
  const review = recordDisposition(file, kind, id)
  if (review?.disposition === 'excluded') return 'excluded'
  if (kind === 'assignment') {
    let supersessionAt = ''
    for (const change of file.assignmentImport?.supersessions ?? []) if (change.recordIds.includes(id) && change.at > supersessionAt) supersessionAt = change.at
    if (supersessionAt && !(review?.disposition === 'active' && review.at > supersessionAt)) return 'superseded'
  }
  return 'active'
}

/** Originals remain available for provenance; only active records feed identity and calculation. */
export function effectiveSource(file: SourceFile): SourceFile {
  return {
    ...file,
    evidence: file.evidence.filter(e => sourceRecordState(file, 'evidence', e.id) === 'active'),
    assignments: file.assignments.filter(a => sourceRecordState(file, 'assignment', a.id) === 'active'),
  }
}
export function reviewsForRecords(file: SourceFile, evidenceIds: Set<string>, assignmentIds: Set<string>) {
  return file.recordReviews?.filter(r => (r.kind === 'evidence' ? evidenceIds : assignmentIds).has(r.recordId))
}
