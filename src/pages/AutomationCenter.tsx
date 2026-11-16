import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, FlaskConical, LoaderCircle, PauseCircle, Play, QrCode, ShieldCheck, Sparkles, CalendarRange } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Bone, ListSkeleton } from '../components/Skeleton.tsx'
import { useAuth } from '../state/Auth.tsx'
import { api } from '../lib/api.ts'
import type { AutomationOverview } from '../../shared/automation.ts'
import type { WhatsAppStatus } from '../../shared/whatsapp.ts'
import { ErrorLine, Section, ago, fmtDay, ruleHue, ruleIcon, todayWib } from './automation/common.tsx'
import { RulesSection } from './automation/Rules.tsx'
import { HolidaysSection } from './automation/Holidays.tsx'
import { CampaignsSection } from './automation/Campaigns.tsx'
import { OutboxSection } from './automation/Outbox.tsx'
import { SettingsSection } from './automation/Settings.tsx'
import './automation.css'

const connectionLabel: Record<WhatsAppStatus['status'], string> = { not_configured: 'Perlu konfigurasi', disconnected: 'Belum terhubung', connecting: 'Menghubungkan', qr: 'Pindai QR', connected: 'Terhubung', reconnecting: 'Menyambung ulang', logged_out: 'Sesi keluar', error: 'Perlu tindakan' }
const roleLabel = { leader: 'Berjalan', standby: 'Standby — instance lain memegang jadwal', stopped: 'Berhenti' } as const

