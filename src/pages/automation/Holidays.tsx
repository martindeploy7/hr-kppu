import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react'
import { api } from '../../lib/api.ts'
import type { Religion } from '../../../src/engine/types.ts'
import type { AutomationOverview, ReligiousHoliday } from '../../../shared/automation.ts'
import { ErrorLine, Notify, Section, Switch, fmtDay } from './common.tsx'

const religions: Exclude<Religion, 'Lainnya'>[] = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu']
const relClass: Record<string, string> = { Islam: 'r-islam', Kristen: 'r-kristen', Katolik: 'r-katolik', Hindu: 'r-hindu', Buddha: 'r-buddha', Konghucu: 'r-konghucu' }

export function HolidaysSection({ overview, canWrite, onOverview, notify }: { overview: AutomationOverview; canWrite: boolean; onOverview: (o: AutomationOverview) => void; notify: Notify }) {
  const [rows, setRows] = useState<ReligiousHoliday[]>(overview.holidays)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const saved = JSON.stringify(overview.holidays)
  const dirty = JSON.stringify(rows) !== saved
  // Muat ulang hanya bila data di server berubah (polling dengan isi sama tidak menimpa suntingan).
  useEffect(() => { setRows(overview.holidays) }, [saved]) // eslint-disable-line react-hooks/exhaustive-deps
  const today = overview.today
  const patch = (id: string, change: Partial<ReligiousHoliday>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...change } : r))
  const toggleRel = (h: ReligiousHoliday, rel: Religion) => patch(h.id, { religions: h.religions.includes(rel) ? h.religions.filter(x => x !== rel) : [...h.religions, rel] })
  const add = () => setRows(rs => [...rs, { id: `new-${Date.now()}`, date: today, name: '', religions: [], greeting: '', confirmed: false, enabled: true }])
  const save = async () => {
    setError('')
    const bad = rows.find(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.name.trim() || !r.greeting.trim() || r.religions.length === 0)
    if (bad) { setError(`Lengkapi tanggal, nama, ucapan, dan minimal satu agama${bad.name ? ` pada "${bad.name}"` : ''}.`); return }
    setSaving(true)
    try {
      const holidays = rows.map(r => r.id.startsWith('new-') ? { ...r, id: `${r.date}:${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` } : r)
      const next = await api<AutomationOverview>('/automation/holidays', { method: 'PUT', body: JSON.stringify({ holidays }) })
      onOverview(next); setRows(next.holidays); notify('Kalender hari raya disimpan.')
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const pendingCount = rows.filter(r => !r.confirmed && r.enabled && r.date >= today).length

  return <Section id="ac-holidays" title="Kalender hari raya" subtitle="Ucapan hanya dikirim untuk hari raya yang sudah dikonfirmasi" icon={<CalendarDays />}
    aside={pendingCount > 0 ? <span className="tone-chip tone-warn">{pendingCount} belum dikonfirmasi</span> : undefined}>
    <div className="ac-holidays">
      {sorted.map(h => {
        const unconfirmed = !h.confirmed && h.date >= today
        return <div key={h.id} className={`ac-holiday ${unconfirmed ? 'unconfirmed' : ''} ${h.enabled ? '' : 'off'}`}>
          <div className="ac-hol-top">
            {canWrite ? <input type="date" aria-label="Tanggal" value={h.date} onChange={e => patch(h.id, { date: e.target.value })} /> : <strong>{fmtDay(h.date)}</strong>}
            {canWrite ? <input className="ac-hol-name" aria-label="Nama hari raya" placeholder="Nama hari raya" value={h.name} onChange={e => patch(h.id, { name: e.target.value })} /> : <span>{h.name}</span>}
          </div>
          <div className="ac-chips" role="group" aria-label="Agama sasaran">
            {religions.map(r => <button type="button" key={r} className={`ac-rel ${relClass[r]} ${h.religions.includes(r) ? 'on' : ''}`} aria-pressed={h.religions.includes(r)} disabled={!canWrite} onClick={() => toggleRel(h, r)}>{r}</button>)}
          </div>
          <input className="ac-hol-greet" aria-label="Kalimat ucapan" placeholder="Kalimat pembuka ucapan" value={h.greeting} readOnly={!canWrite} onChange={e => patch(h.id, { greeting: e.target.value })} />
          <div className="ac-hol-foot">
            <span className="ac-sw"><Switch on={h.confirmed} label={`Dikonfirmasi: ${h.name || 'hari raya baru'}`} disabled={!canWrite} onClick={() => patch(h.id, { confirmed: !h.confirmed })} /> Dikonfirmasi</span>
            <span className="ac-sw"><Switch on={h.enabled} label={`Aktif: ${h.name || 'hari raya baru'}`} disabled={!canWrite} onClick={() => patch(h.id, { enabled: !h.enabled })} /> Aktif</span>
            {canWrite && <button type="button" className="btn secondary ac-sm" aria-label={`Hapus ${h.name || 'baris baru'}`} onClick={() => setRows(rs => rs.filter(r => r.id !== h.id))}><Trash2 size={14} /> Hapus</button>}
          </div>
          {unconfirmed && <p className="ac-warn-text"><AlertTriangle size={14} /> Belum dikonfirmasi — ucapan tidak dikirim sampai tanggal dicocokkan dengan SKB</p>}
        </div>
      })}
    </div>
    <ErrorLine message={error} />
    {canWrite && <div className="ac-actions">
      <button type="button" className="btn secondary" onClick={add}><Plus size={16} /> Tambah hari raya</button>
      <button type="button" className="btn primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? <LoaderCircle size={16} className="spin-icon" /> : <Save size={16} />} Simpan kalender</button>
    </div>}
  </Section>
}

