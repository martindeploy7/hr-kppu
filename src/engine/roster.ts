import type { Alias, Assignment, Employee, Evidence, MatchDecision, SourceFile, SourceKind } from './types.ts'
import { decodeNIP, officeFromUnit } from './ids.ts'
import { nameKey, nameScore, nameTokens, titleCase } from './names.ts'
import { effectiveSource } from './recordReviews.ts'

export type LinkMethod = 'nip' | 'nika' | 'app' | 'mesin' | 'nama' | 'manual' | 'baru'
export type Candidate = { employeeId: string; score: number }

export type IdentityItem = {
  key: string
  name: string
  office: string
  context: 'surat-tugas' | 'absensi'
  occurrences: number
  sampleRefs: string[]
  status: 'linked' | 'ambiguous' | 'unmatched' | 'ignored'
  method?: LinkMethod
  employeeId?: string
  score?: number
  candidates: Candidate[]
}

export type IdentityConflict = {
  key: string
  kind: 'nip-berbeda' | 'nama-sama'
  employeeIds: string[]
  detail: string
}

export type Roster = {
  employees: Employee[]
  byId: Map<string, Employee>
  evidenceLink: Map<string, string>
  assignmentLink: Map<string, string>
  identity: IdentityItem[]
  conflicts: IdentityConflict[]
}

export const SOURCE_LABEL: Record<SourceKind, string> = {
  daring: 'Mesin Online', mesin: 'Mesin Offline', 'matriks-kanwil': 'Mesin Offline Kanwil',
  'jadwal-kanwil': 'Jadwal manual Kanwil', 'laporan-kanwil': 'Laporan kode Kanwil', 'surat-tugas': 'Surat tugas',
}

export function blankEmployee(id: string): Employee {
  return {
    id, nama: '', nip: '', nika: '', kantor: '', unit: '', statusKepegawaian: 'Belum diketahui', golongan: '', jabatan: '',
    tanggalLahir: '', jenisKelamin: '', tempatLahir: '', pendidikan: '', disiplinIlmu: '', pelatihan: [], tanggalMulaiKerja: '',
    alamat: '', kontakDarurat: '', namaKontakDarurat: '', statusPerkawinan: '', agama: '', nomorWhatsApp: '', email: '',
    statusPegawai: 'Aktif', aliases: [], sources: [], derived: [],
  }
}

const KIND_ORDER: SourceKind[] = ['daring', 'mesin', 'matriks-kanwil', 'laporan-kanwil', 'jadwal-kanwil']
/** Skor nama (0..0.95) + 0.05 bila kantor sama. Tautan otomatis bila ≥ AUTO_LINK dan unggul ≥ MARGIN dari kandidat kedua. */
export const AUTO_LINK = 0.78
const MARGIN = 0.07

export const matchKey = (office: string, name: string) => `${office}|${nameKey(name)}`
export const mergeKey = (fromId: string) => `merge|${fromId}`

