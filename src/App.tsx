import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  BarChart3, CheckCircle2, ChevronRight, ClipboardCheck, Fingerprint, LayoutDashboard, Menu,
  MessageCircleMore, Plus, Trash2, UploadCloud, UsersRound, WalletCards, X, type LucideIcon,
} from 'lucide-react'
import { AuthProvider, useAuth } from './state/Auth.tsx'
import { HrDataProvider, useHr } from './state/HrData.tsx'
import { ROLE_LABEL } from '../shared/workspace.ts'
import { PageSkeleton, type SkeletonVariant } from './components/Skeleton.tsx'
import { DialogProvider, useDialog } from './components/Dialog.tsx'
import { weeksInMonth } from './engine/dates.ts'
import { inspectSourceCoverage } from './engine/monthlyFlow.ts'
import { recoverFromChunkError } from './lib/chunkReload.ts'
// Satu sumber untuk lazy() dan pemanasan chunk: import() yang sama dipakai bersama, jadi hover/fokus di menu cukup memanggil loader.
const LOAD = {
  overview: () => import('./pages/AttendanceOverview.tsx'),
  reconcile: () => import('./pages/ReconcilePage.tsx'),
  identity: () => import('./pages/IdentityPage.tsx'),
  meal: () => import('./pages/MealPage.tsx'),
  dashboard: () => import('./pages/PeopleDashboard.tsx'),
  employees: () => import('./pages/EmployeesPage.tsx'),
  add: () => import('./pages/AddDataPage.tsx'),
  automation: () => import('./pages/AutomationCenter.tsx'),
  settings: () => import('./pages/WorkspaceSettings.tsx'),
  'rekap-st': () => import('./pages/RekapSTPage.tsx'),
}
const AttendanceOverview = lazy(() => LOAD.overview().catch(recoverFromChunkError).then(m => ({ default: m.AttendanceOverview })))
const ReconcilePage = lazy(() => LOAD.reconcile().catch(recoverFromChunkError).then(m => ({ default: m.ReconcilePage })))
const IdentityPage = lazy(() => LOAD.identity().catch(recoverFromChunkError).then(m => ({ default: m.IdentityPage })))
const MealPage = lazy(() => LOAD.meal().catch(recoverFromChunkError).then(m => ({ default: m.MealPage })))
const PeopleDashboard = lazy(() => LOAD.dashboard().catch(recoverFromChunkError).then(m => ({ default: m.PeopleDashboard })))
const EmployeesPage = lazy(() => LOAD.employees().catch(recoverFromChunkError).then(m => ({ default: m.EmployeesPage })))
const AddDataPage = lazy(() => LOAD.add().catch(recoverFromChunkError).then(m => ({ default: m.AddDataPage })))
const AutomationCenter = lazy(() => LOAD.automation().catch(recoverFromChunkError).then(m => ({ default: m.AutomationCenter })))
const WorkspaceSettings = lazy(() => LOAD.settings().catch(recoverFromChunkError).then(m => ({ default: m.WorkspaceSettings })))
const RekapSTPage = lazy(() => LOAD['rekap-st']().catch(recoverFromChunkError).then(m => ({ default: m.RekapSTPage })))
const RekapSTOperator = lazy(() => LOAD['rekap-st']().catch(recoverFromChunkError).then(m => ({ default: m.RekapSTOperator })))
/** Hangatkan chunk halaman sebelum diklik (hover, fokus, atau awal sentuhan); galat diabaikan karena klik akan mencoba lagi. */
const warm = (page: Page) => { const load = (LOAD as Partial<Record<Page, () => Promise<unknown>>>)[page]; if (load) void load().catch(() => {}) }

export type Page = 'overview' | 'import' | 'reconcile' | 'identity' | 'meal' | 'dashboard' | 'employees' | 'add' | 'automation' | 'settings' | 'rekap-st'
/** Bentuk skeleton per halaman agar loading menyerupai tata letak tujuan (tanpa lompatan layout). */
const SKELETON: Record<Page, SkeletonVariant> = { overview: 'board', reconcile: 'cards', meal: 'meal', identity: 'identity', dashboard: 'dashboard', employees: 'employees', 'rekap-st': 'rekap', settings: 'settings', add: 'form', automation: 'automation', import: 'board' }

