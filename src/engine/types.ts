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

export type SourceFile = {
  id: string
  fileName: string
  kind: SourceKind
  label: string
  office: string
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
  completeThrough?: ISODate
  declaration?: { actorId: string; basis: string; at: string }
  master?: Partial<Employee>[]
  quarantined?: { ref: string; reason: string; raw: string }[]
  recordReviews?: RecordReview[]
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
  aliases: Alias[]
  sources: string[]
  derived: string[]
  workStatusPeriods?: { kind: 'tugas-belajar' | 'diperbantukan'; start: ISODate; end: ISODate; basis: string }[]
  rateHistory?: { start: ISODate; end: ISODate; rate: number; pph: number; basis: string }[]
}

export type DayStatus =
  | 'hadir' | 'hadir-wfa' | 'dinas-lokal' | 'dinas-luar' | 'diklat' | 'cuti' | 'sakit' | 'izin'
  | 'tanpa-keterangan' | 'tidak-lengkap' | 'libur' | 'tidak-ada-data' | 'belum-berlangsung'

export type Severity = 'tinggi' | 'sedang' | 'rendah'

export type IssueType =
  | 'dinas-vs-scan-kantor' | 'cuti-vs-hadir' | 'st-tumpang-tindih' | 'pd-tanpa-st' | 'daring-ditolak'
  | 'scan-tidak-lengkap' | 'wfo-di-luar-kantor' | 'jam-duplikat' | 'jam-manual' | 'jadwal-tidak-sesuai'
  | 'hadir-hari-libur' | 'wfa-saat-dinas' | 'st-tanpa-nomor' | 'scan-berbeda'

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
