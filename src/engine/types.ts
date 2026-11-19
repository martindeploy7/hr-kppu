export type ISODate = string
export type Cell = string | number | null
export type Sheet = { name: string; rows: Cell[][]; merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[]; identifierRisks?: { row: number; col: number; raw: string; type: string }[] }

export type SourceKind = 'mesin' | 'daring' | 'matriks-kanwil' | 'jadwal-kanwil' | 'laporan-kanwil' | 'surat-tugas'

export type DayCode = 'PD' | 'DL' | 'WFA' | 'S' | 'C' | 'CB' | 'I' | 'DIKLAT' | 'KO' | 'X' | 'ERR' | 'T'

export type Evidence = {
  id: string
  fileId: string
  kind: SourceKind
  office: string
  officePending?: boolean
  officeConflict?: boolean
  officeCandidates?: string[]
  officeCandidate?: string
  name: string
  identityPending?: boolean
  ids: { nip?: string; nika?: string; mesin?: string; appId?: string; nonAsn?: boolean }
  date: ISODate
  schedule?: { start: string; end: string; label: string }
  clockIn?: string
  clockOut?: string
  /** Sumber menyatakan hadir tanpa jam (laporan kode Kanwil VI). */
  present?: boolean
  incomplete?: boolean
  code?: DayCode
  codeLabel?: string
  mode?: 'WFO' | 'WFA'
  approved?: boolean
  approvalStatus?: 'approved' | 'rejected' | 'pending' | 'unknown' | 'not-reported'
  sourceDurationMin?: number
  minimumDurationMin?: number
  targetPekerjaan?: string
  hasilPekerjaan?: string
  sourceValues?: {
    name?: string; identifier?: string; employeeNumber?: string; machineId?: string; date?: string
    schedule?: string; scheduleStart?: string; scheduleEnd?: string; duration?: string; minimumDuration?: string
    exception?: string; mode?: string; approval?: string; office?: string; unit?: string
  }
  location?: string
  coordIn?: [number, number]
  coordOut?: [number, number]
  lateMin?: number
  earlyMin?: number
  overtimeMin?: number
  unit?: string
  ref: string
  notes?: EvidenceNote[]
}

export type EvidenceNote = 'jadwal-puasa' | 'jam-sama-hari-sebelumnya' | 'jam-manual-absen-error' | 'tanpa-jam'

export type Assignment = {
  id: string
  fileId: string
  /** Set by the controlled manual ST form; imports continue to resolve by identifiers/name. */
  employeeId?: string
  /**
   * Peserta eksternal ("Lainnya", mis. pengemudi tanpa NIP): bukan pegawai master. Tidak pernah dicocokkan ke
   * roster lewat nama, tidak membuat tugas pencocokan identitas, dan tidak menahan uang makan siapa pun.
   * `note` memuat keterangan peran (mis. "Driver Komisi").
   */
  external?: boolean
  note?: string
  /** ID grup ST manual (satu surat). Tetap sama setelah koreksi; baris lama tanpa ID dikelompokkan lewat kantor, nomor, dan tanggal ST. */
  groupId?: string
  /** Nomor koreksi ST dalam grup (1 = awal). Koreksi memperbarui baris di tempat dan mencatat sebelum/sesudah di jejak audit. */
  version?: number
  /** Catatan bebas operator untuk ST ini (maks 500 karakter). */
  catatan?: string
  createdBy?: string
  createdAt?: string
  office: string
  unit?: string
  letterNo?: string
  letterDate?: ISODate
  name: string
  nip?: string
  start: ISODate
  end: ISODate
  rawDate: string
  dateRef?: string
  destination?: string
  local: boolean
  ref: string
}

export type ReportSummary = { name: string; mesin?: string; duty?: number; actual?: number; absent?: number; late?: number; early?: number; overtimeHours?: number }

export type RecordReview = { id: string; kind: 'evidence' | 'assignment'; recordId: string; disposition: 'excluded' | 'active'; reason: string; actorId: string; reviewer: string; at: string }

export type AssignmentSupersession = {
  recordIds: string[]
  bySourceId: string
  registerKey: string
  registerLabel: string
  reason: string
  actorId: string
  reviewer: string
  at: string
}

export type AssignmentImportScope = {
  /** Only these parsed rows were selected for use when this source was committed. */
  selectedIds?: string[]
  selectedRegisterKeys?: string[]
  supersessions?: AssignmentSupersession[]
  omittedMasterCount?: number
}
export type EvidenceImportScope = { selectedIds?: string[] }

export type ImportCommit = {
  mode: 'add' | 'replace-file' | 'replace-registers'
  confirmation: string
  actorId: string
  committedAt: string
  selectedRegisterKeys?: string[]
  replacedScopes?: { sourceId: string; registerKey: string; label: string }[]
}

