import { createHash } from 'node:crypto'
import { OFFICE_CITY } from '../src/engine/ids.ts'
import { recordDisposition, sourceRecordState } from '../src/engine/recordReviews.ts'
import type { Assignment, SourceFile } from '../src/engine/types.ts'
import type { StRecord } from '../shared/rekapSt.ts'

const digest = (s: string) => createHash('sha256').update(s).digest('hex')
export const manualStSourceId = (office: string, period: string) => `manual-st:${digest(`${office}|${period}`).slice(0, 24)}`
export const normalizeStText = (value: string) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('id-ID').replace(/\s+/g, ' ').trim()
export function isLocalDestination(office: string, destination: string) {
  const value = normalizeStText(destination)
  if (/\b(luar kota|luar daerah|luar negeri|antar kota)\b/.test(value)) return false
  if (/\b(dalam kota|setempat|lokal)\b/.test(value)) return true
  return (OFFICE_CITY[office] ?? '').split('/').some(city => city && value.includes(normalizeStText(city)))
}

/** ID grup ST. Baris lama (sebelum fitur grup) dikelompokkan lewat kantor, nomor, dan tanggal ST seperti sebelumnya. */
export const groupIdOf = (file: SourceFile, row: Assignment) => row.groupId ?? `legacy-${digest(`${file.office}|${row.letterNo ?? ''}|${row.letterDate ?? ''}`).slice(0, 24)}`
/** Kunci peserta dalam satu ST: pegawai master per ID, peserta eksternal per nama. */
export const participantKey = (row: Pick<Assignment, 'external' | 'employeeId' | 'nip' | 'name'>) => row.external ? `ext:${normalizeStText(row.name)}` : `emp:${row.employeeId ?? row.nip ?? normalizeStText(row.name)}`

export function publicStRecord(file: SourceFile, row: Assignment, createdBy?: string): StRecord {
  const status = sourceRecordState(file, 'assignment', row.id)
  return {
    id: row.id, sourceId: file.id, groupId: groupIdOf(file, row), registerOffice: file.office,
    letterNo: row.letterNo ?? '', letterDate: row.letterDate ?? '',
    employeeId: row.employeeId ?? '', name: row.name, nip: row.nip ?? '', external: !!row.external, note: row.note ?? '',
    activityDate: row.start, destination: row.destination ?? '', catatan: row.catatan ?? '', version: row.version ?? 1,
    status, cancelReason: status === 'excluded' ? recordDisposition(file, 'assignment', row.id)?.reason ?? '' : '',
    createdAt: row.createdAt ?? file.importedAt, createdBy: createdBy ?? row.createdBy ?? 'Akun lama',
  }
}

export type AttachmentKind = { mime: 'application/pdf' | 'image/jpeg' | 'image/png'; extensions: string[] }
/** Jenis file ditentukan dari byte awal, bukan dari ekstensi atau Content-Type kiriman klien. */
export function detectAttachmentType(bytes: Uint8Array): AttachmentKind | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (bytes.length >= 5 && startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return { mime: 'application/pdf', extensions: ['pdf'] }
  if (bytes.length >= 3 && startsWith(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'] }
  if (bytes.length >= 8 && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: 'image/png', extensions: ['png'] }
  return null
}
/** Nama file aman untuk disimpan dan ditaruh di header: tanpa path, karakter kontrol, atau tanda kutip. */
export function safeAttachmentName(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = base.normalize('NFC').replace(/[\u0000-\u001f\u007f"<>:*?|]/g, '').replace(/\s+/g, ' ').trim()
  return cleaned.slice(-150)
}
export const attachmentDisposition = (name: string, inline: boolean) => `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`