export function buildRoster(files: SourceFile[], master: Employee[], overrides: Record<string, Partial<Employee>>, decisions: MatchDecision[], includeExcluded = false): Roster {
  files = files.filter(f => f.active !== false).map(f => includeExcluded ? f : effectiveSource(f))
  const byId = new Map<string, Employee>()
  const byNip = new Map<string, string>(), byNika = new Map<string, string>(), byApp = new Map<string, string>(), byMesin = new Map<string, string>()
  const decisionMap = new Map(decisions.map(d => [d.key, d]))
  const tokens = new Map<string, string[]>()
  const evidenceLink = new Map<string, string>()
  const assignmentLink = new Map<string, string>()
  const identity: IdentityItem[] = []

  const index = (e: Employee) => {
    byId.set(e.id, e)
    if (e.nip) byNip.set(e.nip, e.id)
    if (e.nika) byNika.set(e.nika, e.id)
    for (const a of e.aliases) {
      if (a.kind === 'mesin') byMesin.set(a.value, e.id)
      if (a.kind === 'app') byApp.set(a.value, e.id)
      if (a.kind === 'nip') byNip.set(a.value, e.id)
      if (a.kind === 'nika') byNika.set(a.value, e.id)
    }
    tokens.set(e.id, nameTokens(e.nama))
  }
  const knownNips = new Set(master.map(m => m.nip).filter(Boolean))
  const sourceMaster: Employee[] = []
  for (const f of files) for (const row of f.master ?? []) {
    if (row.nip && knownNips.has(row.nip)) continue
    if (row.nip) knownNips.add(row.nip)
    sourceMaster.push({ ...blankEmployee(row.nip ? `nip:${row.nip}` : `source-master:${row.kantor}:${nameKey(row.nama ?? '')}`), ...row, sources: ['Master pegawai'] })
  }
  ;[...master, ...sourceMaster].forEach(m => {
    const e = { ...blankEmployee(m.id), ...m, aliases: [...(m.aliases ?? [])], sources: [...new Set([...(m.sources ?? []), 'Master pegawai'])], derived: [...(m.derived ?? [])] }
    deriveFromNip(e)
    index(e)
  })

  const addAlias = (e: Employee, alias: Alias) => {
    if (!e.aliases.some(a => a.kind === alias.kind && a.value.toLowerCase() === alias.value.toLowerCase())) e.aliases.push(alias)
  }

  const rank = (name: string, office: string, pool?: (e: Employee) => boolean): Candidate[] => {
    const q = nameTokens(name)
    const out: Candidate[] = []
    for (const e of byId.values()) {
      if (pool && !pool(e)) continue
      const s = nameScore(q, tokens.get(e.id) ?? [])
      if (s <= 0) continue
      out.push({ employeeId: e.id, score: Math.round((s * 0.95 + (e.kantor === office ? 0.05 : 0)) * 100) / 100 })
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 5)
  }
  const decide = (cands: Candidate[]): { id?: string; ambiguous: boolean } => {
    if (!cands.length || cands[0].score < AUTO_LINK) return { ambiguous: cands.length > 0 && cands[0].score >= 0.55 }
    if (cands[1] && cands[0].score - cands[1].score < MARGIN) return { ambiguous: true }
    return { id: cands[0].employeeId, ambiguous: false }
  }

  // 1) Sumber absensi: NIP → NIKA/ID aplikasi → nomor mesin → keputusan HR → nama dalam kantor yang sama → pegawai baru.
  const ordered = files.filter(f => f.kind !== 'surat-tugas').sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
  for (const file of ordered) {
    const groups = new Map<string, Evidence[]>()
    for (const ev of file.evidence) {
      const sig = ev.ids.nip ? `nip:${ev.ids.nip}` : ev.ids.nika ? `nika:${ev.ids.nika}:${nameKey(ev.name)}` : ev.ids.mesin ? `mesin:${ev.office}:${ev.ids.mesin}:${nameKey(ev.name)}` : `nama:${ev.office}:${nameKey(ev.name)}`
      const g = groups.get(sig)
      if (g) g.push(ev); else groups.set(sig, [ev])
    }
    for (const evs of groups.values()) {
      const ev = evs.find(e => e.unit) ?? evs[0]
      const office = ev.kind === 'daring' ? officeFromUnit(ev.unit) ?? 'Pusat' : ev.office
      const mesinKey = ev.ids.mesin ? `${office}:${ev.ids.mesin}` : undefined
      const decision = decisionMap.get(matchKey(office, ev.name))
      let id: string | undefined, method: LinkMethod = 'baru', score: number | undefined
      if (ev.ids.nip && byNip.has(ev.ids.nip)) { id = byNip.get(ev.ids.nip); method = 'nip' }
      else if (ev.ids.nika && byNika.has(ev.ids.nika)) { id = byNika.get(ev.ids.nika); method = 'nika' }
      else if (ev.ids.nika && byApp.has(ev.ids.nika)) { id = byApp.get(ev.ids.nika); method = 'app' }
      else if (ev.ids.appId && byApp.has(ev.ids.appId)) { id = byApp.get(ev.ids.appId); method = 'app' }
      else if (mesinKey && byMesin.has(mesinKey)) { id = byMesin.get(mesinKey); method = 'mesin' }
      else if (decision?.employeeId && byId.has(decision.employeeId)) { id = decision.employeeId; method = 'manual' }
      let cands: Candidate[] = []
      if (!id && !ev.ids.nip) {
        cands = rank(ev.name, office, e => e.kantor === office && !(ev.ids.nika && e.nika && e.nika !== ev.ids.nika))
        const d = decide(cands)
        // Nama/fuzzy hanya kandidat. Pemetaan lintas sumber memerlukan keputusan eksplisit.
        if (d.id) { /* candidate retained for review */ }
      }
      let e = id ? byId.get(id) : undefined
      if (!e) {
        const newId = ev.ids.nip ? `nip:${ev.ids.nip}` : ev.ids.nika ? `nika:${ev.ids.nika}` : `${office}:${nameKey(ev.name).replace(/\s/g, '-')}`
        e = blankEmployee(byId.has(newId) ? `${newId}-${byId.size}` : newId)
        e.kantor = office
        method = 'baru'
      }
      mergeEvidenceInto(e, ev, office, file)
      if (ev.ids.nip) addAlias(e, { kind: 'nip', value: ev.ids.nip, source: SOURCE_LABEL[file.kind] })
      if (ev.ids.nika) addAlias(e, { kind: 'nika', value: ev.ids.nika, source: `${SOURCE_LABEL[file.kind]} ${office}` })
      if (ev.ids.appId) addAlias(e, { kind: 'app', value: ev.ids.appId, source: 'Nama file foto presensi daring' })
      if (mesinKey) addAlias(e, { kind: 'mesin', value: mesinKey, source: `${SOURCE_LABEL[file.kind]} ${office}` })
      addAlias(e, { kind: 'nama', value: ev.name, source: `${SOURCE_LABEL[file.kind]} ${office}` })
      index(e)
      for (const x of evs) evidenceLink.set(x.id, e.id)
      if (method === 'manual' || (method === 'baru' && !ev.ids.nip)) {
        identity.push({ key: matchKey(office, ev.name), name: ev.name, office, context: 'absensi', occurrences: evs.length, sampleRefs: [evs[0].ref, file.fileName], status: method === 'baru' ? 'unmatched' : 'linked', method, employeeId: e.id, score, candidates: cands.filter(c => c.employeeId !== e!.id).slice(0, 4) })
      }
    }
  }

  // 2) Gabungan duplikat yang sudah diputuskan HR (mis. NIP salah ketik di salah satu sistem).
  for (const d of decisions) {
    if (!d.key.startsWith('merge|') || !d.employeeId) continue
    const from = byId.get(d.key.slice(6)), to = byId.get(d.employeeId)
    if (!from || !to || from === to) continue
    for (const a of from.aliases) addAlias(to, a)
    for (const s of from.sources) if (!to.sources.includes(s)) to.sources.push(s)
    for (const [evId, empId] of evidenceLink) if (empId === from.id) evidenceLink.set(evId, to.id)
    for (const item of identity) if (item.employeeId === from.id) { item.employeeId = to.id; item.status = 'linked'; item.method = 'manual' }
    byId.delete(from.id)
    index(to)
  }

  // 3) Surat tugas: hanya mencocokkan (tidak pernah membuat pegawai baru).
  const stGroups = new Map<string, Assignment[]>()
  for (const f of files) if (f.kind === 'surat-tugas') for (const a of f.assignments) {
    const k = a.nip ? `${a.office}|nip:${a.nip}` : matchKey(a.office, a.name)
    const g = stGroups.get(k)
    if (g) g.push(a); else stGroups.set(k, [a])
  }
  for (const [key, list] of stGroups) {
    const a = list[0]
    const decision = decisionMap.get(key)
    const cands = rank(a.name, a.office)
    const base = { key, name: a.name, office: a.office, context: 'surat-tugas' as const, occurrences: list.length, sampleRefs: list.slice(0, 2).map(x => `${x.ref}${x.letterNo ? ` · ST ${x.letterNo}` : ''}`), candidates: cands }
    let item: IdentityItem
    const nipId = a.nip ? byNip.get(a.nip) : undefined
    if (nipId) item = { ...base, status: 'linked', method: 'nip', employeeId: nipId }
    else if (decision) item = { ...base, status: decision.employeeId ? 'linked' : 'ignored', method: 'manual', employeeId: decision.employeeId ?? undefined }
    else {
      const d = decide(cands)
      item = { ...base, status: cands.length ? 'ambiguous' : 'unmatched', score: cands[0]?.score }
    }
    identity.push(item)
    if (item.employeeId && byId.has(item.employeeId)) {
      addAlias(byId.get(item.employeeId)!, { kind: 'nama', value: a.name, source: `Surat tugas ${a.unit ?? a.office}` })
      for (const x of list) assignmentLink.set(x.id, item.employeeId)
    }
  }

  // 4) Override data dari HR, lalu deteksi konflik identitas.
  const employees = [...byId.values()].map(e => overrides[e.id] ? { ...e, ...overrides[e.id], id: e.id } : e)
  employees.forEach(e => byId.set(e.id, e))
  const conflicts: IdentityConflict[] = []
  const sameName = new Map<string, Employee[]>()
  employees.forEach(e => { const k = nameKey(e.nama); if (k) sameName.set(k, [...(sameName.get(k) ?? []), e]) })
  for (const group of sameName.values()) {
    if (group.length < 2) continue
    const ids = group.map(e => e.id)
    const key = `konflik|${[...ids].sort().join('|')}`
    if (decisionMap.has(key)) continue
    const births = new Set(group.map(e => e.nip.slice(0, 8)).filter(Boolean))
    const nips = group.map(e => e.nip).filter(Boolean)
    if (births.size === 1 && nips.length === group.length && new Set(nips).size > 1) conflicts.push({ key, kind: 'nip-berbeda', employeeIds: ids, detail: `Nama dan tanggal lahir di NIP sama, tetapi NIP berbeda (${nips.join(' vs ')}). Kemungkinan salah ketik di salah satu sistem.` })
    else if (group.some(e => !e.nip) && group.every(e => e.kantor === group[0].kantor)) conflicts.push({ key, kind: 'nip-berbeda', employeeIds: ids, detail: 'Nama sama di kantor yang sama; salah satu tanpa NIP. Periksa apakah orang yang sama dengan ID berbeda di mesin.' })
    else conflicts.push({ key, kind: 'nama-sama', employeeIds: ids, detail: `Nama sama, data identitas berbeda (${group.map(e => `${e.kantor}${e.unit ? ` · ${e.unit}` : ''}`).join(' / ')}). Kemungkinan orang berbeda — pastikan surat tugas tidak tertukar.` })
  }
  return { employees, byId, evidenceLink, assignmentLink, identity, conflicts }
}