export type CoverageStatus = 'complete' | 'partial' | 'nil' | 'not-applicable'
export type CoverageDeclaration = {
  start: ISODate
  end: ISODate
  status: CoverageStatus
  basis: string
  actorId: string
  at: string
}

export type SourceFile = {
  id: string
  fileName: string
  kind: SourceKind
  label: string
  office: string
  officeCandidate?: string
  importedAt: string
  period: { start: ISODate; end: ISODate } | null
  evidence: Evidence[]
  assignments: Assignment[]
  summaries?: ReportSummary[]
  /** Tanggal yang terlihat diekspor sebelum data mesin lengkap (mis. hanya scan masuk). */
  partialDates?: ISODate[]
  warnings: string[]
  stats: { rows: number; people: number }
  hash?: string
  parserVersion?: string
  revision?: number
  supersedes?: string
  active?: boolean
  /** Explicit, auditable intervals. Legacy completeThrough is not sufficient to prove coverage. */
  coverageDeclarations?: CoverageDeclaration[]
  completeThrough?: ISODate
  declaration?: { actorId: string; basis: string; at: string }
  master?: Partial<Employee>[]
  quarantined?: { ref: string; reason: string; raw: string }[]
  recordReviews?: RecordReview[]
  assignmentImport?: AssignmentImportScope
  evidenceImport?: EvidenceImportScope
  importCommit?: ImportCommit
}

export type StatusKepegawaian = 'PPPK' | 'PNS' | 'Non-ASN' | 'Belum diketahui'
export type Religion = 'Islam' | 'Kristen' | 'Katolik' | 'Hindu' | 'Buddha' | 'Konghucu' | 'Lainnya'

export type Alias = { kind: 'nip' | 'nika' | 'mesin' | 'app' | 'nama'; value: string; source: string }

export type Employee = {
  id: string
  nama: string
  nip: string
  nika: string
  kantor: string
  unit: string
  statusKepegawaian: StatusKepegawaian
  golongan: string
  jabatan: string
  peringkatJabatan?: string
  jenisJabatan?: string
  tanggalLahir: string
  jenisKelamin: 'Laki-laki' | 'Perempuan' | ''
  tempatLahir: string
  pendidikan: string
  disiplinIlmu: string
  pelatihan: string[]
  tanggalMulaiKerja: string
  alamat: string
  kontakDarurat: string
  namaKontakDarurat: string
  statusPerkawinan: string
  agama: Religion | ''
  nomorWhatsApp: string
  email: string
  statusPegawai: 'Aktif' | 'Cuti' | 'Tugas Belajar' | 'Nonaktif'
  tanggalPensiun?: string
  tanggalPengunduranDiri?: string
  aliases: Alias[]
  sources: string[]
  derived: string[]
  workStatusPeriods?: { kind: 'tugas-belajar' | 'diperbantukan'; start: ISODate; end: ISODate; basis: string }[]
  rateHistory?: { start: ISODate; end: ISODate; rate: number; pph: number; basis: string }[]
}

export type DayStatus =
  | 'hadir' | 'hadir-wfa' | 'dinas-lokal' | 'dinas-luar' | 'diklat' | 'cuti' | 'sakit' | 'izin'
  | 'tanpa-keterangan' | 'tidak-lengkap' | 'libur' | 'tidak-ada-data' | 'belum-berlangsung'

export type ValidatedDayStatus = Exclude<DayStatus, 'tidak-lengkap' | 'libur' | 'tidak-ada-data' | 'belum-berlangsung'>
export type DayReview = {
  employeeId: string
  date: ISODate
  status: ValidatedDayStatus
  evidenceIds: string[]
  assignmentIds: string[]
  note: string
  reviewer: string
  actorId: string
  at: string
  signature: string
}

export type Severity = 'tinggi' | 'sedang' | 'rendah'

export type IssueType =
  | 'dinas-vs-scan-kantor' | 'cuti-vs-hadir' | 'st-tumpang-tindih' | 'pd-tanpa-st' | 'daring-ditolak'
  | 'scan-tidak-lengkap' | 'wfo-di-luar-kantor' | 'jam-duplikat' | 'jam-manual' | 'jadwal-tidak-sesuai'
  | 'hadir-hari-libur' | 'wfa-saat-dinas' | 'st-tanpa-nomor' | 'scan-berbeda' | 'status-berbeda'

export type Issue = {
  id: string
  type: IssueType
  severity: Severity
  employeeId: string
  date: ISODate
  title: string
  detail: string
  evidenceIds: string[]
  assignmentIds: string[]
  blocksMeal: boolean
  signature?: string
}

export type Resolution = {
  issueId: string
  decision: 'akui-hadir' | 'akui-dinas' | 'tidak-hadir' | 'valid'
  note: string
  reviewer: string
  at: string
  signature?: string
}

export type MatchDecision = { key: string; employeeId: string | null; reviewer: string; at: string }