export function AutomationCenter({ toast }: { toast: (m: string) => void }) {
  const { user } = useAuth()
  const role: string = user.role // 'hr' ada di kontrak server tetapi belum di tipe peran klien
  const isSuper = role === 'superadmin'
  const canRead = isSuper || role === 'hr' || role === 'admin'
  const canWrite = isSuper || role === 'hr'
  const [overview, setOverview] = useState<AutomationOverview>()
  const [loadError, setLoadError] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [selectedId, setSelectedId] = useState('birthday')
  const [previewDate, setPreviewDate] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState('')
  const [outboxKey, setOutboxKey] = useState(0)

  const load = useCallback(async () => {
    try { setOverview(await api<AutomationOverview>('/automation')); setLoadError('') }
    catch (e) { setLoadError((e as Error).message) }
  }, [])
  useEffect(() => {
    if (!canRead) return
    void load()
    const t = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(t)
  }, [canRead, load])
  useEffect(() => { const t = window.setInterval(() => setNowMs(Date.now()), 1000); return () => window.clearInterval(t) }, [])

  const runNow = async () => {
    setRunning(true); setRunError('')
    try { setOverview(await api<AutomationOverview>('/automation/run', { method: 'POST' })); setOutboxKey(k => k + 1); toast('Penjadwal dijalankan sekarang.') }
    catch (e) { setRunError((e as Error).message) }
    finally { setRunning(false) }
  }
  const openPreview = (ruleId: string, date: string) => {
    setSelectedId(ruleId); setPreviewDate(date)
    requestAnimationFrame(() => document.getElementById('ac-rules')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const applyOverview = (o: AutomationOverview) => { setOverview(o); setOutboxKey(k => k + 1) }

  const heading = <div className="page-heading"><div><h2>WhatsApp Automation Center</h2><p>Pantau kesehatan pengiriman, atur aturan otomatis, dan kelola kampanye HR.</p></div></div>
  if (!canRead) return <>{heading}<div className="card ac-notice"><ShieldCheck size={22} /><p>Halaman ini dikelola oleh HR dan Superadmin.</p></div></>

  return <div className="ac-page">
    {heading}
    {!overview ? (loadError
      ? <div className="card ac-notice"><ErrorLine message={loadError} /><button type="button" className="btn secondary" onClick={() => void load()}>Coba lagi</button></div>
      : <div className="ac-loading" role="status" aria-busy="true"><span className="sk-sr">Memuat automation…</span><Bone h={150} r={14} /><Bone h={220} r={14} /><ListSkeleton rows={5} cols={4} label="Memuat aturan…" /></div>)
      : <>
        {!canWrite && <p className="ac-readonly"><ShieldCheck size={16} /> Anda memiliki akses baca saja. Perubahan dilakukan HR atau Superadmin.</p>}
        <div className="ac-top">
          <Health overview={overview} nowMs={nowMs} canWrite={canWrite} running={running} runError={runError} loadError={loadError} onRun={() => void runNow()} />
          {isSuper && <WhatsAppCard toast={toast} />}
        </div>
        <Upcoming overview={overview} onOpen={openPreview} />
        <RulesSection overview={overview} canWrite={canWrite} selectedId={selectedId} onSelect={id => { setSelectedId(id); setPreviewDate('') }} onOverview={applyOverview} notify={toast} previewDate={previewDate} nowMs={nowMs} />
        <CampaignsSection overview={overview} canWrite={canWrite} selectedRuleId={selectedId} notify={toast} />
        <HolidaysSection overview={overview} canWrite={canWrite} onOverview={applyOverview} notify={toast} />
        <OutboxSection rules={overview.rules} canWrite={canWrite} notify={toast} refreshKey={outboxKey} />
        <SettingsSection overview={overview} canWrite={canWrite} onOverview={applyOverview} notify={toast} />
      </>}
  </div>
}

function Health({ overview, nowMs, canWrite, running, runError, loadError, onRun }: { overview: AutomationOverview; nowMs: number; canWrite: boolean; running: boolean; runError: string; loadError: string; onRun: () => void }) {
  const { scheduler: s, settings, counts, warnings } = overview
  const tickAge = s.lastTickAt ? (nowMs - new Date(s.lastTickAt).getTime()) / 1000 : Infinity
  const tickTone = s.role !== 'leader' ? 'tone-idle' : tickAge > 600 ? 'tone-danger' : tickAge > 180 ? 'tone-warn' : 'tone-ok'
  const roleTone = s.role === 'leader' ? 'tone-ok' : s.role === 'standby' ? 'tone-info' : 'tone-danger'
  const stale = s.role === 'leader' && tickAge > 180
  return <Section id="ac-health" title="Kesehatan automation" subtitle="Apakah pesan benar-benar akan terkirim hari ini" icon={<Sparkles />}
    aside={canWrite ? <button type="button" className="btn primary" disabled={running} onClick={onRun}>{running ? <LoaderCircle size={16} className="spin-icon" /> : <Play size={16} />} Jalankan sekarang</button> : undefined}>
    <div className="ac-modes">
      {settings.paused && <span className="ac-mode paused"><PauseCircle size={18} /><span><strong>Dijeda</strong><small>Tidak ada pesan yang dikirim</small></span></span>}
      {settings.testMode && <span className="ac-mode test"><FlaskConical size={18} /><span><strong>Mode uji</strong><small>Semua pesan dialihkan ke nomor uji</small></span></span>}
      {settings.dryRun && <span className="ac-mode dry"><CircleSlash size={18} /><span><strong>Simulasi</strong><small>Tidak ada pesan yang benar-benar dikirim</small></span></span>}
      {!settings.paused && !settings.testMode && !settings.dryRun && <span className="ac-mode live"><CheckCircle2 size={18} /><span><strong>Mode produksi</strong><small>Pesan dikirim ke pegawai sungguhan</small></span></span>}
    </div>
    {(warnings.length > 0 || stale || s.lastError || loadError) && <ul className="ac-warnings" role="alert">
      {loadError && <li>Gagal memperbarui data: {loadError}</li>}
      {stale && <li>Penjadwal tidak berdetak selama {ago(s.lastTickAt, nowMs).replace(' lalu', '')}. Periksa server.</li>}
      {s.lastError && <li>Kesalahan penjadwal terakhir: {s.lastError}</li>}
      {warnings.map((w, i) => <li key={i}>{w}</li>)}
    </ul>}
    <div className="ac-health-grid">
      <div className="ac-stat"><span>Penjadwal</span><span className={`tone-chip ${roleTone}`}>{roleLabel[s.role]}</span></div>
      <div className="ac-stat"><span>Detak terakhir</span><span className={`tone-chip ${tickTone}`}>{ago(s.lastTickAt, nowMs)}</span></div>
      <div className="ac-stat"><span>WhatsApp</span><span className={`tone-chip ${overview.whatsappReady ? 'tone-ok' : 'tone-danger'}`}>{overview.whatsappReady ? 'Siap' : 'Belum siap'}</span></div>
      <div className="ac-stat"><span>Pesan terkirim</span><b>{counts.sentToday}</b><small>hari ini</small></div>
      <div className="ac-stat"><span>Menunggu</span><b className={counts.pending ? 'amber' : ''}>{counts.pending}</b></div>
      <div className="ac-stat"><span>Gagal</span><b className={counts.failed ? 'red' : ''}>{counts.failed}</b></div>
      <div className="ac-stat"><span>Dilewati</span><b>{counts.skippedToday}</b><small>hari ini</small></div>
    </div>
    {s.waiting && <p className="ac-waiting"><AlertTriangle size={15} /> Pengiriman menunggu: {s.waiting}</p>}
    <ErrorLine message={runError} />
  </Section>
}

function Upcoming({ overview, onOpen }: { overview: AutomationOverview; onOpen: (ruleId: string, date: string) => void }) {
  const items = [...overview.upcoming].sort((a, b) => a.date.localeCompare(b.date))
  const today = overview.today || todayWib()
  const title = (id: string) => overview.rules.find(r => r.id === id)?.title ?? id
  return <Section id="ac-upcoming" title="Hari ini & 30 hari ke depan" subtitle="Klik baris untuk melihat pesan yang akan dikirim" icon={<CalendarRange />}>
    {items.length === 0 ? <p className="ac-note">Tidak ada pesan terjadwal dalam 30 hari ke depan.</p> : <ol className="ac-agenda">
      {items.map((u, i) => <li key={`${u.date}-${u.ruleId}-${i}`}>
        <button type="button" className={`ac-ag hue-${ruleHue(u.ruleId)} ${u.date === today ? 'today' : ''}`} onClick={() => onOpen(u.ruleId, u.date)}>
          <span className="ac-ag-icon">{ruleIcon(u.ruleId)}</span>
          <span className="ac-ag-date">{u.date === today && <em>Hari ini</em>}{fmtDay(u.date)}</span>
          <span className="ac-ag-label"><strong>{u.label}</strong><small>{title(u.ruleId)}</small></span>
          <span className="ac-ag-count"><b>{u.recipients}</b> penerima</span>
        </button>
      </li>)}
    </ol>}
  </Section>
}

function WhatsAppCard({ toast }: { toast: (m: string) => void }) {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ configured: false, status: 'not_configured', message: 'Memuat status koneksi…' })
  const [waBusy, setWaBusy] = useState(false)
  const [waError, setWaError] = useState('')
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try { const status = await api<WhatsAppStatus>('/whatsapp/status'); if (active) { setWaStatus(status); setWaError('') } }
      catch (error) { if (active) setWaError((error as Error).message) }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const call = async (path: '/whatsapp/connect' | '/whatsapp/disconnect', message: string) => {
    setWaBusy(true); setWaError('')
    try { setWaStatus(await api<WhatsAppStatus>(path, { method: 'POST' })); toast(message) }
    catch (error) { setWaError((error as Error).message) }
    finally { setWaBusy(false) }
  }
  const connect = () => call('/whatsapp/connect', 'Permintaan koneksi WhatsApp dimulai. Pindai QR saat muncul.')
  const disconnect = () => call('/whatsapp/disconnect', 'Sesi WhatsApp diputus dan kredensial lokal dihapus.')
  const connected = waStatus.status === 'connected'
  const loading = waStatus.message === 'Memuat status koneksi…' && !waError
  const connecting = waStatus.status === 'connecting' || waStatus.status === 'reconnecting'
  return <section className="card wa-connect ac-wa"><div className="card-head"><div><h3>Koneksi WhatsApp HR</h3><p>Login perangkat tertaut dengan QR WhatsApp Web.</p></div>
    <span className={`connection-chip ${connected ? 'online' : ''}`}><span></span>{connectionLabel[waStatus.status]}</span></div>
    {loading ? <div className="sk-stack" role="status" aria-busy="true" style={{ padding: '8px 0' }}><span className="sk-sr">Memuat status koneksi…</span><Bone w={56} h={56} r={14} /><Bone w="55%" h={16} /><Bone w="80%" h={11} /><Bone w={170} h={38} r={9} /></div>
      : connected ? <div className="connected-state"><div className="connected-icon"><CheckCircle2 /></div><h3>WhatsApp terhubung</h3><p>{waStatus.phoneNumber ? `Nomor +${waStatus.phoneNumber}` : 'Perangkat HR aktif'}</p>
        <div className="connection-meta"><div><span>Status</span><strong>Terhubung</strong></div><div><span>Sesi</span><strong>Tersimpan terenkripsi</strong></div><div><span>Terhubung sejak</span><strong>{waStatus.connectedAt ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(waStatus.connectedAt)) : 'Baru saja'}</strong></div></div>
        <button type="button" className="btn secondary" disabled={waBusy} onClick={disconnect}><ShieldCheck size={16} /> Putuskan perangkat</button></div>
      : waStatus.qr ? <div className="qr-area"><div className="qr-box"><QRCodeSVG value={waStatus.qr} size={190} level="M" fgColor="#072c52" bgColor="#ffffff" /></div><strong>Pindai dari WhatsApp</strong><p>Buka WhatsApp di ponsel admin → <b>Perangkat tertaut</b> → <b>Tautkan perangkat</b>. QR akan diperbarui otomatis bila kedaluwarsa.</p><button type="button" className="btn secondary" disabled={waBusy} onClick={disconnect}>Batalkan login</button></div>
      : <div className="qr-area"><div className="qr-box qr-placeholder"><QrCode size={88} /></div>
        <strong>{waStatus.status === 'connecting' ? 'Menghubungkan ke WhatsApp…' : waStatus.status === 'reconnecting' ? 'Mencoba menyambungkan kembali…' : waStatus.status === 'logged_out' ? 'Sesi WhatsApp sudah keluar' : waStatus.status === 'error' ? 'Koneksi perlu diatur ulang' : 'Tautkan perangkat WhatsApp HR'}</strong>
        <p>{waStatus.message ?? 'Klik tombol untuk meminta QR langsung dari sesi WhatsApp.'}</p>
        {waStatus.status === 'not_configured' ? <div className="wa-setup-note"><ShieldCheck size={18} /><p>Tambahkan <code>WHATSAPP_SESSION_ENCRYPTION_KEY</code> di Render, lalu restart service. Buat nilainya dengan <code>openssl rand -base64 32</code> dan simpan aman.</p></div>
          : <button type="button" className="btn primary" disabled={waBusy || connecting} onClick={connect}>{waBusy || connecting ? <LoaderCircle size={17} className="spin-icon" /> : <QrCode size={17} />} {waStatus.status === 'error' ? 'Coba login ulang' : 'Mulai tautkan WhatsApp'}</button>}
        {waStatus.status === 'error' && waStatus.configured && <button type="button" className="btn secondary wa-reset-button" disabled={waBusy} onClick={disconnect}>Hapus sesi tersimpan</button>}</div>}
    {waError && <p className="wa-inline-error" role="alert">{waError}</p>}
  </section>
}
