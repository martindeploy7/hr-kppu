import { useCallback, useEffect, useState } from 'react'
import { Inbox, RotateCcw, X } from 'lucide-react'
import { ListSkeleton } from '../../components/Skeleton.tsx'
import { api } from '../../lib/api.ts'
import type { AutomationRule, OutboxItem, OutboxStatus } from '../../../shared/automation.ts'
import { ErrorLine, Notify, Section, fmtDateTime, maskPhone, statusMeta } from './common.tsx'

const statuses: ('' | OutboxStatus)[] = ['', 'pending', 'sending', 'sent', 'failed', 'skipped', 'expired', 'cancelled']

export function OutboxSection({ rules, canWrite, notify, refreshKey }: { rules: AutomationRule[]; canWrite: boolean; notify: Notify; refreshKey: number }) {
  const [status, setStatus] = useState<'' | OutboxStatus>('')
  const [ruleId, setRuleId] = useState('')
  const [items, setItems] = useState<OutboxItem[]>()
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const ruleTitle = (id: string) => rules.find(r => r.id === id)?.title ?? id

  const load = useCallback(async () => {
    try { setItems((await api<{ items: OutboxItem[] }>(`/automation/outbox?status=${status}&ruleId=${ruleId}&limit=100`)).items); setError('') }
    catch (e) { setError((e as Error).message) }
  }, [status, ruleId])
  useEffect(() => {
    setItems(undefined); void load()
    const t = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(t)
  }, [load, refreshKey])

  const act = async (item: OutboxItem, kind: 'retry' | 'cancel') => {
    setBusyId(item.id); setError('')
    try { await api<{ item: OutboxItem }>(`/automation/outbox/${item.id}/${kind}`, { method: 'POST' }); notify(kind === 'retry' ? 'Pesan diantrikan ulang.' : 'Pesan dibatalkan.'); await load() }
    catch (e) { setError((e as Error).message) }
    finally { setBusyId('') }
  }

  return <Section id="ac-outbox" title="Riwayat & antrean" subtitle="Setiap pesan yang direncanakan, dikirim, atau gagal" icon={<Inbox />}>
    <div className="ac-filters">
      <div className="ac-chips" role="group" aria-label="Filter status">
        {statuses.map(s => <button type="button" key={s || 'all'} className={`ac-month ${status === s ? 'on' : ''}`} aria-pressed={status === s} onClick={() => setStatus(s)}>{s ? statusMeta[s].label : 'Semua'}</button>)}
      </div>
      <label className="ac-inline">Aturan <select value={ruleId} onChange={e => setRuleId(e.target.value)}><option value="">Semua aturan</option>{rules.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
    </div>
    <ErrorLine message={error} />
    {!items ? <ListSkeleton rows={5} cols={6} label="Memuat antrean…" /> : items.length === 0 ? <p className="ac-note">Tidak ada pesan untuk filter ini.</p> : <div className="ac-table-wrap"><table className="ac-table">
      <thead><tr><th>Waktu</th><th>Aturan</th><th>Penerima</th><th>Dikirim ke</th><th>Status</th><th>Coba</th><th>Aksi</th></tr></thead>
      <tbody>{items.map(i => <tr key={i.id}>
        <td data-l="Waktu">{fmtDateTime(i.sentAt ?? i.scheduledFor)}</td>
        <td data-l="Aturan">{ruleTitle(i.ruleId)}</td>
        <td data-l="Penerima"><strong>{i.recipientName}</strong><small>{maskPhone(i.phone)}</small></td>
        <td data-l="Dikirim ke">{maskPhone(i.deliverTo)} {i.test && <span className="tone-chip tone-warn">UJI</span>}</td>
        <td data-l="Status"><span className={`tone-chip ${statusMeta[i.status].tone}`}>{statusMeta[i.status].label}</span>{i.lastError && <small className="ac-err-text">{i.lastError}</small>}</td>
        <td data-l="Coba">{i.attempts}</td>
        <td data-l="Aksi">{canWrite && <span className="ac-row-actions">
          {(i.status === 'failed' || i.status === 'expired' || i.status === 'cancelled') && <button type="button" className="btn secondary ac-sm" disabled={busyId === i.id} onClick={() => void act(i, 'retry')}><RotateCcw size={14} /> Coba lagi</button>}
          {i.status === 'pending' && <button type="button" className="btn secondary ac-sm" disabled={busyId === i.id} onClick={() => void act(i, 'cancel')}><X size={14} /> Batalkan</button>}
        </span>}</td>
      </tr>)}</tbody></table></div>}
  </Section>
}
