import type { Cell, Employee, Sheet } from '../engine/types.ts'
import { excelSerialToISO, parseSingleDate, validDate } from '../engine/dates.ts'
import { OFFICES } from '../engine/ids.ts'
import { nameKey } from '../engine/names.ts'
import { matchEmployeeIdentifiers } from '../../shared/workspace.ts'

export const MASTER_COLUMNS: { header: string; key: keyof Employee; example: string }[] = [
  { header: 'NIP', key: 'nip', example: '198908242025211126' },
  { header: 'NIKA', key: 'nika', example: '3.24.0404' },
  { header: 'Nama', key: 'nama', example: 'Abbas R' },
  { header: 'Kantor', key: 'kantor', example: 'Pusat' },
  { header: 'Unit', key: 'unit', example: 'Biro Pencegahan' },
  { header: 'Status Kepegawaian', key: 'statusKepegawaian', example: 'PPPK' },
  { header: 'Golongan', key: 'golongan', example: 'IX' },
  { header: 'Jabatan', key: 'jabatan', example: 'Penata Kelola Persaingan Usaha' },
  { header: 'Tanggal Lahir', key: 'tanggalLahir', example: '1989-08-24' },
  { header: 'Tempat Lahir', key: 'tempatLahir', example: 'Jakarta' },
  { header: 'Jenis Kelamin', key: 'jenisKelamin', example: 'Laki-laki' },
  { header: 'Agama', key: 'agama', example: 'Islam' },
  { header: 'Nomor WhatsApp', key: 'nomorWhatsApp', example: '6281200000000' },
  { header: 'Email', key: 'email', example: 'nama@kppu.go.id' },
  { header: 'Pendidikan', key: 'pendidikan', example: 'S1' },
  { header: 'Disiplin Ilmu', key: 'disiplinIlmu', example: 'Hukum' },
  { header: 'Pelatihan', key: 'pelatihan', example: 'Hukum Persaingan Usaha; Investigasi' },
  { header: 'Tanggal Mulai Kerja', key: 'tanggalMulaiKerja', example: '2024-01-02' },
  { header: 'Alamat', key: 'alamat', example: '' },
  { header: 'Nama Kontak Darurat', key: 'namaKontakDarurat', example: '' },
  { header: 'Kontak Darurat', key: 'kontakDarurat', example: '' },
  { header: 'Status Perkawinan', key: 'statusPerkawinan', example: 'Kawin' },
]

export type MasterRow = { ref: string; value: Partial<Employee>; errors: string[] }
export type MasterImport = { rows: MasterRow[]; notices: string[] }
export type MasterChange = { field: string; before: string; after: string }
export type MasterPreview = MasterRow & { action: 'baru' | 'perbarui' | 'tetap' | 'gabung' | 'periksa'; changes: MasterChange[]; target?: string }
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
const aliases: Record<string, keyof Employee> = { nipppk: 'nip', nippppk: 'nip', nippegawai: 'nip', namapegawai: 'nama', namalengkap: 'nama', namapppk: 'nama', unitkerja: 'unit', statuspegawai: 'statusKepegawaian' }
const columnOf = (v: unknown) => MASTER_COLUMNS.find(c => norm(c.header) === norm(v) || norm(c.key) === norm(v))?.key ?? aliases[norm(v)]
const dateKeys: (keyof Employee)[] = ['tanggalLahir', 'tanggalMulaiKerja']
const display = (v: unknown) => Array.isArray(v) ? v.join('; ') : String(v ?? '')
const nonempty = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)

export function validateMasterRow(row: Partial<Employee>, offices: string[]) {
  const errors: string[] = []
  if (!row.nama && !row.nip && !row.nika) errors.push('Nama atau identifier wajib diisi')
  if (row.nip && !/^\d{18}$/.test(row.nip)) errors.push('NIP harus tepat 18 digit teks')
  if (row.nika && !/^\d\.\d{2}\.\d{4}$/.test(row.nika)) errors.push('NIKA harus berbentuk 3.24.0404')
  if (row.kantor && !offices.includes(row.kantor)) errors.push('Kantor tidak dikenal atau di luar cakupan akun')
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push('Email tidak valid')
  const enums = { statusKepegawaian: ['PPPK', 'PNS', 'Non-ASN', 'Belum diketahui'], agama: ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu', 'Lainnya'], jenisKelamin: ['Laki-laki', 'Perempuan'] }
  for (const [key, allowed] of Object.entries(enums)) { const value = display(row[key as keyof Employee]); if (value && !allowed.includes(value)) errors.push(`${MASTER_COLUMNS.find(c => c.key === key)?.header}: nilai tidak dikenal`) }
  for (const key of dateKeys) if (row[key]) {
    const value = display(row[key]), parts = value.split('-').map(Number)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !validDate(parts[0], parts[1], parts[2])) errors.push(`${MASTER_COLUMNS.find(c => c.key === key)?.header}: tanggal tidak valid`)
  }
  for (const c of MASTER_COLUMNS) if (typeof row[c.key] === 'string' && display(row[c.key]).length > 2000) errors.push(`${c.header}: melebihi 2.000 karakter`)
  return errors
}

