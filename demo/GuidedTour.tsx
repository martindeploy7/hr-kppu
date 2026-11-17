import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, BookOpenCheck, CheckCircle2, RotateCcw, Sparkles, X } from 'lucide-react'
import type { Page } from '../src/App.tsx'
import { demoActions } from './mockApi.ts'

const TOUR_KEY = 'kppu-hr-demo-tour-step-v2'
const DONE_KEY = 'kppu-hr-demo-tour-done-v2'

type TourStep = {
  page: Page
  chapter: string
  title: string
  body: string
  target?: string
  actionLabel?: string
  action?: () => Promise<string | number | void>
}

function startPage(page: Page) {
  window.dispatchEvent(new CustomEvent<Page>('kppu-demo-navigate', { detail: page }))
}

function savedStep() {
  const value = Number(sessionStorage.getItem(TOUR_KEY) ?? 0)
  return Number.isInteger(value) && value >= 0 && value < 18 ? value : 0
}

function savedDone(): Record<number, string> {
  try { return JSON.parse(sessionStorage.getItem(DONE_KEY) ?? '{}') as Record<number, string> }
  catch { return {} }
}

export function GuidedTour() {
  const [stepIndex, setStepIndex] = useState(savedStep)
  const [done, setDone] = useState(savedDone)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const progress = Math.round(((stepIndex + 1) / 18) * 100)

  const steps = useMemo<TourStep[]>(() => [
    { page: 'import', chapter: 'Mulai', title: 'Satu bulan kerja, satu alur yang jelas', body: 'Kita akan memilih periode, melengkapi Mesin Offline, Mesin Online, dan Surat Tugas per kantor, lalu menetapkan hari yang aman sebelum melihat uang makan. Master berisi 8 pegawai sintetis. Semua perubahan hanya tersimpan di browser ini.' },
    { page: 'import', chapter: '01 · Periode', title: 'Pilih bulan yang akan dikelola', body: 'Semua sumber, status hari, dan hasil uang makan mengikuti periode yang sama. Skenario demo ini memakai September 2026 dengan 22 hari kerja.', target: '.period-pick input', actionLabel: 'Pilih September 2026', action: async () => { await demoActions.setPeriod('2026-09'); return 'Periode demo ditetapkan ke September 2026.' } },
    { page: 'import', chapter: '02 · Sumber', title: 'Tambahkan Mesin Offline', body: 'Bukti mesin kantor adalah satu sumber yang setara dengan sumber lain. Demo menambahkan berkas contoh untuk Pusat dan Kanwil I–VII.', target: '.package-checks', actionLabel: 'Simulasikan unggah Mesin Offline · 8 kantor', action: async () => { await demoActions.addSources('offline'); return '8 file Mesin Offline contoh ditambahkan.' } },
    { page: 'import', chapter: '02 · Sumber', title: 'Tambahkan Mesin Online', body: 'Data aplikasi HP masuk sebagai Mesin Online. Ada satu presensi WFA yang tetap dihitung sebagai hadir sesuai aturan demo.', target: '.package-checks', actionLabel: 'Simulasikan unggah Mesin Online', action: async () => { await demoActions.addSources('online'); return 'Mesin Online contoh ditambahkan.' } },
    { page: 'import', chapter: '02 · Sumber', title: 'Lengkapi Surat Tugas tiap kantor', body: 'Register ST dicatat per kantor. Skenario menambahkan satu register contoh untuk Pusat dan setiap Kanwil; tugas luar tidak dihitung sebagai uang makan.', target: '.package-checks', actionLabel: 'Simulasikan unggah ST · seluruh kantor', action: async () => { await demoActions.addSources('st'); return '8 register ST contoh ditambahkan.' } },
    { page: 'import', chapter: '03 · Cakupan', title: 'Pastikan paket bulan ini lengkap', body: 'Cek status Mesin Offline, Mesin Online, dan ST Pusat serta Kanwil I–VII. Paket membuka rekonsiliasi setelah semua sumber diwajibkan tersedia.', target: '.coverage', },
    { page: 'identity', chapter: '04 · Identitas', title: 'Satukan catatan ke pegawai yang tepat', body: 'NIP, NIKA/ID aplikasi, nomor mesin, lalu nama dipakai untuk membentuk roster. Data ST tetap terhubung ke pegawai melalui identitasnya. Sampel ini memakai identitas yang cocok otomatis.', target: '.ladder' },
    { page: 'reconcile', chapter: '05 · Rekonsiliasi', title: 'Sahkan hari dengan bukti konsisten', body: 'Ketiga sumber punya kedudukan setara. Tombol ini mensimulasikan keputusan admin untuk hari tanpa isu. Hari terlambat bisa sah sebagai hadir, tetapi UM tetap gugur. Hari dengan bukti tidak lengkap atau bertentangan menunggu pemeriksaan.', target: '.page-head', actionLabel: 'Tetapkan hari dengan bukti konsisten', action: async () => { const count = await demoActions.reviewSafeDays(); return `${count} hari dengan bukti konsisten ditetapkan.` } },
    { page: 'reconcile', chapter: '05 · Rekonsiliasi', title: 'Pilih bukti untuk satu flag', body: 'Demo memuat seluruh 15 jenis isu pada 14 hari contoh. Buka Detail isu untuk melihat jenisnya, atau klik tanggal pada matriks. Contoh: Nadia 3 Sep telat, Bagas 4 Sep tanpa check-out, Citra 7 Sep tanpa check-in. Tombol ini hanya menyelesaikan konflik jam Aditya 2 Sep; kasus lain tetap bisa diperiksa.', target: '.page-head', actionLabel: 'Pilih Offline untuk Aditya · 2 Sep', action: async () => { const selected = await demoActions.reviewFlag(); return selected ? `Pilihan disimpan: ${selected}.` : 'Konflik Aditya 2 Sep sudah diputuskan.' } },
    { page: 'meal', chapter: '06 · Uang makan', title: 'Hasil tampil secara progresif', body: 'Pegawai yang hari-harinya sudah aman langsung masuk ke daftar. Hari yang masih berflag atau belum ditemukan tetap terlihat dan ditahan. Tarif mengikuti golongan; WFA masuk sebagai hadir; perjalanan dinas tidak masuk UM. PPh/netto tetap belum disahkan pada skenario.', target: '.kpi-row' },
    { page: 'overview', chapter: '07 · Ringkasan', title: 'Ringkasan kehadiran seluruh KPPU', body: 'Pantau jumlah pegawai, hari kerja, cakupan sumber, hari yang perlu perhatian, dan progres pengolahan bulan terpilih.', target: '.page-head' },
    { page: 'dashboard', chapter: '08 · Kepegawaian', title: 'People Dashboard', body: 'Lihat komposisi pegawai sintetis menurut kantor, status, jabatan, dan atribut kepegawaian yang tersedia.', target: '.page-head' },
    { page: 'employees', chapter: '08 · Kepegawaian', title: 'Telusuri Data Pegawai', body: 'Cari dan periksa master pegawai, identitas, unit, jabatan, golongan, status, serta data kontak contoh.', target: '.page-head' },
    { page: 'add', chapter: '08 · Kepegawaian', title: 'Tambah atau perbarui data', body: 'Form tambah pegawai dan impor master tersedia untuk memperbarui workspace. Simpanan dalam demo hanya mengubah data lokal sintetis.', target: '.page-head' },
    { page: 'automation', chapter: '09 · Komunikasi', title: 'Automation Center', body: 'Lihat aturan komunikasi, contoh pesan, kesiapan nomor WhatsApp, dan status koneksi. Pengiriman WhatsApp tidak aktif di demo.', target: '.page-head' },
    { page: 'settings', chapter: '10 · Administrasi', title: 'Ruang Kerja & Akses', body: 'Jelajahi backup dan pemulihan, akun contoh, kebijakan, dan riwayat perubahan. Tidak ada akun atau data live yang diubah.', target: '.page-head' },
    { page: 'settings', chapter: 'Selesai', title: 'Demo siap dijelajahi', body: 'Tur selesai. Gunakan navigasi kiri untuk menjelajahi halaman, buka kembali panduan kapan saja, atau reset untuk mengulang skenario dari data sintetis awal.' },
  ], [])
  const step = steps[stepIndex]
  const completed = !!done[stepIndex]

  useEffect(() => {
    sessionStorage.setItem(TOUR_KEY, String(stepIndex))
    startPage(step.page)
    let element: Element | null = null
    const timer = window.setTimeout(() => {
      if (!step.target) return
      element = document.querySelector(step.target)
      element?.classList.add('demo-tour-target')
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 420)
    return () => {
      window.clearTimeout(timer)
      element?.classList.remove('demo-tour-target')
    }
  }, [stepIndex, step.page, step.target])

  const go = (index: number) => {
    const next = Math.max(0, Math.min(steps.length - 1, index))
    setResult('')
    setStepIndex(next)
  }

  const runAction = async () => {
    if (!step.action) return
    setBusy(true)
    setResult('')
    try {
      const output = await step.action()
      const message = typeof output === 'string' ? output : typeof output === 'number' ? `${output} hari contoh ditetapkan.` : 'Langkah contoh selesai.'
      const updated = { ...done, [stepIndex]: message }
      setDone(updated)
      sessionStorage.setItem(DONE_KEY, JSON.stringify(updated))
      setResult(message)
    } catch (error) {
      setResult((error as Error).message || 'Langkah demo belum dapat dijalankan. Coba ulangi.')
    } finally { setBusy(false) }
  }

  const restart = async () => {
    setBusy(true)
    try {
      await demoActions.reset()
      setDone({})
      sessionStorage.removeItem(DONE_KEY)
      sessionStorage.setItem(TOUR_KEY, '0')
      setResult('Data contoh direset. Tur dimulai kembali.')
      setStepIndex(0)
    } finally { setBusy(false) }
  }

  return <>
    <AnimatePresence>
      {open ? <motion.aside className="demo-tour-card" aria-label="Panduan demo interaktif" aria-live="polite" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: .98 }} transition={{ duration: .22 }}>
        <div className="demo-tour-top">
          <div className="demo-tour-brand"><span><BookOpenCheck size={16} /></span><div><strong>Panduan interaktif</strong><small>Demo lokal · data sintetis</small></div></div>
          <button type="button" className="demo-tour-close" aria-label="Tutup panduan" onClick={() => setOpen(false)}><X size={17} /></button>
        </div>
        <div className="demo-tour-progress" aria-label={`Langkah ${stepIndex + 1} dari ${steps.length}`}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
        <div className="demo-tour-step"><span>{stepIndex + 1}/{steps.length}</span><b>{step.chapter}</b><span className="demo-tour-spacer" /><Sparkles size={14} /></div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {result && <div className="demo-tour-result"><CheckCircle2 size={15} /><span>{result}</span></div>}
        <div className="demo-tour-actions">
          <button type="button" className="demo-tour-back" onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0 || busy} aria-label="Langkah sebelumnya"><ArrowLeft size={16} /></button>
          {step.action && !completed ? <button type="button" className="demo-tour-run" onClick={() => void runAction()} disabled={busy}>{busy ? 'Menjalankan contoh…' : <>{step.actionLabel}<ArrowRight size={15} /></>}</button>
            : <button type="button" className="demo-tour-run" onClick={() => stepIndex === steps.length - 1 ? setOpen(false) : go(stepIndex + 1)} disabled={busy}>{stepIndex === steps.length - 1 ? 'Tutup tur' : stepIndex === 0 ? 'Mulai tur' : 'Lanjut'}<ArrowRight size={15} /></button>}
        </div>
        <div className="demo-tour-foot"><span>Data hanya tersimpan di browser ini</span><button type="button" onClick={() => void restart()} disabled={busy}><RotateCcw size={12} /> Reset demo</button></div>
      </motion.aside> : <motion.button type="button" className="demo-tour-launcher" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onClick={() => setOpen(true)}><BookOpenCheck size={17} /> Buka panduan demo <span>{stepIndex + 1}/{steps.length}</span></motion.button>}
    </AnimatePresence>
  </>
}
