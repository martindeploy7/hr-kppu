import { useEffect, useRef, useState } from 'react'
import { Save, Send, Settings2, LoaderCircle } from 'lucide-react'
import { Bone } from '../../components/Skeleton.tsx'
import { api } from '../../lib/api.ts'
import { isHHMM, type AutomationKind, type AutomationOverview, type AutomationRule, type AutomationRuleOptions, type OutboxItem, type RulePreview } from '../../../shared/automation.ts'
import { Bubbles, ErrorLine, Notify, Section, Switch, ago, ruleIcon, scopeLabels, todayWib } from './common.tsx'

const groups: { kind: AutomationKind; title: string; hint: string }[] = [
  { kind: 'scheduled', title: 'Terjadwal harian', hint: 'Dijalankan otomatis setiap hari sesuai jam kirim' },
  { kind: 'event', title: 'Dipicu data', hint: 'Dikirim setelah data berubah atau setoran masuk' },
  { kind: 'campaign', title: 'Kampanye HR', hint: 'Disusun HR lalu dijadwalkan' },
]
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

export function RulesSection({ overview, canWrite, selectedId, onSelect, onOverview, notify, previewDate, nowMs }: {
  overview: AutomationOverview; canWrite: boolean; selectedId: string; onSelect: (id: string) => void
  onOverview: (o: AutomationOverview) => void; notify: Notify; previewDate: string; nowMs: number
}) {
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const selected = overview.rules.find(r => r.id === selectedId) ?? overview.rules[0]
  const toggle = async (rule: AutomationRule) => {
    setBusyId(rule.id); setError('')
    try { onOverview(await api<AutomationOverview>(`/automation/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !rule.enabled }) })); notify(`${rule.title} ${rule.enabled ? 'dinonaktifkan' : 'diaktifkan'}.`) }
    catch (e) { setError((e as Error).message) }
    finally { setBusyId('') }
  }
  const enabledCount = overview.rules.filter(r => r.enabled).length
  return <Section id="ac-rules" title="Aturan otomatis" subtitle={`${enabledCount} dari ${overview.rules.length} aturan aktif`} icon={<Settings2 />}>
    <ErrorLine message={error} />
    <div className="ac-rules-layout">
      <div className="ac-rules-list">
        {groups.map(g => {
          const rules = overview.rules.filter(r => r.kind === g.kind)
          if (!rules.length) return null
          return <div key={g.kind} className="ac-rule-group">
            <div className="ac-group-title"><strong>{g.title}</strong><small>{g.hint}</small></div>
            {rules.map(r => {
              const planned = overview.scheduler.lastPlanned[r.id]
              return <div key={r.id} className={`ac-rule ${r.enabled ? 'enabled' : ''} ${selected?.id === r.id ? 'selected' : ''}`}>
                <button type="button" className="ac-rule-main" aria-pressed={selected?.id === r.id} onClick={() => onSelect(r.id)}>
                  <span className={`ac-rule-icon k-${r.kind}`}>{ruleIcon(r.id)}</span>
                  <span className="ac-rule-copy">
                    <span className="ac-tags"><strong>{r.title}</strong><span className="ac-tag">{r.category}</span><span className={`ac-tag scope-${r.scope}`}>{scopeLabels[r.scope]}</span>{r.privacy === 'sensitive' && <span className="ac-tag sensitive">Privat</span>}</span>
                    <small>{r.kind === 'event' ? 'Mulai' : 'Kirim'} {r.sendTime} WIB{planned ? ` · terakhir diantrikan ${new Date(planned.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta', hour12: false }).replace('.', ':')} · ${planned.queued} pesan (${ago(planned.at, nowMs)})` : r.kind === 'campaign' ? '' : ' · belum pernah diantrikan'}</small>
                  </span>
                </button>
                <Switch on={r.enabled} label={`${r.enabled ? 'Nonaktifkan' : 'Aktifkan'} ${r.title}`} disabled={!canWrite || busyId === r.id} onClick={() => void toggle(r)} />
              </div>
            })}
          </div>
        })}
      </div>
      {selected && <RuleDetail key={`${selected.id}:${selected.updatedAt ?? ''}`} rule={selected} overview={overview} canWrite={canWrite} onOverview={onOverview} notify={notify} previewDate={previewDate} />}
    </div>
  </Section>
}

