/** Batas dan bentuk data Rekap ST yang dipakai bersama klien dan server. */
export const ST_MAX_DAYS = 31
export const ST_MAX_PARTICIPANTS = 300
export const ST_MAX_ATTACHMENTS = 3
export const ST_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const ST_CATATAN_MAX = 500
export const ST_ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

export type StAttachmentMeta = { id: string; groupId: string; fileName: string; mime: string; size: number; createdAt: string; uploadedBy: string }

export type StRecord = {
  id: string; sourceId: string; groupId: string; registerOffice: string; letterNo: string; letterDate: string
  employeeId: string; name: string; nip: string; external: boolean; note: string
  activityDate: string; destination: string; catatan: string; version: number
  status: string; cancelReason: string; createdAt: string; createdBy: string
}

export type ExternalParticipant = { name: string; note?: string }
