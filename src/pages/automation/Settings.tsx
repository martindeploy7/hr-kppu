import { useEffect, useState } from 'react'
import { useDialog } from '../../components/Dialog.tsx'
import { LoaderCircle, Plus, Save, SlidersHorizontal, X } from 'lucide-react'
import { api } from '../../lib/api.ts'
import { isHHMM, normalizePhone, type AutomationOverview, type AutomationSettings } from '../../../shared/automation.ts'
import { ErrorLine, Notify, Section, Switch } from './common.tsx'

const numFields: { key: 'testDailyLimit' | 'minIntervalSec' | 'jitterSec' | 'dailyLimit' | 'maxAttempts'; label: string; hint: string; min: number }[] = [
  { key: 'testDailyLimit', label: 'Batas harian mode uji', hint: 'Pesan/hari ke nomor uji', min: 1 },
  { key: 'minIntervalSec', label: 'Jeda minimum (detik)', hint: 'Antar pesan', min: 0 },
  { key: 'jitterSec', label: 'Variasi acak (detik)', hint: 'Ditambahkan ke jeda', min: 0 },
  { key: 'dailyLimit', label: 'Batas harian', hint: 'Total pesan per hari', min: 1 },
  { key: 'maxAttempts', label: 'Maks. percobaan', hint: 'Sebelum ditandai gagal', min: 1 },
]

export function SettingsSection({ overview, canWrite, onOverview, notify }: { overview: AutomationOverview; canWrite: boolean; onOverview: (o: AutomationOverview) => void; notify: Notify }) {
  const [draft, setDraft] = useState<AutomationSettings>(overview.settings)
  const [phoneInput, setPhoneInput] = useState('')
  const [saving, setSaving] = useState(false)
  const dialog = useDialog()
  const [error, setError] = useState('')
  const saved = JSON.stringify(overview.settings)
  useEffect(() => { setDraft(overview.settings) }, [saved]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== saved
  const set = <K extends keyof AutomationSettings>(k: K, v: AutomationSettings[K]) => setDraft(d => ({ ...d, [k]: v }))

  const toggleTestMode = async () => {
    if (draft.testMode && !await dialog.confirm({ title: 'Matikan mode uji?', message: 'Pesan akan dikirim ke nomor pegawai sungguhan, bukan ke nomor uji.', confirmLabel: 'Matikan mode uji', tone: 'danger' })) return
    set('testMode', !draft.testMode)
  }
  const addPhone = () => {
    const raw = phoneInput.trim(); if (!raw) return
    const n = normalizePhone(raw)
    if (!n) { setError(`Nomor "${raw}" tidak valid. Gunakan format 08xx atau 628xx.`); return }
    if (!draft.testNumbers.includes(n)) set('testNumbers', [...draft.testNumbers, n])
    setPhoneInput(''); setError('')
  }
  const save = async () => {
    setError('')
    if (!isHHMM(draft.windowStart) || !isHHMM(draft.windowEnd)) { setError('Jendela kirim harus berformat HH:MM.'); return }
    if (draft.testMode && draft.testNumbers.length === 0) { setError('Mode uji aktif tetapi belum ada nomor uji. Tambahkan minimal satu nomor.'); return }
    setSaving(true)
    try { onOverview(await api<AutomationOverview>('/automation/settings', { method: 'PUT', body: JSON.stringify(draft) })); notify('Pengaturan pengiriman disimpan.') }
    catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }
  const ro = !canWrite

  return <Section id="ac-settings" title="Pengaturan pengiriman" subtitle="Mode uji, jendela kirim, dan batas laju" icon={<SlidersHorizontal />}>
    <div className="ac-switches">
      <div className={`ac-switch-row tone-amber ${draft.testMode ? 'on' : ''}`}><Switch on={draft.testMode} label="Mode uji" disabled={ro} onClick={toggleTestMode} /><div><strong>Mode uji</strong><small>Semua pesan dialihkan ke nomor uji dengan label penerima asli.</small></div></div>
      <div className={`ac-switch-row tone-violet ${draft.dryRun ? 'on' : ''}`}><Switch on={draft.dryRun} label="Simulasi" disabled={ro} onClick={() => set('dryRun', !draft.dryRun)} /><div><strong>Simulasi</strong><small>Pesan ditandai terkirim tanpa menghubungi WhatsApp.</small></div></div>
      <div className={`ac-switch-row tone-red ${draft.paused ? 'on' : ''}`}><Switch on={draft.paused} label="Jeda pengiriman" disabled={ro} onClick={() => set('paused', !draft.paused)} /><div><strong>Jeda semua pengiriman</strong><small>Antrean tetap tersimpan tetapi tidak ada yang dikirim.</small></div></div>
    </div>

    <div className="ac-field"><span>Nomor uji</span>
      <div className="ac-chips">{draft.testNumbers.map(n => <span key={n} className="ac-phone-chip">{n}{!ro && <button type="button" aria-label={`Hapus nomor ${n}`} onClick={() => set('testNumbers', draft.testNumbers.filter(x => x !== n))}><X size={12} /></button>}</span>)}
        {!draft.testNumbers.length && <small className="ac-hint">Belum ada nomor uji.</small>}</div>
      {!ro && <div className="ac-add-phone"><input value={phoneInput} inputMode="tel" placeholder="08123456789" aria-label="Tambah nomor uji" onChange={e => setPhoneInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPhone() } }} />
        <button type="button" className="btn secondary" onClick={addPhone}><Plus size={15} /> Tambah</button></div>}
    </div>

    <div className="ac-fields">
      <label className="ac-field"><span>Jendela kirim mulai (WIB)</span><input type="time" value={draft.windowStart} readOnly={ro} onChange={e => set('windowStart', e.target.value)} /></label>
      <label className="ac-field"><span>Jendela kirim selesai (WIB)</span><input type="time" value={draft.windowEnd} readOnly={ro} onChange={e => set('windowEnd', e.target.value)} /></label>
      {numFields.map(f => <label key={f.key} className="ac-field"><span>{f.label}</span><input type="number" min={f.min} value={draft[f.key]} readOnly={ro} onChange={e => set(f.key, Math.max(f.min, Number(e.target.value) || 0))} /><small>{f.hint}</small></label>)}
      <label className="ac-field wide"><span>Alamat portal HR</span><input type="url" value={draft.portalUrl} readOnly={ro} onChange={e => set('portalUrl', e.target.value)} /></label>
      <label className="ac-field wide"><span>Tanda tangan pengirim</span><input value={draft.signature} readOnly={ro} onChange={e => set('signature', e.target.value)} /></label>
    </div>
    <ErrorLine message={error} />
    {canWrite && <div className="ac-actions"><button type="button" className="btn primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? <LoaderCircle size={16} className="spin-icon" /> : <Save size={16} />} Simpan pengaturan</button>
      {dirty && <button type="button" className="btn secondary" onClick={() => setDraft(overview.settings)}>Batalkan perubahan</button>}</div>}
  </Section>
}