function RuleDetail({ rule, overview, canWrite, onOverview, notify, previewDate }: {
  rule: AutomationRule; overview: AutomationOverview; canWrite: boolean; onOverview: (o: AutomationOverview) => void; notify: Notify; previewDate: string
}) {
  const [template, setTemplate] = useState(rule.template)
  const [sendTime, setSendTime] = useState(rule.sendTime)
  const [options, setOptions] = useState<AutomationRuleOptions>(rule.options)
  const [milestonesText, setMilestonesText] = useState((rule.options.milestones ?? []).join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const dirty = template !== rule.template || sendTime !== rule.sendTime || JSON.stringify(options) !== JSON.stringify(rule.options)
  const isCampaign = rule.kind === 'campaign'

  const insertToken = (token: string) => {
    const el = area.current; const text = `{{${token}}}`
    if (!el) { setTemplate(t => t + text); return }
    const s = el.selectionStart, e = el.selectionEnd
    setTemplate(template.slice(0, s) + text + template.slice(e))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + text.length, s + text.length) })
  }
  const save = async () => {
    setError('')
    if (!isHHMM(sendTime)) { setError('Jam kirim harus berformat HH:MM.'); return }
    if (!template.trim()) { setError('Template tidak boleh kosong.'); return }
    const next = { ...options }
    if (rule.id === 'anniversary') {
      const nums = milestonesText.split(/[,\s]+/).filter(Boolean).map(Number)
      if (nums.some(n => !Number.isInteger(n) || n < 1 || n > 60)) { setError('Milestone harus berupa angka tahun (1–60) dipisah koma.'); return }
      next.milestones = nums
    }
    if (rule.id === 'datarefresh' && !(next.months?.length)) { setError('Pilih minimal satu bulan pengiriman.'); return }
    setSaving(true)
    try { onOverview(await api<AutomationOverview>(`/automation/rules/${rule.id}`, { method: 'PUT', body: JSON.stringify({ sendTime, template, options: next }) })); notify(`Aturan "${rule.title}" disimpan.`) }
    catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }
  const toggleMonth = (m: number) => setOptions(o => { const cur = o.months ?? []; return { ...o, months: cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m].sort((a, b) => a - b) } })

  return <div className="ac-detail" aria-label={`Detail aturan ${rule.title}`}>
    <h4>{rule.title}</h4>
    <p className="ac-desc">{rule.description}</p>
    <p className="ac-aud"><b>Sasaran:</b> {rule.audience}</p>
    <label className="ac-label" htmlFor="ac-template">Template pesan</label>
    <div className="ac-chips" role="group" aria-label="Sisipkan token">
      {rule.tokens.map(t => <button type="button" key={t} className="ac-token" disabled={!canWrite} onClick={() => insertToken(t)}>{`{{${t}}}`}</button>)}
    </div>
    <textarea id="ac-template" ref={area} className="ac-textarea" rows={7} value={template} readOnly={!canWrite} onChange={e => setTemplate(e.target.value)} />
    <div className="ac-fields">
      <label className="ac-field"><span>{rule.kind === 'event' ? 'Jam paling awal (WIB)' : 'Jam kirim (WIB)'}</span>
        <input type="time" value={sendTime} readOnly={!canWrite} onChange={e => setSendTime(e.target.value)} /></label>
      {rule.id === 'anniversary' && <label className="ac-field"><span>Milestone (tahun, pisah koma)</span>
        <input value={milestonesText} readOnly={!canWrite} placeholder="1, 5, 10, 15" onChange={e => setMilestonesText(e.target.value)} /><small>Kosong = setiap tahun</small></label>}
      {(rule.id === 'rejected' || rule.id === 'forgotout') && <label className="ac-field"><span>Cakupan hari ke belakang</span>
        <input type="number" min={1} max={90} value={options.lookbackDays ?? 14} readOnly={!canWrite} onChange={e => setOptions(o => ({ ...o, lookbackDays: Number(e.target.value) }))} /><small>Hanya bukti dalam N hari terakhir yang diberitahukan</small></label>}
    </div>
    {rule.id === 'datarefresh' && <div className="ac-field"><span>Bulan pengiriman (hari kerja pertama)</span>
      <div className="ac-chips">{monthNames.map((n, i) => <button type="button" key={n} className={`ac-month ${options.months?.includes(i + 1) ? 'on' : ''}`} aria-pressed={!!options.months?.includes(i + 1)} disabled={!canWrite} onClick={() => toggleMonth(i + 1)}>{n}</button>)}</div></div>}
    <ErrorLine message={error} />
    {canWrite && <div className="ac-actions"><button type="button" className="btn primary" disabled={saving || !dirty} onClick={() => void save()}>{saving ? <LoaderCircle size={16} className="spin-icon" /> : <Save size={16} />} Simpan aturan</button>
      {dirty && <button type="button" className="btn secondary" onClick={() => { setTemplate(rule.template); setSendTime(rule.sendTime); setOptions(rule.options); setMilestonesText((rule.options.milestones ?? []).join(', ')) }}>Batalkan perubahan</button>}
      {dirty && <small className="ac-hint">Pratinjau memakai template yang tersimpan; simpan dulu untuk melihat perubahan.</small>}</div>}
    {isCampaign
      ? <div className="ac-preview-box"><strong>Kampanye HR</strong>
        <p className="ac-desc">Aturan ini tidak berjalan harian. Susun dan jadwalkan pesannya di bagian Kampanye HR.</p>
        <a className="btn secondary" href="#ac-campaigns">Buka penyusun kampanye</a></div>
      : <DailyPreview rule={rule} settingsTestNumbers={overview.settings.testNumbers.length} canWrite={canWrite} notify={notify} initialDate={previewDate} stamp={rule.updatedAt ?? ''} />}
  </div>
}

