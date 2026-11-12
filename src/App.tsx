import { lazy, Suspense, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3, CheckCircle2, ChevronRight, ClipboardCheck, Fingerprint, LayoutDashboard, Lightbulb, Menu,
  MessageCircleMore, Plus, Trash2, UploadCloud, UsersRound, WalletCards, X, type LucideIcon,
} from 'lucide-react'
import { AuthProvider, useAuth } from './state/Auth.tsx'
import { HrDataProvider, useHr } from './state/HrData.tsx'
import { ROLE_LABEL } from '../shared/workspace.ts'
import { weeksInMonth } from './engine/dates.ts'
import { inspectSourceCoverage } from './engine/monthlyFlow.ts'
const AttendanceOverview = lazy(() => import('./pages/AttendanceOverview.tsx').then(m => ({ default: m.AttendanceOverview })))
const ReconcilePage = lazy(() => import('./pages/ReconcilePage.tsx').then(m => ({ default: m.ReconcilePage })))
const IdentityPage = lazy(() => import('./pages/IdentityPage.tsx').then(m => ({ default: m.IdentityPage })))
const MealPage = lazy(() => import('./pages/MealPage.tsx').then(m => ({ default: m.MealPage })))
const PeopleDashboard = lazy(() => import('./pages/PeopleDashboard.tsx').then(m => ({ default: m.PeopleDashboard })))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage.tsx').then(m => ({ default: m.EmployeesPage })))
const AddDataPage = lazy(() => import('./pages/AddDataPage.tsx').then(m => ({ default: m.AddDataPage })))
const AutomationCenter = lazy(() => import('./pages/AutomationCenter.tsx').then(m => ({ default: m.AutomationCenter })))
const WorkspaceSettings = lazy(() => import('./pages/WorkspaceSettings.tsx').then(m => ({ default: m.WorkspaceSettings })))
const FeatureMap = lazy(() => import('./pages/FeatureMap.tsx').then(m => ({ default: m.FeatureMap })))
const RekapSTPage = lazy(() => import('./pages/RekapSTPage.tsx').then(m => ({ default: m.RekapSTPage })))
const RekapSTOperator = lazy(() => import('./pages/RekapSTPage.tsx').then(m => ({ default: m.RekapSTOperator })))

export type Page = 'overview' | 'import' | 'reconcile' | 'identity' | 'meal' | 'dashboard' | 'employees' | 'add' | 'automation' | 'ideas' | 'settings' | 'rekap-st'
export type Nav = (page: Page, focus?: string) => void

const NAV: { group: string; items: { id: Page; label: string; icon: LucideIcon }[] }[] = [
  { group: 'Absensi & uang makan', items: [
    { id: 'overview', label: 'Setoran & Review', icon: BarChart3 },
    { id: 'rekap-st', label: 'Rekap ST', icon: ClipboardCheck },
    { id: 'reconcile', label: 'Rekonsiliasi', icon: ClipboardCheck },
    { id: 'identity', label: 'Pencocokan Identitas', icon: Fingerprint },
    { id: 'meal', label: 'Uang Makan', icon: WalletCards },
  ] },
  { group: 'Kepegawaian', items: [
    { id: 'dashboard', label: 'People Dashboard', icon: LayoutDashboard },
    { id: 'employees', label: 'Data Pegawai', icon: UsersRound },
    { id: 'add', label: 'Tambah Data', icon: Plus },
  ] },
  { group: 'Komunikasi & rencana', items: [
    { id: 'automation', label: 'Automation Center', icon: MessageCircleMore },
    { id: 'settings', label: 'Ruang Kerja & Akses', icon: UsersRound },
    { id: 'ideas', label: 'Peta Fitur & Data', icon: Lightbulb },
  ] },
]

