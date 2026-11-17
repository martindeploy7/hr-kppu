import type { CoverageDeclaration, ISODate, SourceFile, SourceKind } from './types.ts'
import { OFFICES } from './ids.ts'
import { addDays, monthBounds } from './dates.ts'
import { effectiveSource } from './recordReviews.ts'

export type CoverageSource = 'offline' | 'online' | 'surat-tugas'
export type CoverageState = 'missing' | 'unconfirmed' | 'partial' | 'complete' | 'nil' | 'not-applicable'
export type OfficeCoverage = {
  office: string
  source: CoverageSource
  state: CoverageState
  ready: boolean
  files: number
  declaredThrough?: ISODate
}

export type MonthlyPackage = {
  period: string
  offline: { ready: boolean; files: number }
  online: { ready: boolean; files: number }
  suratTugas: { office: string; ready: boolean; files: number; declaredNil: boolean; state?: CoverageState }[]
  coverage: OfficeCoverage[]
  ready: boolean
}

const OFFLINE = new Set<SourceKind>(['mesin', 'matriks-kanwil', 'jadwal-kanwil', 'laporan-kanwil'])

export function coverageSource(kind: SourceKind): CoverageSource {
  if (kind === 'daring') return 'online'
  if (kind === 'surat-tugas') return 'surat-tugas'
  return 'offline'
}

function relevant(file: SourceFile, source: CoverageSource) {
  return source === 'offline' ? OFFLINE.has(file.kind) : source === 'online' ? file.kind === 'daring' : file.kind === 'surat-tugas'
}

function dateOverlap(a: { start: string; end: string }, b: { start: string; end: string }) {
  return a.start <= b.end && a.end >= b.start
}

function declarationCoversRange(declarations: CoverageDeclaration[], start: ISODate, end: ISODate) {
  const intervals = declarations
    .filter(d => d.status === 'complete' || d.status === 'nil' || d.status === 'not-applicable')
    .filter(d => dateOverlap(d, { start, end }))
    .map(d => ({ start: d.start < start ? start : d.start, end: d.end > end ? end : d.end }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
  let next = start
  for (const interval of intervals) {
    if (interval.start > next) return false
    if (interval.end >= end) return true
    if (interval.end >= next) next = addDays(interval.end, 1)
  }
  return false
}

/**
 * Setoran mingguan KPPU berbentuk tiga sumber untuk seluruh kantor: Mesin Offline, Mesin Online, dan Rekap ST.
 * Cakupan dihitung per sumber (bukan per kantor): kantor setiap baris diturunkan dari data sumber/master pegawai.
 */
export type SourceCoverage = { source: CoverageSource; state: CoverageState; ready: boolean; files: number; declaredThrough?: ISODate }

export function inspectSourceCoverage(files: SourceFile[], start: ISODate, end: ISODate): SourceCoverage[] {
  const active = files.filter(file => file.active !== false)
  return (['offline', 'online', 'surat-tugas'] as CoverageSource[]).map(source => {
    const matching = active.filter(file => relevant(file, source))
    const overlaps = (file: SourceFile) => {
      const selected = effectiveSource(file)
      return selected.evidence.some(row => row.date >= start && row.date <= end) || selected.assignments.some(row => row.start <= end && row.end >= start)
    }
    const scopedDeclarations = matching.flatMap(file => (file.coverageDeclarations ?? []).map(d => ({ office: file.office, d }))).filter(({ d }) => dateOverlap(d, { start, end }))
    const declarations = scopedDeclarations.map(({ d }) => d)
    const scoped = matching.filter(file => overlaps(file) || (file.coverageDeclarations ?? []).some(d => dateOverlap(d, { start, end })))
    const hasRows = scoped.some(overlaps)
    const nilConflict = source === 'surat-tugas' && declarations.some(d => d.status === 'nil') && hasRows && !declarations.some(d => d.status === 'complete')
    // "Tidak berlaku" untuk satu kantor tidak bertentangan dengan setoran kantor lain; konflik hanya pada kantor yang sama.
    const declarationConflict = scopedDeclarations.some(a => a.d.status === 'not-applicable' && scopedDeclarations.some(b => b.office === a.office && (b.d.status === 'complete' || b.d.status === 'nil')))
    const ready = declarationCoversRange(declarations, start, end) && !nilConflict && !declarationConflict
    const covering = declarations.filter(d => d.status !== 'partial')
    const state: CoverageState = ready
      ? covering.length && covering.every(d => d.status === 'nil') ? 'nil' : covering.length && covering.every(d => d.status === 'not-applicable') ? 'not-applicable' : 'complete'
      : declarations.length ? 'partial' : hasRows ? 'unconfirmed' : 'missing'
    const through = covering.map(d => d.end).sort().at(-1)
    return { source, state, ready, files: scoped.length, ...(through ? { declaredThrough: through } : {}) }
  })
}

/** Kompatibel dengan tampilan lama per kantor: status kantor = status sumber seluruh KPPU. */
export function inspectOfficeCoverage(files: SourceFile[], start: ISODate, end: ISODate, offices: string[] = OFFICES): OfficeCoverage[] {
  const bySource = inspectSourceCoverage(files, start, end)
  return offices.flatMap(office => bySource.map(item => ({ office, ...item })))
}

/** Hari dianggap tercakup bila ketiga sumber pekan tersebut sudah disetor (atau ST dinyatakan nihil). */
const SOURCE_NAME: Record<CoverageSource, string> = { offline: 'Mesin Offline', online: 'Mesin Online', 'surat-tugas': 'Rekap ST' }
/** Coverage is KPPU-wide (one confirmation covers Pusat and Kanwil I–VII), so the office argument is ignored. */
export function createCoverageLookup(files: SourceFile[]) {
  const cache = new Map<string, string[]>()
  const missing = (date: ISODate) => {
    let cached = cache.get(date)
    if (!cached) { cached = inspectSourceCoverage(files, date, date).filter(item => !item.ready).map(item => SOURCE_NAME[item.source]); cache.set(date, cached) }
    return cached
  }
  return Object.assign((_office: string, date: ISODate) => missing(date).length === 0, { missing })
}

export function inspectMonthlyPackage(files: SourceFile[], period: string, offices: string[] = OFFICES): MonthlyPackage {
  const { start, end } = monthBounds(period)
  const coverage = inspectOfficeCoverage(files, start, end, offices)
  const count = (source: CoverageSource) => new Set(files.filter(file => file.active !== false && relevant(file, source) && (file.evidence.some(row => row.date >= start && row.date <= end) || file.assignments.some(row => row.start <= end && row.end >= start) || (file.coverageDeclarations ?? []).some(d => dateOverlap(d, { start, end })))).map(file => file.id)).size
  const offline = { ready: coverage.filter(item => item.source === 'offline').every(item => item.ready), files: count('offline') }
  const online = { ready: coverage.filter(item => item.source === 'online').every(item => item.ready), files: count('online') }
  const suratTugas = coverage.filter(item => item.source === 'surat-tugas').map(item => ({ office: item.office, ready: item.ready, files: item.files, declaredNil: item.state === 'nil', state: item.state }))
  return { period, offline, online, suratTugas, coverage, ready: coverage.length > 0 && coverage.every(item => item.ready) }
}