// Pratinjau skeleton khusus mode pengembangan: ?skeleton=board|cards|meal|identity|table|dashboard|form|grid|automation|features|employees|rekap|settings
const skeletonPreview = import.meta.env.DEV ? (new URLSearchParams(window.location.search).get('skeleton') as SkeletonVariant | null) : null

// Sama dengan --ease-out di theme.css (framer-motion butuh nilai JS).
const EASE_OUT = [0.23, 1, 0.32, 1] as const

export type Nav = (page: Page, focus?: string) => void
/** Toast satu baris; `undo` menambah tombol Urungkan untuk tindakan yang bisa dibatalkan. */
export type Toast = (message: string, undo?: () => void) => void

/** Rute hash: muat ulang mempertahankan halaman, tombol kembali/maju bekerja. 'import' adalah alias lama 'overview'. */
const ROUTES: Record<Page, string> = { overview: 'setoran', import: 'setoran', 'rekap-st': 'rekap-st', reconcile: 'rekonsiliasi', identity: 'pencocokan', meal: 'uang-makan', dashboard: 'dashboard', employees: 'pegawai', add: 'tambah-data', automation: 'automation', settings: 'akses' }
const pageFromHash = (): Page | null => {
  const slug = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return (Object.keys(ROUTES) as Page[]).find(page => page !== 'import' && ROUTES[page] === slug) ?? null
}

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
  { group: 'Komunikasi & akses', items: [
    { id: 'automation', label: 'Automation Center', icon: MessageCircleMore },
    { id: 'settings', label: 'Ruang Kerja & Akses', icon: UsersRound },
  ] },
]

