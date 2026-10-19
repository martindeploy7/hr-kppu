import type { RecordReview, SourceFile } from './types.ts'

export function recordDisposition(file: SourceFile, kind: RecordReview['kind'], id: string) {
  for (let i = (file.recordReviews?.length ?? 0) - 1; i >= 0; i--) { const r = file.recordReviews![i]; if (r.kind === kind && r.recordId === id) return r }
}
/** Originals remain available for provenance; only active records feed identity and calculation. */
export function effectiveSource(file: SourceFile): SourceFile {
  if (!file.recordReviews?.length) return file
  const excluded = new Set<string>()
  for (const r of file.recordReviews) { const key = `${r.kind}|${r.recordId}`; if (r.disposition === 'excluded') excluded.add(key); else excluded.delete(key) }
  return { ...file, evidence: file.evidence.filter(e => !excluded.has(`evidence|${e.id}`)), assignments: file.assignments.filter(a => !excluded.has(`assignment|${a.id}`)) }
}
export function reviewsForRecords(file: SourceFile, evidenceIds: Set<string>, assignmentIds: Set<string>) {
  return file.recordReviews?.filter(r => (r.kind === 'evidence' ? evidenceIds : assignmentIds).has(r.recordId))
}
