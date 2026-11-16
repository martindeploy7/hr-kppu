import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, LoaderCircle, Megaphone, Search, CalendarClock, X } from 'lucide-react'
import { ListSkeleton } from '../../components/Skeleton.tsx'
import { api } from '../../lib/api.ts'
import { useHr } from '../../state/HrData.tsx'
import type { AutomationOverview, AutomationRuleId, AutomationRule, Campaign, CampaignAudience, RulePreview } from '../../../shared/automation.ts'
import { Bubbles, ErrorLine, Notify, Section, fmtDateTime } from './common.tsx'

const BASE_TOKENS = ['sapaan', 'nama', 'nama_depan', 'pengirim']
type AudKind = 'all' | 'kantor' | 'unit' | 'agama' | 'pegawai'
const audLabels: Record<AudKind, string> = { all: 'Semua pegawai', kantor: 'Kantor', unit: 'Unit', agama: 'Agama', pegawai: 'Pegawai tertentu' }
const campTone = { scheduled: ['tone-info', 'Terjadwal'], done: ['tone-ok', 'Selesai'], cancelled: ['tone-leave', 'Dibatalkan'] } as const

const humanToken = (t: string) => t.replace(/_/g, ' ')
const audienceText = (a: CampaignAudience) => a.kind === 'all' ? 'Semua pegawai' : `${audLabels[a.kind]}: ${a.values.length > 3 ? `${a.values.slice(0, 3).join(', ')} +${a.values.length - 3}` : a.values.join(', ')}`
/** datetime-local (WIB) -> ISO dengan offset +07:00 */
const toIsoWib = (local: string) => `${local.length === 16 ? `${local}:00` : local}+07:00`
const defaultSendAt = () => { const d = new Date(Date.now() + 3600_000 + 7 * 3600_000); d.setUTCMinutes(0, 0, 0); return d.toISOString().slice(0, 16) }
/** Waktu WIB saat ini untuk datetime-local (kirim secepatnya, tetap mengikuti jendela kirim). */
const nowWib = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16)