/** Read every recognized master sheet; retain references and every rejected row. */
export function parseMasterSheets(sheets: Sheet[]): MasterImport {
  const rows: MasterRow[] = [], notices: string[] = []
  for (const sheet of sheets) {
    const headerAt = sheet.rows.slice(0, 50).findIndex(row => row.some(v => columnOf(v) === 'nama') && row.filter(v => columnOf(v)).length >= 2)
    if (headerAt < 0) { if (sheet.rows.some(r => r.some(nonempty))) notices.push(`Sheet "${sheet.name}" tidak dipakai: header master tidak ditemukan.`); continue }
    const columns = sheet.rows[headerAt].map(columnOf)
    const duplicate = columns.filter((key, i) => key && columns.indexOf(key) !== i)
    if (duplicate.length) throw new Error(`Sheet "${sheet.name}" memiliki kolom ganda: ${duplicate.join(', ')}`)
    const unknown = sheet.rows[headerAt].filter((v, i) => nonempty(v) && !columns[i])
    if (unknown.length) notices.push(`Sheet "${sheet.name}": kolom di luar template tidak dipakai (${unknown.join(', ')}).`)
    for (let r = headerAt + 1; r < sheet.rows.length; r++) {
      const source = sheet.rows[r]
      if (!source.some(nonempty)) continue
      const value: Record<string, unknown> = {}, errors: string[] = []
      for (let col = 0; col < columns.length; col++) {
        const key = columns[col], raw = source[col]
        if (!key || !nonempty(raw)) continue
        if ((key === 'nip' || key === 'nika') && sheet.identifierRisks?.some(risk => risk.row === r && risk.col === col)) errors.push(`${key.toUpperCase()} tersimpan numerik; verifikasi terhadap sumber asli dan unggah kembali sebagai teks. Digit yang hilang tidak dapat dipulihkan.`)
        if (dateKeys.includes(key)) {
          const text = display(raw).trim()
          value[key] = typeof raw === 'number' && raw >= 20000 && raw <= 80000 ? excelSerialToISO(raw) : /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : parseSingleDate(raw as Cell) ?? text
        } else if (key === 'pelatihan') value[key] = display(raw).split(/[;,]/).map(v => v.trim()).filter(Boolean)
        else value[key] = display(raw).trim()
      }
      rows.push({ ref: `${sheet.name} · baris ${r + 1}`, value: value as Partial<Employee>, errors })
      if (rows.length > 10000) throw new Error('Master melebihi 10.000 baris. Pecah file sebelum mengunggah.')
    }
  }
  if (!rows.length) throw new Error('Tidak ada baris master yang dikenali. Gunakan header template atau sheet master DPH.')
  return { rows, notices }
}

/** Validate the full batch before exposing commit rows. Empty cells never erase existing fields. */
export function previewMasterImport(input: MasterImport, roster: Employee[], offices = OFFICES) {
  const entries: MasterPreview[] = input.rows.map(row => ({ ...row, errors: [...row.errors, ...validateMasterRow(row.value, offices)], action: 'periksa', changes: [] }))
  const groups: { value: Partial<Employee>; entries: MasterPreview[] }[] = []
  for (const entry of entries) {
    const row = entry.value
    const matches = groups.filter(g => (row.nip && g.value.nip === row.nip) || (row.nika && g.value.nika === row.nika))
    if (matches.length > 1) { for (const g of matches) for (const member of g.entries) member.errors.push(`Identifier silang dengan ${entry.ref}`); entry.errors.push('NIP/NIKA menghubungkan beberapa orang dalam batch'); continue }
    const group = matches[0]
    if (group) {
      const conflicts = MASTER_COLUMNS.filter(c => nonempty(row[c.key]) && nonempty(group.value[c.key]) && display(row[c.key]) !== display(group.value[c.key]))
      if (conflicts.length) {
        const message = `Konflik satu identifier dalam batch: ${conflicts.map(c => c.header).join(', ')}`
        entry.errors.push(message); for (const member of group.entries) member.errors.push(message)
      }
      group.entries.push(entry)
      group.value = { ...group.value, ...Object.fromEntries(Object.entries(row).filter(([, v]) => nonempty(v))) }
    } else groups.push({ value: { ...row }, entries: [entry] })
  }
  const commitRows: Partial<Employee>[] = []
  for (const group of groups) {
    let existing: Employee | undefined
    try { existing = matchEmployeeIdentifiers(roster, group.value) } catch (e) { for (const entry of group.entries) entry.errors.push((e as Error).message) }
    if (!existing) {
      if (!group.value.nama) for (const entry of group.entries) entry.errors.push('Nama wajib untuk pegawai baru')
      if (!group.value.kantor) for (const entry of group.entries) entry.errors.push('Kantor wajib untuk pegawai baru')
      if (!group.value.nip && !group.value.nika && group.value.nama && (roster.some(e => nameKey(e.nama) === nameKey(group.value.nama!)) || groups.some(g => g !== group && g.value.nama && nameKey(g.value.nama) === nameKey(group.value.nama!)))) for (const entry of group.entries) entry.errors.push('Nama sudah ada; lengkapi NIP/NIKA. Nama tidak dipakai untuk menggabungkan orang.')
    }
    const changes = MASTER_COLUMNS.filter(c => nonempty(group.value[c.key]) && display(group.value[c.key]) !== display(existing?.[c.key])).map(c => ({ field: c.header, before: display(existing?.[c.key]), after: display(group.value[c.key]) }))
    for (const [i, entry] of group.entries.entries()) { entry.target = existing?.nama; entry.changes = changes; entry.action = entry.errors.length ? 'periksa' : i > 0 ? 'gabung' : !existing ? 'baru' : changes.length ? 'perbarui' : 'tetap' }
    if (!group.entries.some(e => e.errors.length) && (!existing || changes.length)) commitRows.push(group.value)
  }
  const invalid = entries.filter(e => e.errors.length).length
  return { entries, invalid, rows: invalid ? [] : commitRows, added: entries.filter(e => e.action === 'baru').length, updated: entries.filter(e => e.action === 'perbarui').length }
}