function Shell() {
  const hr = useHr()
  const { user, logout } = useAuth()
  const demoMode = new URLSearchParams(window.location.search).get('demo') === '1'
  const dialog = useDialog()
  const allowed = (p: Page | null): Page => !p || (p === 'add' && user.role !== 'superadmin') ? 'overview' : p
  const [page, setPage] = useState<Page>(() => allowed(pageFromHash()))
  const pageRef = useRef(page)
  const [focus, setFocus] = useState<string | undefined>()
  const [menu, setMenu] = useState(false)
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const menuWasOpen = useRef(false)
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), toast.undo ? 8000 : 3200); return () => clearTimeout(t) }, [toast])
  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', `#/${ROUTES[pageRef.current]}`)
    const onHash = () => {
      const next = allowed(pageFromHash())
      if (next === pageRef.current) return
      pageRef.current = next; setPage(next); setFocus(undefined); setMenu(false); window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role])
  // Menu seluler: Escape menutup; fokus masuk ke menu saat dibuka dan kembali ke tombol menu saat tertutup.
  useEffect(() => {
    if (menu) {
      menuWasOpen.current = true
      document.querySelector<HTMLElement>('#primary-navigation button.active, #primary-navigation button')?.focus({ preventScroll: true })
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
    if (menuWasOpen.current) { menuWasOpen.current = false; menuButton.current?.focus({ preventScroll: true }) }
  }, [menu])
  const nav: Nav = (p, f) => {
    if (user.role !== 'superadmin' && p === 'add') return
    const next: Page = p === 'import' ? 'overview' : p
    pageRef.current = next; setPage(next); setFocus(f); setMenu(false); window.scrollTo({ top: 0 })
    if (window.location.hash !== `#/${ROUTES[next]}`) window.location.hash = `/${ROUTES[next]}`
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
  const show: Toast = (message, undo) => setToast({ message, undo })

  return <div className="app-shell">
    <aside className={`sidebar ${menu ? 'open' : ''}`}>
      <div className="brand">
        <div className="brand-logo"><img src="/kppu-logo.png" alt="Lambang Komisi Pengawas Persaingan Usaha" /></div>
        <div><strong>KPPU HR</strong><span>Absensi · Uang Makan · Pegawai</span></div>
      </div>
      <nav id="primary-navigation" className="nav-groups">
        {NAV.map(g => <div key={g.group} className="nav-group">
          <span className="nav-group-label">{g.group}</span>
          {g.items.filter(item => user.role === 'superadmin' || item.id !== 'add').map(item => <button key={item.id} type="button" className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => nav(item.id)} onPointerEnter={() => warm(item.id)} onPointerDown={() => warm(item.id)} onFocus={() => warm(item.id)}>
            <item.icon size={17} /><span>{item.label}</span>
            {badge[item.id] ? <em className="nav-badge">{badge[item.id]! > 99 ? '99+' : badge[item.id]}</em> : page === item.id ? <ChevronRight size={15} className="nav-chevron" /> : null}
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-footer">
        <div className="status-dot-row"><span className="status-dot" /><div><strong>{hr.files.length} file sumber · {hr.roster.employees.length} pegawai</strong><small>{demoMode ? `Demo lokal di browser · revisi ${hr.revision}` : hr.saveStatus === 'saved' ? `Tersimpan di server · revisi ${hr.revision}` : hr.saveStatus === 'saving' ? 'Menyimpan perubahan…' : 'Periksa status penyimpanan'}</small></div></div>
        <button className="reset-btn" onClick={hr.backup}>Unduh backup ruang kerja</button>
        {!demoMode && <button className="reset-btn" onClick={async () => { if (hr.saveStatus === 'saving' || hr.saveError) { if (!await dialog.confirm({ title: 'Keluar dengan perubahan belum tersimpan?', message: 'Backup pekerjaan akan diunduh lebih dulu, lalu Anda keluar dari akun.', confirmLabel: 'Unduh backup dan keluar' })) return; hr.backup() }; void logout().catch(e => show(e.message)) }}>Keluar · {user.name}</button>}
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <button ref={menuButton} type="button" className="mobile-menu" aria-label={menu ? 'Tutup menu' : 'Buka menu'} aria-expanded={menu} aria-controls="primary-navigation" onClick={() => setMenu(v => !v)}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
        <div><p>Sistem Absensi Terintegrasi KPPU</p><h1>{title}</h1></div>
        <div className="top-actions">
          {hr.ready && <label className="period-pick"><span>Periode KPPU</span>
            <input type="month" lang="id" value={hr.activePeriod} onChange={e => { if (e.target.value) hr.setPeriod(e.target.value) }} aria-label="Pilih bulan penghitungan uang makan" />
          </label>}
          <label className="reviewer-pick" title="Aktor keputusan mengikuti akun yang masuk"><span>Peran akun</span><span>{user.name} · {ROLE_LABEL[user.role]}</span></label>
        </div>
      </header>
      <div className="content-wrap">
        {hr.saveError && <div className="sync-error" role="alert"><strong>Perubahan belum tersimpan</strong><p>{hr.saveError}</p><button className="btn secondary" onClick={hr.backup}>Backup pekerjaan</button> <button className="btn secondary" onClick={hr.retrySave}>Coba simpan</button> <button className="btn secondary" onClick={async () => { if (await dialog.confirm({ title: 'Muat data server?', message: 'Perubahan lokal yang belum tersimpan akan dilepas. Unduh backup pekerjaan lebih dulu bila perlu.', confirmLabel: 'Muat data server', tone: 'danger' })) void hr.reload() }}>Muat data server</button></div>}
        {skeletonPreview ? <PageSkeleton variant={skeletonPreview} /> : !hr.ready ? <PageSkeleton variant={SKELETON[page]} label="Memuat data tersimpan…" /> :
          // Pindah halaman = tindakan sering: tanpa animasi keluar, skeleton tampil seketika (key per halaman), isi baru hanya memudar masuk ≤150ms.
          <Suspense key={page} fallback={<PageSkeleton variant={SKELETON[page]} />}>
            <div className="page-swap">
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
            </div>
          </Suspense>}
      </div>
    </main>
    <div role="status" aria-live="polite" aria-atomic="true">
      <AnimatePresence>{toast && <motion.div key={toast.message} className="toast" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: .22, ease: EASE_OUT } }} exit={{ opacity: 0, y: 4, transition: { duration: .14, ease: EASE_OUT } }}><CheckCircle2 size={18} aria-hidden="true" /><span>{toast.message}</span>{toast.undo && <button type="button" className="toast-undo" onClick={() => { toast.undo?.(); setToast(null) }}>Urungkan</button>}</motion.div>}</AnimatePresence>
    </div>
    {menu && <div className="sidebar-overlay" onClick={() => setMenu(false)} />}
  </div>
}

function AuthenticatedApp() {
  const { user } = useAuth()
  if (user.role === 'operator_st') return <RekapSTOperator />
  return <HrDataProvider><Shell /></HrDataProvider>
}

export default function App() {
  return <MotionConfig reducedMotion="user"><DialogProvider><AuthProvider><AuthenticatedApp /></AuthProvider></DialogProvider></MotionConfig>
}