function mergeEvidenceInto(e: Employee, ev: Evidence, office: string, file: SourceFile) {
  const fromMaster = e.sources.includes('Master pegawai')
  const name = titleCase(ev.name)
  if (!e.nama || (ev.kind === 'daring' && !fromMaster) || (!fromMaster && name.length > e.nama.length && name.toLowerCase().startsWith(e.nama.toLowerCase()))) e.nama = name
  if (ev.ids.nip && !e.nip) e.nip = ev.ids.nip
  if (ev.ids.nika && !e.nika) e.nika = ev.ids.nika
  if (ev.kind === 'daring' && ev.unit && (!e.unit || !fromMaster)) e.unit = ev.unit
  else if (!e.unit && ev.unit && ev.unit !== 'Pegawai Eksis') e.unit = ev.unit
  if (!e.kantor || (ev.kind === 'daring' && !fromMaster)) e.kantor = office
  const label = SOURCE_LABEL[file.kind]
  if (!e.sources.includes(label)) e.sources.push(label)
  const derive = (field: string) => { if (!e.derived.includes(field)) e.derived.push(field) }
  if (ev.ids.nonAsn && e.statusKepegawaian === 'Belum diketahui') { e.statusKepegawaian = 'Non-ASN'; derive('statusKepegawaian') }
  deriveFromNip(e)
}

function deriveFromNip(e: Employee) {
  const derive = (field: string) => { if (!e.derived.includes(field)) e.derived.push(field) }
  if (e.nip) {
    const info = decodeNIP(e.nip)
    if (!e.tanggalLahir && info.tanggalLahir) { e.tanggalLahir = info.tanggalLahir; derive('tanggalLahir') }
    if (!e.jenisKelamin && info.jenisKelamin) { e.jenisKelamin = info.jenisKelamin; derive('jenisKelamin') }
    if (e.statusKepegawaian === 'Belum diketahui' && info.status !== 'Belum diketahui') { e.statusKepegawaian = info.status; derive('statusKepegawaian') }
  }
}
