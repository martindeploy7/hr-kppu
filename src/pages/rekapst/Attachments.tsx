import { useId, useRef, useState } from 'react'
import { FileText, Paperclip } from 'lucide-react'
import { ST_ATTACHMENT_ACCEPT, ST_MAX_ATTACHMENTS, ST_MAX_ATTACHMENT_BYTES, type StAttachmentMeta } from '../../../shared/rekapSt.ts'

export const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
const OK_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png']
const fileUrl = (id: string, inline: boolean) => `/api/rekap-st/attachments/${encodeURIComponent(id)}/file${inline ? '?inline=1' : ''}`

/** Tautan lihat/unduh lampiran pada riwayat. Server menyajikan sebagai unduhan kecuali diminta tampil di tab baru. */
export function AttachmentLinks({ items }: { items: StAttachmentMeta[] }) {
  if (!items.length) return <span className="muted">Tidak ada</span>
  return <ul className="st-attach-links">{items.map(item => <li key={item.id}>
    <a href={fileUrl(item.id, true)} target="_blank" rel="noopener noreferrer" title={`Lihat ${item.fileName}`}><FileText size={14} aria-hidden /> <span>{item.fileName}</span></a>
    <small>{formatSize(item.size)} · <a href={fileUrl(item.id, false)} download={item.fileName}>Unduh</a></small>
  </li>)}</ul>
}

/** Pilih lampiran scan ST pada formulir tambah/koreksi. File baru diunggah setelah ST tersimpan; lampiran lama dihapus lewat konfirmasi. */
export function AttachmentField({ existing, pending, onPending, onRemoveExisting, disabled }: {
  existing: StAttachmentMeta[]; pending: File[]; onPending: (files: File[]) => void; onRemoveExisting: (item: StAttachmentMeta) => void; disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState('')
  const id = useId()
  const room = ST_MAX_ATTACHMENTS - existing.length - pending.length
  const choose = (list: FileList | null) => {
    if (!list) return
    const accepted: File[] = [], problems: string[] = []
    for (const file of Array.from(list)) {
      const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
      if (!OK_EXTENSIONS.includes(extension)) problems.push(`${file.name}: hanya PDF, JPG, atau PNG.`)
      else if (file.size > ST_MAX_ATTACHMENT_BYTES) problems.push(`${file.name}: lebih dari 10 MB.`)
      else if (file.size === 0) problems.push(`${file.name}: file kosong.`)
      else if (accepted.length >= room) problems.push(`${file.name}: batas ${ST_MAX_ATTACHMENTS} lampiran per ST.`)
      else accepted.push(file)
    }
    setProblem(problems.join(' '))
    if (accepted.length) onPending([...pending, ...accepted])
    if (input.current) input.current.value = ''
  }
  return <div className="st-attach">
    <span className="st-multi-label" id={`${id}-label`}>Lampiran scan ST (opsional)</span>
    <p className="muted small" id={`${id}-hint`}>PDF, JPG, atau PNG. Maksimal 10 MB per file dan {ST_MAX_ATTACHMENTS} file per ST.</p>
    {(existing.length > 0 || pending.length > 0) && <ul className="st-attach-list">
      {existing.map(item => <li key={item.id}><span><Paperclip size={14} aria-hidden /> <a href={fileUrl(item.id, true)} target="_blank" rel="noopener noreferrer">{item.fileName}</a> <small>{formatSize(item.size)}</small></span><button type="button" className="btn ghost danger" disabled={disabled} aria-label={`Hapus lampiran ${item.fileName}`} onClick={() => onRemoveExisting(item)}>Hapus</button></li>)}
      {pending.map((file, i) => <li key={`${file.name}:${i}`}><span><Paperclip size={14} aria-hidden /> {file.name} <small>{formatSize(file.size)} · belum diunggah</small></span><button type="button" className="btn ghost" disabled={disabled} aria-label={`Batalkan lampiran ${file.name}`} onClick={() => onPending(pending.filter((_, index) => index !== i))}>Lepas</button></li>)}
    </ul>}
    <input ref={input} type="file" hidden id={`${id}-input`} multiple accept={ST_ATTACHMENT_ACCEPT} aria-describedby={`${id}-hint`} onChange={e => choose(e.target.files)} />
    <div className="st-tools"><button type="button" className="btn secondary" aria-labelledby={`${id}-label`} disabled={disabled || room <= 0} onClick={() => input.current?.click()}>{room <= 0 ? 'Batas lampiran tercapai' : 'Pilih file'}</button></div>
    {problem && <p role="alert" className="form-error">{problem}</p>}
  </div>
}