function DailyPreview({ rule, settingsTestNumbers, canWrite, notify, initialDate, stamp }: { rule: AutomationRule; settingsTestNumbers: number; canWrite: boolean; notify: Notify; initialDate: string; stamp: string }) {
  const [date, setDate] = useState(initialDate || todayWib())
  const [preview, setPreview] = useState<RulePreview>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  useEffect(() => { setDate(initialDate || todayWib()) }, [initialDate])
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    api<RulePreview>(`/automation/preview?ruleId=${rule.id}&date=${date}`)
      .then(p => { if (active) setPreview(p) })
      .catch(e => { if (active) setError((e as Error).message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [rule.id, date, stamp])
  const sendTest = async () => {
    setTesting(true); setError('')
    try { const { item } = await api<{ item: OutboxItem }>('/automation/test', { method: 'POST', body: JSON.stringify({ ruleId: rule.id, employeeId: preview?.recipients[0]?.employeeId }) }); notify(`Pesan uji diantrikan ke ${item.deliverTo || 'nomor uji'}.`) }
    catch (e) { setError((e as Error).message) }
    finally { setTesting(false) }
  }
  return <div className="ac-preview-box">
    <div className="ac-preview-head"><strong>Pratinjau pesan</strong>
      <label className="ac-inline">Tanggal <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></label></div>
    {loading ? <div className="sk-stack" role="status" aria-busy="true"><span className="sk-sr">Memuat pratinjau…</span><Bone w="40%" h={12} /><Bone h={70} r={12} /><Bone h={70} r={12} /></div> : preview && <Bubbles preview={preview} />}
    <ErrorLine message={error} />
    {canWrite && <div className="ac-actions"><button type="button" className="btn secondary" disabled={testing || settingsTestNumbers === 0} onClick={() => void sendTest()}>{testing ? <LoaderCircle size={16} className="spin-icon" /> : <Send size={16} />} Kirim tes ke nomor uji</button>
      {settingsTestNumbers === 0 && <small className="ac-hint">Isi nomor uji di Pengaturan pengiriman terlebih dahulu.</small>}</div>}
  </div>
}
