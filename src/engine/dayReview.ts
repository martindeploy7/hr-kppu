import type { Assignment, DayReview, Employee, Evidence } from './types.ts'
import type { IdentityItem } from './roster.ts'
import { nameKey } from './names.ts'

export function dayReviewKey(employeeId: string, date: string) { return `${employeeId}|${date}` }

/** JSON objects are key-sorted so schema parsing/serialization cannot stale a decision. */
export function stableStringify(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item)
    ? item.map(canonical)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).filter(([, field]) => field !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, canonical(field)]))
      : item
  return JSON.stringify(canonical(value))
}

/** Any source or identity change invalidates the review and requires a fresh decision. */
export function daySourceSignature(
  employee: Employee,
  date: string,
  evidence: Evidence[],
  assignments: Assignment[],
  context: { covered: boolean; partial: boolean; identity?: string[]; recordStates?: string[] },
) {
  return stableStringify({
    employee: [employee.id, employee.nip, employee.nika, employee.kantor],
    date,
    context,
    evidence: evidence.map(stableStringify).sort(),
    assignments: assignments.map(stableStringify).sort(),
  })
}

/** Validate a human decision before it can change the activity status or UM result. */
export function dayReviewProblem(review: DayReview, evidence: Evidence[], assignments: Assignment[]): string | undefined {
  if (review.note.trim().length < 3) return 'Alasan keputusan wajib diisi minimal 3 karakter'
  if (new Set(review.evidenceIds).size !== review.evidenceIds.length || review.evidenceIds.some(id => !evidence.some(e => e.id === id))) return 'Pilihan bukti absensi sudah berubah'
  if (new Set(review.assignmentIds).size !== review.assignmentIds.length || review.assignmentIds.some(id => !assignments.some(a => a.id === id))) return 'Pilihan ST sudah berubah'

  const selectedEvidence = evidence.filter(e => review.evidenceIds.includes(e.id))
  const selectedAssignments = assignments.filter(a => review.assignmentIds.includes(a.id))
  const codes = new Set(selectedEvidence.map(e => e.code))
  if (review.status === 'hadir' || review.status === 'hadir-wfa') {
    const complete = selectedEvidence.some(e => e.clockIn && e.clockOut && e.clockOut >= e.clockIn)
    if (!complete) return 'Status hadir memerlukan satu bukti terpilih dengan jam masuk dan pulang lengkap'
    if (review.status === 'hadir-wfa' && !selectedEvidence.some(e => e.mode === 'WFA' || e.code === 'WFA')) return 'Status WFA memerlukan bukti WFA yang dipilih'
  }
  if (review.status === 'dinas-luar' && !selectedAssignments.some(a => !a.local) && !codes.has('PD')) return 'Status dinas luar memerlukan ST dinas luar atau bukti berkode PD yang dipilih'
  if (review.status === 'dinas-lokal' && !selectedAssignments.some(a => a.local) && !codes.has('DL')) return 'Status dinas lokal memerlukan ST lokal atau bukti berkode DL yang dipilih'
  if (review.status === 'diklat' && !codes.has('DIKLAT') && !codes.has('KO')) return 'Status diklat/konsinyering memerlukan bukti kode DIKLAT atau KO yang dipilih'
  if (review.status === 'sakit' && !codes.has('S')) return 'Status sakit memerlukan bukti kode sakit yang dipilih'
  if (review.status === 'cuti' && !codes.has('C') && !codes.has('CB')) return 'Status cuti memerlukan bukti kode cuti yang dipilih'
  if (review.status === 'izin' && !codes.has('I')) return 'Status izin memerlukan bukti kode izin yang dipilih'
  return undefined
}

export function unresolvedIdentityEvidence(evidence: Evidence[], employeeId: string, identity: IdentityItem[]) {
  return evidence.filter(e => e.identityPending && !identity.some(i => i.context === 'absensi' && i.method === 'manual' && i.employeeId === employeeId && i.office === e.office && nameKey(i.name) === nameKey(e.name)))
}