export function CampaignsSection({ overview, canWrite, selectedRuleId, notify }: { overview: AutomationOverview; canWrite: boolean; selectedRuleId: string; notify: Notify }) {
  const hr = useHr()
  const employees = hr.roster.employees
  const campaignRules = overview.rules.filter(r => r.kind === 'campaign')
  const [ruleId, setRuleId] = useState<AutomationRuleId>(() => campaignRules.find(r => r.id === selectedRuleId)?.id ?? campaignRules[0]?.id ?? 'training')
  const rule: AutomationRule | undefined = campaignRules.find(r => r.id === ruleId)
  useEffect(() => { if (campaignRules.some(r => r.id === selectedRuleId)) setRuleId(selectedRuleId as AutomationRuleId) }, [selectedRuleId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [title, setTitle] = useState('')
  const [template, setTemplate] = useState(rule?.template ?? '')
  const [variables, setVariables] = useState<Record<string, string>>({})
  const [audKind, setAudKind] = useState<AudKind>('all')
  const [values, setValues] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [sendAt, setSendAt] = useState(defaultSendAt)
  const [repeatMonthly, setRepeatMonthly] = useState(false)
  const [preview, setPreview] = useState<RulePreview>()
  const [busy, setBusy] = useState<'' | 'preview' | 'save'>('')
  const [error, setError] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>()
  const [listError, setListError] = useState('')

  useEffect(() => { setTemplate(rule?.template ?? ''); setVariables({}); setPreview(undefined) }, [ruleId]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadCampaigns = useCallback(async () => {
    try { setCampaigns((await api<{ campaigns: Campaign[] }>('/automation/campaigns')).campaigns); setListError('') }
    catch (e) { setListError((e as Error).message) }
  }, [])
  useEffect(() => { void loadCampaigns() }, [loadCampaigns])

  const extraTokens = (rule?.tokens ?? []).filter(t => !BASE_TOKENS.includes(t))
  const options = useMemo(() => {
    if (audKind === 'pegawai') return employees.map(e => ({ value: e.id, label: e.nama, sub: `${e.unit} · ${e.kantor}` }))
    const key = audKind === 'kantor' ? 'kantor' : audKind === 'unit' ? 'unit' : 'agama'
    const counts = new Map<string, number>()
    for (const e of employees) { const v = e[key]; if (v) counts.set(v, (counts.get(v) ?? 0) + 1) }
    return [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([v, n]) => ({ value: v, label: v, sub: `${n} pegawai` }))
  }, [audKind, employees])
  const shown = options.filter(o => !query || `${o.label} ${o.sub}`.toLowerCase().includes(query.toLowerCase())).slice(0, 80)
  const audience: CampaignAudience = audKind === 'all' ? { kind: 'all' } : { kind: audKind, values }
  const toggleValue = (v: string) => setValues(cur => cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v])
  const pickKind = (k: AudKind) => { setAudKind(k); setValues([]); setQuery(''); setPreview(undefined) }

  const validate = (forSave: boolean) => {
    if (!rule) return 'Pilih jenis kampanye.'
    if (!template.trim()) return 'Template tidak boleh kosong.'
    if (audKind !== 'all' && values.length === 0) return 'Pilih minimal satu sasaran penerima.'
    const missing = extraTokens.filter(t => template.includes(`{{${t}}}`) && !variables[t]?.trim())
    if (missing.length) return `Isi dulu: ${missing.map(humanToken).join(', ')}.`
    if (forSave) {
      if (!title.trim()) return 'Judul kampanye wajib diisi.'
      if (!sendAt) return 'Tentukan waktu kirim.'
      if (new Date(toIsoWib(sendAt)).getTime() < Date.now() - 4 * 60_000) return 'Waktu kirim sudah lewat. Pilih waktu baru atau klik "Sekarang".'
    }
    return ''
  }
  const body = () => ({ ruleId, template, variables, audience })
  const doPreview = async () => {
    const v = validate(false); if (v) { setError(v); return }
    setBusy('preview'); setError('')
    try { setPreview(await api<RulePreview>('/automation/campaigns/preview', { method: 'POST', body: JSON.stringify(body()) })) }
    catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }
  const schedule = async () => {
    const v = validate(true); if (v) { setError(v); return }
    setBusy('save'); setError('')
    try {
      await api<{ campaign: Campaign }>('/automation/campaigns', { method: 'POST', body: JSON.stringify({ ...body(), title: title.trim(), sendAt: toIsoWib(sendAt), repeatMonthly }) })
      notify(`Kampanye "${title.trim()}" dijadwalkan.`)
      setTitle(''); setPreview(undefined); void loadCampaigns()
    } catch (e) { setError((e as Error).message) }
    finally { setBusy('') }
  }
  const cancel = async (c: Campaign) => {
    setListError('')
    try { await api<{ campaign: Campaign }>(`/automation/campaigns/${c.id}/cancel`, { method: 'POST' }); notify(`Kampanye "${c.title}" dibatalkan.`); void loadCampaigns() }
    catch (e) { setListError((e as Error).message) }
  }
  const ruleTitle = (id: string) => overview.rules.find(r => r.id === id)?.title ?? id

  return <Section id="ac-campaigns" title="Kampanye HR" subtitle="Susun pesan, pilih sasaran, lalu jadwalkan pengiriman" icon={<Megaphone />}>
    {!canWrite ? <p className="ac-note">Anda hanya dapat melihat kampanye. Penyusunan dilakukan HR atau Superadmin.</p> : !rule ? <p className="ac-note">Belum ada aturan kampanye.</p> : <div className="ac-composer">
      <div className="ac-fields">
        <label className="ac-field"><span>Jenis kampanye</span>
          <select value={ruleId} onChange={e => setRuleId(e.target.value as AutomationRuleId)}>{campaignRules.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
        <label className="ac-field"><span>Judul kampanye</span><input value={title} maxLength={120} placeholder="mis. Pengingat SPT Tahunan 2027" onChange={e => setTitle(e.target.value)} /></label>
      </div>
      <label className="ac-label" htmlFor="ac-camp-template">Template pesan</label>
      <div className="ac-chips">{rule.tokens.map(t => <span key={t} className="ac-token static">{`{{${t}}}`}</span>)}</div>
      <textarea id="ac-camp-template" className="ac-textarea" rows={6} value={template} onChange={e => setTemplate(e.target.value)} />
      {extraTokens.length > 0 && <div className="ac-fields">{extraTokens.map(t => <label key={t} className="ac-field"><span>{humanToken(t)}</span>
        <input value={variables[t] ?? ''} onChange={e => setVariables(v => ({ ...v, [t]: e.target.value }))} /></label>)}</div>}

      <div className="ac-field"><span>Sasaran penerima</span>
        <div className="ac-chips" role="group" aria-label="Jenis sasaran">{(Object.keys(audLabels) as AudKind[]).map(k => <button type="button" key={k} className={`ac-month ${audKind === k ? 'on' : ''}`} aria-pressed={audKind === k} onClick={() => pickKind(k)}>{audLabels[k]}</button>)}</div></div>
      {audKind !== 'all' && <div className="ac-picker">
        <div className="ac-search"><Search size={15} /><input value={query} placeholder={`Cari ${audLabels[audKind].toLowerCase()}…`} aria-label="Cari sasaran" onChange={e => setQuery(e.target.value)} /></div>
        <div className="ac-picker-list" role="listbox" aria-multiselectable="true" aria-label={`Pilih ${audLabels[audKind]}`}>
          {shown.map(o => <button type="button" role="option" aria-selected={values.includes(o.value)} key={o.value} className={values.includes(o.value) ? 'on' : ''} onClick={() => toggleValue(o.value)}><span>{o.label}</span><small>{o.sub}</small></button>)}
          {!shown.length && <p className="ac-note">Tidak ada hasil.</p>}
        </div>
        <small className="ac-hint">{values.length} dipilih{options.length > shown.length && !query ? ` · menampilkan ${shown.length} dari ${options.length}, gunakan pencarian` : ''}</small>
      </div>}

      <div className="ac-fields">
        <label className="ac-field"><span>Waktu kirim (WIB)</span><span className="ac-inline-row"><input type="datetime-local" value={sendAt} onChange={e => setSendAt(e.target.value)} /><button type="button" className="btn secondary" onClick={() => setSendAt(nowWib())}>Sekarang</button></span></label>
        <label className="ac-check"><input type="checkbox" checked={repeatMonthly} onChange={e => setRepeatMonthly(e.target.checked)} /> Ulangi setiap bulan</label>
      </div>
      <ErrorLine message={error} />
      <div className="ac-actions">
        <button type="button" className="btn secondary" disabled={!!busy} onClick={() => void doPreview()}>{busy === 'preview' ? <LoaderCircle size={16} className="spin-icon" /> : <Eye size={16} />} Pratinjau penerima</button>
        <button type="button" className="btn primary" disabled={!!busy} onClick={() => void schedule()}>{busy === 'save' ? <LoaderCircle size={16} className="spin-icon" /> : <CalendarClock size={16} />} Jadwalkan</button>
      </div>
      {busy === 'preview' ? <ListSkeleton rows={2} cols={2} label="Memuat pratinjau…" /> : preview && <Bubbles preview={preview} />}
    </div>}

    <h4 className="ac-sub">Daftar kampanye</h4>
    <ErrorLine message={listError} />
    {!campaigns ? <ListSkeleton rows={3} cols={4} label="Memuat kampanye…" /> : campaigns.length === 0 ? <p className="ac-note">Belum ada kampanye.{canWrite ? ' Susun lewat formulir di atas.' : ''}</p> : <ul className="ac-camp-list">
      {campaigns.map(c => { const [tone, label] = campTone[c.status]; return <li key={c.id}>
        <div><strong>{c.title}</strong><small>{ruleTitle(c.ruleId)} · {audienceText(c.audience)}</small>
          <small>{fmtDateTime(c.sendAt)}{c.repeatMonthly ? ' · berulang bulanan' : ''}{c.recipients != null ? ` · ${c.recipients} penerima` : ''}</small></div>
        <span className={`tone-chip ${tone}`}>{label}</span>
        {canWrite && c.status === 'scheduled' && <button type="button" className="btn danger ac-sm" onClick={() => void cancel(c)}><X size={14} /> Batalkan kampanye</button>}
      </li> })}
    </ul>}
  </Section>
}