function Shell() {
  const hr = useHr()
  const { user, logout } = useAuth()
  const demoMode = new URLSearchParams(window.location.search).get('demo') === '1'
  const [page, setPage] = useState<Page>('overview')
  const [focus, setFocus] = useState<string | undefined>()
  const [menu, setMenu] = useState(false)
  const [toast, setToast] = useState('')
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(''), 3200); return () => clearTimeout(t) }, [toast])
  const nav: Nav = (p, f) => {
    if (user.role !== 'superadmin' && p === 'add') return
    setPage(p === 'import' ? 'overview' : p); setFocus(f); setMenu(false); window.scrollTo({ top: 0 })
  }
  useEffect(() => {
    if (!demoMode) return
    const onDemoNavigate = (event: Event) => {
      const next = (event as CustomEvent<Page>).detail
      if (next) nav(next)
    }
    window.addEventListener('kppu-demo-navigate', onDemoNavigate)
    return () => window.removeEventListener('kppu-demo-navigate', onDemoNavigate)
  }, [demoMode])
  const openIssues = hr.recon.months.reduce((n, m) => n + m.days.filter(d => d.workday && d.reviewState === 'flag').length, 0)
  const identityOpen = hr.roster.identity.filter(i => i.status === 'ambiguous' || (i.status === 'unmatched' && i.context === 'surat-tugas')).length + hr.roster.conflicts.length
  const todayJkt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const incompleteWeeks = weeksInMonth(hr.activePeriod).filter(w => w.displayEnd < todayJkt && !inspectSourceCoverage(hr.files, w.displayStart, w.displayEnd).every(c => c.ready)).length
  const badge: Partial<Record<Page, number>> = { overview: incompleteWeeks, reconcile: openIssues, identity: identityOpen }
  const title = NAV.flatMap(g => g.items).find(i => i.id === page)?.label
  const show = (m: string) => setToast(m)

  return <div className="app-shell">
    <aside className={`sidebar ${menu ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-logo"><img src="/kppu-logo.png" alt="Lambang Komisi Pengawas Persaingan Usaha" /></div>
        <div><strong>KPPU HR</strong><span>Absensi · Uang Makan · Pegawai</span></div>
      </div>
      <nav id="primary-navigation" className="nav-groups">
        {NAV.map(g => <div key={g.group} className="nav-group">
          <span className="nav-group-label">{g.group}</span>
          {g.items.filter(item => user.role === 'superadmin' || item.id !== 'add').map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => nav(item.id)}>
            <item.icon size={17} /><span>{item.label}</span>
            {badge[item.id] ? <em className="nav-badge">{badge[item.id]! > 99 ? '99+' : badge[item.id]}</em> : page === item.id ? <ChevronRight size={15} className="nav-chevron" /> : null}
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-footer">
        <div className="status-dot-row"><span className="status-dot" /><div><strong>{hr.files.length} file sumber · {hr.roster.employees.length} pegawai</strong><small>{demoMode ? `Demo lokal di browser · revisi ${hr.revision}` : hr.saveStatus === 'saved' ? `Tersimpan di server · revisi ${hr.revision}` : hr.saveStatus === 'saving' ? 'Menyimpan perubahan…' : 'Periksa status penyimpanan'}</small></div></div>
        <button className="reset-btn" onClick={hr.backup}>Unduh backup ruang kerja</button>
        {!demoMode && <button className="reset-btn" onClick={() => { if (hr.saveStatus === 'saving' || hr.saveError) { if (!confirm('Perubahan belum tersimpan. Unduh backup pekerjaan lalu keluar dari akun?')) return; hr.backup() }; void logout().catch(e => show(e.message)) }}>Keluar · {user.name}</button>}
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <button className="mobile-menu" aria-label={menu ? 'Tutup menu' : 'Buka menu'} aria-expanded={menu} aria-controls="primary-navigation" onClick={() => setMenu(v => !v)}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
        <div><p>Sistem Absensi Terintegrasi KPPU</p><h1>{title}</h1></div>
        <div className="top-actions">
          {hr.ready && <label className="period-pick"><span>Periode KPPU</span>
            <input type="month" value={hr.activePeriod} onChange={e => { if (e.target.value) hr.setPeriod(e.target.value) }} aria-label="Pilih bulan penghitungan uang makan" />
          </label>}
          <label className="reviewer-pick" title="Aktor keputusan mengikuti akun yang masuk"><span>Peran akun</span><span>{user.name} · {ROLE_LABEL[user.role]}</span></label>
        </div>
      </header>
      <div className="content-wrap">
        {hr.saveError && <div className="sync-error" role="alert"><strong>Perubahan belum tersimpan</strong><p>{hr.saveError}</p><button className="btn secondary" onClick={hr.backup}>Backup pekerjaan</button> <button className="btn secondary" onClick={hr.retrySave}>Coba simpan</button> <button className="btn secondary" onClick={() => { if (confirm('Muat data server dan lepaskan perubahan lokal yang belum tersimpan? Unduh backup terlebih dahulu.')) void hr.reload() }}>Muat data server</button></div>}
        {!hr.ready ? <div className="loading-state">Memuat data tersimpan…</div> :
          <AnimatePresence mode="wait">
            <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .2 }}>
              <Suspense fallback={<div className="loading-state" role="status">Memuat halaman…</div>}>
              {page === 'overview' && <AttendanceOverview nav={nav} toast={show} />}
              {page === 'reconcile' && <ReconcilePage nav={nav} toast={show} focus={focus} />}
              {page === 'identity' && <IdentityPage nav={nav} toast={show} />}
              {page === 'meal' && <MealPage nav={nav} toast={show} />}
              {page === 'dashboard' && <PeopleDashboard nav={nav} />}
              {page === 'employees' && <EmployeesPage nav={nav} toast={show} focus={focus} />}
              {page === 'add' && <AddDataPage toast={show} />}
              {page === 'automation' && <AutomationCenter toast={show} />}
              {page === 'rekap-st' && <RekapSTPage key={focus} toast={show} office={focus} />}
              {page === 'settings' && <WorkspaceSettings />}
              {page === 'ideas' && <FeatureMap nav={nav} />}
              </Suspense>
            </motion.div>
          </AnimatePresence>}
      </div>
    </main>
    <AnimatePresence>{toast && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}><CheckCircle2 size={18} />{toast}</motion.div>}</AnimatePresence>
    {menu && <div className="sidebar-overlay" onClick={() => setMenu(false)} />}
  </div>
}

function AuthenticatedApp() {
  const { user } = useAuth()
  if (user.role === 'operator_st') return <RekapSTOperator />
  return <HrDataProvider><Shell /></HrDataProvider>
}

export default function App() {
  return <AuthProvider><AuthenticatedApp /></AuthProvider>
}
