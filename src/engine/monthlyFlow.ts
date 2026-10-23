import type { SourceFile } from './types.ts'
import { OFFICES } from './ids.ts'
import { monthBounds } from './dates.ts'

const OFFLINE = new Set(['mesin', 'matriks-kanwil'])
const overlaps = (file: SourceFile, start: string, end: string) => !!file.period && file.period.start <= end && file.period.end >= start
const matchesMonth = (file: SourceFile, start: string, end: string) => file.period
  ? overlaps(file, start, end)
  : file.evidence.some(e => e.date >= start && e.date <= end) || file.assignments.some(a => a.start <= end && a.end >= start)

export type MonthlyPackage = {
  period: string
  offline: { ready: boolean; files: number }
  online: { ready: boolean; files: number }
  suratTugas: { office: string; ready: boolean; files: number; declaredNil: boolean }[]
  ready: boolean
}

/** Check only package presence and office-level ST completeness; daily evidence is reviewed separately. */
export function inspectMonthlyPackage(files: SourceFile[], period: string, offices: string[] = OFFICES): MonthlyPackage {
  const { start, end } = monthBounds(period)
  const active = files.filter(file => file.active !== false)
  const offlineFiles = active.filter(file => OFFLINE.has(file.kind) && matchesMonth(file, start, end) && file.evidence.some(e => e.date >= start && e.date <= end))
  const onlineFiles = active.filter(file => file.kind === 'daring' && matchesMonth(file, start, end) && file.evidence.some(e => e.date >= start && e.date <= end))
  const suratTugas = offices.map(office => {
    const officeFiles = active.filter(file => file.kind === 'surat-tugas' && file.office === office && matchesMonth(file, start, end))
    const scoped = officeFiles.filter(file => (file.completeThrough ?? '') >= end)
    const hasRecords = officeFiles.some(file => file.assignments.some(a => a.start <= end && a.end >= start))
    const completeRecords = scoped.some(file => file.assignments.some(a => a.start <= end && a.end >= start))
    const declaredNil = !hasRecords && scoped.some(file => file.declaration && file.assignments.length === 0)
    return { office, ready: completeRecords || declaredNil, files: scoped.length, declaredNil }
  })
  const offline = { ready: offlineFiles.length > 0, files: offlineFiles.length }
  const online = { ready: onlineFiles.length > 0, files: onlineFiles.length }
  return { period, offline, online, suratTugas, ready: offline.ready && online.ready && suratTugas.every(item => item.ready) }
}
