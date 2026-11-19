import { useMemo, useState } from 'react'
import { matchParticipants, parseParticipantLines, type BulkEmployee, type BulkRow } from '../../lib/stBulk.ts'
import type { ExternalEntry } from './ParticipantPicker.tsx'

type Choice = { action: 'add' | 'skip' | 'external'; employeeId?: string; note?: string; name?: string }
const STATUS_LABEL: Record<BulkRow['status'], string> = { matched: 'Cocok', ambiguous: 'Pilih salah satu', notfound: 'Tidak ditemukan', duplicate: 'Sudah ada' }
const describe = (employee: BulkEmployee) => `${employee.nama} · ${employee.nip || 'tanpa NIP'} · ${employee.kantor}`

/** Tempel daftar peserta dari lampiran ST: cocokkan ke master, tampilkan konfirmasi, lalu tambahkan yang dipilih. */
export function BulkPaste({ employees, selectedIds, remaining, onApply, onClose }: {
  employees: BulkEmployee[]; selectedIds: string[]; remaining: number
  onApply: (result: { employeeIds: string[]; externals: ExternalEntry[] }) => void; onClose: () => void
}) {
  const [text, setText] = useState('')
  const [rows, setRows] = useState<BulkRow[] | null>(null)
  const [choices, setChoices] = useState<Record<number, Choice>>({})
  const [error, setError] = useState('')

  const analyze = () => {
    setError('')
    const parsed = parseParticipantLines(text)
    if (!parsed.length) { setRows(null); setError('Belum ada baris yang bisa dibaca. Tempel satu peserta per baris.'); return }
    const matched = matchParticipants(parsed, employees, new Set(selectedIds))
    setRows(matched)
    setChoices(Object.fromEntries(matched.map(row => [row.index, row.status === 'matched' ? { action: 'add', employeeId: row.employeeId } as Choice : { action: 'skip' } as Choice])))
  }
  const setChoice = (index: number, choice: Choice) => setChoices(current => ({ ...current, [index]: choice }))

  const plan = useMemo(() => {
    const ids: string[] = [], externals: ExternalEntry[] = [], seen = new Set<string>(selectedIds), seenExternal = new Set<string>()
    let conflicts = 0
    for (const row of rows ?? []) {
      const choice = choices[row.index]
      if (!choice || choice.action === 'skip') continue
      if (choice.action === 'add' && choice.employeeId) {
        if (seen.has(choice.employeeId)) { conflicts++; continue }
        seen.add(choice.employeeId); ids.push(choice.employeeId)
      } else if (choice.action === 'external') {
        const name = (choice.name ?? row.name).trim(), key = name.toLocaleLowerCase('id-ID')
        if (name.length < 2 || seenExternal.has(key)) { conflicts++; continue }
        seenExternal.add(key); externals.push({ name, note: (choice.note ?? row.note).trim() || undefined })
      }
    }
    return { ids, externals, conflicts, total: ids.length + externals.length }
  }, [rows, choices, selectedIds])

  const counts = useMemo(() => {
    const result = { matched: 0, ambiguous: 0, notfound: 0, duplicate: 0 }
    for (const row of rows ?? []) result[row.status]++
    return result
  }, [rows])
  const over = plan.total > remaining

  return <div className="st-bulk" role="group" aria-label="Tempel daftar peserta">
    <label className="st-field">Daftar peserta dari lampiran ST
      <textarea rows={6} value={text} onChange={e => { setText(e.target.value); setRows(null) }} placeholder={'Satu peserta per baris, NIP dan/atau nama. Contoh:\n1. Budi Santoso, S.H.\t198001012005011001\n2. Siti Aminah'} />
    </label>
    <p className="muted small">Nomor urut, gelar (S.H., Dr., M.Si), tab, dan koma boleh ikut tertempel. NIP dicocokkan lebih dulu, lalu nama.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="st-tools">
      <button type="button" className="btn secondary" disabled={!text.trim()} onClick={analyze}>Cocokkan dengan master</button>
      <button type="button" className="btn ghost" onClick={onClose}>Tutup</button>
    </div>
    {rows && <div className="st-bulk-result">
      <p role="status" className="st-bulk-summary"><strong>{rows.length} baris dibaca.</strong> {counts.matched} cocok{counts.ambiguous ? `, ${counts.ambiguous} perlu dipilih` : ''}{counts.notfound ? `, ${counts.notfound} tidak ditemukan` : ''}{counts.duplicate ? `, ${counts.duplicate} dilewati karena sudah ada` : ''}.</p>
      <ul className="st-bulk-list">{rows.map(row => {
        const choice = choices[row.index] ?? { action: 'skip' as const }
        const label = row.name || row.nip
        return <li key={row.index} className={`st-bulk-row ${row.status}`}>
          <div className="st-bulk-head"><span className={`st-bulk-status ${row.status}`}>{STATUS_LABEL[row.status]}</span><strong>{label}</strong>{row.nip && row.name && <small className="mono">{row.nip}</small>}</div>
          {row.warning && <small className="st-bulk-warning">{row.warning}</small>}
          {row.status === 'matched' && row.candidates[0] && <label className="st-bulk-check"><input type="checkbox" checked={choice.action === 'add'} onChange={e => setChoice(row.index, { action: e.target.checked ? 'add' : 'skip', employeeId: row.employeeId })} /> <span>Tambahkan: {describe(row.candidates[0])}</span></label>}
          {row.status === 'duplicate' && row.candidates[0] && <small className="muted">{describe(row.candidates[0])}</small>}
          {(row.status === 'ambiguous' || row.status === 'notfound') && <div className="st-bulk-choice">
            <label className="st-field">Tindakan
              <select value={choice.action === 'add' ? `emp:${choice.employeeId}` : choice.action} onChange={e => {
                const value = e.target.value
                if (value === 'skip') setChoice(row.index, { action: 'skip' })
                else if (value === 'external') setChoice(row.index, { action: 'external', name: row.name, note: row.note })
                else setChoice(row.index, { action: 'add', employeeId: value.slice(4) })
              }}>
                <option value="skip">{row.status === 'ambiguous' ? 'Pilih pegawai, atau lewati' : 'Lewati'}</option>
                {row.candidates.map(employee => <option key={employee.id} value={`emp:${employee.id}`}>{describe(employee)}{row.similar ? ' (mirip)' : ''}</option>)}
                {row.name.length >= 2 && <option value="external">Tambah sebagai Lainnya (tanpa NIP)</option>}
              </select>
            </label>
            {choice.action === 'external' && <div className="st-bulk-external">
              <label className="st-field">Nama<input value={choice.name ?? row.name} maxLength={120} onChange={e => setChoice(row.index, { ...choice, name: e.target.value })} /></label>
              <label className="st-field">Keterangan<input value={choice.note ?? row.note} maxLength={200} placeholder="Mis. Driver Komisi" onChange={e => setChoice(row.index, { ...choice, note: e.target.value })} /></label>
            </div>}
          </div>}
        </li>
      })}</ul>
      {over && <p role="alert" className="form-error">Ada {plan.total} peserta terpilih, tetapi tersisa ruang untuk {remaining}. Kurangi pilihan atau hapus peserta yang sudah ada.</p>}
      {plan.conflicts > 0 && <p className="muted small">{plan.conflicts} pilihan dilewati karena dobel atau nama terlalu pendek.</p>}
      <div className="st-tools">
        <button type="button" className="btn primary" disabled={!plan.total || over} onClick={() => onApply({ employeeIds: plan.ids, externals: plan.externals })}>Tambahkan {plan.total} peserta</button>
        <span className="muted small">{plan.ids.length} pegawai master{plan.externals.length ? `, ${plan.externals.length} Lainnya` : ''}</span>
      </div>
    </div>}
  </div>
}
