import { useEffect, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, BookOpenCheck, BriefcaseBusiness, Cake, CalendarDays, Clock3, Database, FileSpreadsheet, HeartHandshake, LoaderCircle, MessageCircleMore, QrCode, Settings2, ShieldCheck, UsersRound } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { AutomationRule, Employee } from '../types.ts'
import { useHr } from '../state/HrData.tsx'
import { useAuth } from '../state/Auth.tsx'
import { api } from '../lib/api.ts'
import { nextBirthdayDays, tenureYears } from '../lib/format.ts'
import type { WhatsAppStatus } from '../../shared/whatsapp.ts'

const initialAutomations: AutomationRule[] = [
  { id: 'forgotout', title: 'Pengingat lupa scan pulang', description: 'Dikirim sore hari ke pegawai yang punya jam masuk tetapi belum ada jam pulang — penyebab utama hari "bukti tidak lengkap".', trigger: 'Hari kerja • 16:45 WIB', audience: 'Pegawai dengan scan masuk tanpa scan pulang', enabled: true, category: 'Absensi', scope: 'personal', privacy: 'standard' },
  { id: 'rejected', title: 'Presensi daring ditolak', description: 'Memberi tahu pegawai bahwa presensi aplikasinya berstatus Reject agar segera dikoreksi sebelum rekap bulanan.', trigger: 'Saat status Reject terdeteksi', audience: 'Pegawai pemilik presensi', enabled: false, category: 'Absensi', scope: 'personal', privacy: 'standard' },
  { id: 'birthday', title: 'Ucapan ulang tahun personal', description: 'Pesan otomatis berisi ucapan, doa, harapan, dan semangat kerja yang dipersonalisasi.', trigger: 'Setiap hari • 07:00 WIB', audience: 'Pegawai yang berulang tahun', enabled: true, category: 'Celebration', scope: 'personal', privacy: 'standard' },
  { id: 'religion', title: 'Hari raya keagamaan', description: 'Segmentasi berdasarkan agama agar setiap pegawai menerima ucapan perayaan yang relevan.', trigger: 'Kalender hari raya • 07:00 WIB', audience: 'Berdasarkan agama pegawai', enabled: true, category: 'Celebration', scope: 'segmented', privacy: 'standard' },
  { id: 'anniversary', title: 'Apresiasi masa kerja', description: 'Apresiasi pada milestone masa kerja berdasarkan tanggal mulai bekerja.', trigger: 'Tanggal mulai kerja', audience: 'Pegawai yang mencapai milestone', enabled: false, category: 'Lifecycle', scope: 'personal', privacy: 'standard' },
  { id: 'training', title: 'Learning gap reminder', description: 'Pengingat pelatihan wajib berdasarkan jabatan dan histori pelatihan.', trigger: 'Setiap Senin • 09:00 WIB', audience: 'Pegawai dengan gap kompetensi', enabled: false, category: 'Learning', scope: 'segmented', privacy: 'standard' },
  { id: 'datarefresh', title: 'Konfirmasi data berkala', description: 'Meminta pegawai memeriksa data kontak melalui portal HR resmi.', trigger: 'Setiap 6 bulan', audience: 'Pegawai yang perlu memperbarui data', enabled: false, category: 'Data Quality', scope: 'personal', privacy: 'sensitive' },
  { id: 'rolechange', title: 'Notifikasi perubahan jabatan', description: 'Memberi tahu pegawai saat perubahan kepegawaian tersedia untuk ditinjau.', trigger: 'Saat perubahan tersimpan', audience: 'Pegawai terdampak', enabled: false, category: 'Change Event', scope: 'personal', privacy: 'sensitive' },
  { id: 'workday', title: 'Perubahan hari atau jam kerja', description: 'Pengumuman perubahan jadwal kerja kepada seluruh pegawai atau unit terdampak.', trigger: 'Dijadwalkan HR', audience: 'Seluruh pegawai / unit terdampak', enabled: false, category: 'Informasi Publik', scope: 'public', privacy: 'standard' },
  { id: 'safety', title: 'Informasi keselamatan', description: 'Informasi resmi terkait keselamatan atau bencana, dibatasi berdasarkan area terdampak.', trigger: 'Setelah verifikasi informasi', audience: 'Pegawai di area terdampak', enabled: false, category: 'Keselamatan', scope: 'segmented', privacy: 'standard' },
  { id: 'performance', title: 'Pengingat e-Kinerja & SPT', description: 'Pengingat periode dan tenggat e-Kinerja atau SPT Tahunan melalui kanal resmi.', trigger: 'Menjelang tenggat', audience: 'Pegawai yang perlu menindaklanjuti', enabled: false, category: 'Kinerja', scope: 'segmented', privacy: 'sensitive' },
  { id: 'childbirth', title: 'Ucapan kelahiran anak', description: 'Pesan empati setelah HR mengonfirmasi informasi dan pegawai bersedia dihubungi.', trigger: 'Setelah konfirmasi HR', audience: 'Pegawai terkait', enabled: false, category: 'Peristiwa Pegawai', scope: 'personal', privacy: 'sensitive' },
  { id: 'condolence', title: 'Ucapan belasungkawa', description: 'Pesan pribadi yang dikirim dengan verifikasi HR dan pertimbangan penerima.', trigger: 'Setelah konfirmasi HR', audience: 'Pegawai terkait', enabled: false, category: 'Peristiwa Pegawai', scope: 'personal', privacy: 'sensitive' },
  { id: 'payslip', title: 'Slip gaji tersedia', description: 'Pemberitahuan ketersediaan slip gaji tanpa nominal; detail hanya di portal HR.', trigger: 'Saat slip diterbitkan', audience: 'Pegawai pemilik slip', enabled: false, category: 'Hak & Benefit', scope: 'personal', privacy: 'sensitive' },
  { id: 'medicalclaim', title: 'Pembaruan klaim kesehatan', description: 'Notifikasi status klaim tanpa diagnosis atau nilai klaim; detail hanya di portal aman.', trigger: 'Saat status klaim berubah', audience: 'Pegawai pemilik klaim', enabled: false, category: 'Hak & Benefit', scope: 'personal', privacy: 'sensitive' },
]

function Card({title,subtitle,badge,children}:{title:string,subtitle:string,badge?:string,children:any}) { return <section className="card"><div className="card-head"><div><h3>{title}</h3><p>{subtitle}</p></div>{badge&&<span className="soft-badge">{badge}</span>}</div>{children}</section> }

type AutomationScope = AutomationRule['scope']
type AutomationFilter = 'all' | AutomationScope

const scopeLabels: Record<AutomationScope, string> = {
  public: 'Publik',
  segmented: 'Tersegmentasi',
  personal: 'Personal',
}

export function AutomationCenter({ toast }: { toast: (m: string) => void }) {
  const hr = useHr()
  const { user } = useAuth()
  const [rules, setRules] = useState(initialAutomations)
  const employees = hr.roster.employees
  const showToast = toast
  const forgot = hr.recon.months.reduce((s, m) => s + m.days.filter(d => d.status === 'tidak-lengkap' && d.clockIn && !d.clockOut).length, 0)
  const readiness = employees.length ? Math.round(employees.filter(e => e.nomorWhatsApp).length / employees.length * 100) : 0
  const [waStatus,setWaStatus]=useState<WhatsAppStatus>({ configured:false,status:'not_configured',message:'Memuat status koneksi…' })
  const [waBusy,setWaBusy]=useState(false)
  const [waError,setWaError]=useState('')
  const isAdmin=user.role==='admin'
  useEffect(()=>{
    if(!isAdmin)return
    let active=true
    const refresh=async()=>{
      try { const status=await api<WhatsAppStatus>('/whatsapp/status');if(active){setWaStatus(status);setWaError('')} }
      catch(error){if(active)setWaError((error as Error).message)}
    }
    void refresh()
    const timer=window.setInterval(()=>void refresh(),2500)
    return()=>{active=false;window.clearInterval(timer)}
  },[isAdmin])
  const [scopeFilter,setScopeFilter]=useState<AutomationFilter>('all')
  const [composerScope,setComposerScope]=useState<AutomationScope>('personal')
  const [selectedRule,setSelectedRule]=useState('birthday')
  const upcoming=employees.filter(e=>e.tanggalLahir&&nextBirthdayDays(e.tanggalLahir)<=30).sort((a,b)=>nextBirthdayDays(a.tanggalLahir)-nextBirthdayDays(b.tanggalLahir))
  const selected=rules.find(r=>r.id===selectedRule) ?? rules[0]
  const visibleRules=rules.filter(r=>scopeFilter==='all'||r.scope===scopeFilter)
  const composerRules=rules.filter(r=>r.scope===composerScope)
  const selectRule=(rule:AutomationRule)=>{setSelectedRule(rule.id);setComposerScope(rule.scope)}
  const selectScope=(scope:AutomationScope)=>{
    setComposerScope(scope)
    const next=rules.find(rule=>rule.scope===scope)
    if(next)setSelectedRule(next.id)
  }
  const toggle=(id:string)=>setRules(rules.map(r=>r.id===id?{...r,enabled:!r.enabled}:r))
  const connectWhatsApp=async()=>{
    setWaBusy(true);setWaError('')
    try { const status=await api<WhatsAppStatus>('/whatsapp/connect',{method:'POST'});setWaStatus(status);showToast('Permintaan koneksi WhatsApp dimulai. Pindai QR saat muncul.') }
    catch(error){setWaError((error as Error).message)}
    finally{setWaBusy(false)}
  }
  const disconnectWhatsApp=async()=>{
    setWaBusy(true);setWaError('')
    try { const status=await api<WhatsAppStatus>('/whatsapp/disconnect',{method:'POST'});setWaStatus(status);showToast('Sesi WhatsApp diputus dan kredensial lokal dihapus.') }
    catch(error){setWaError((error as Error).message)}
    finally{setWaBusy(false)}
  }
  const waConnected=waStatus.status==='connected'
  const connectionLabel:Record<WhatsAppStatus['status'],string>={not_configured:'Perlu konfigurasi',disconnected:'Belum terhubung',connecting:'Menghubungkan',qr:'Pindai QR',connected:'Terhubung',reconnecting:'Menyambung ulang',logged_out:'Sesi keluar',error:'Perlu tindakan'}
  return <>
    <div className="page-heading"><div><h2>WhatsApp Automation Center</h2><p>Kelola pengumuman, pesan tersegmentasi, komunikasi personal, dan template HR.</p></div><span className={`connection-chip ${waConnected?'online':''}`}><span></span>{isAdmin?connectionLabel[waStatus.status]:'Koneksi dikelola admin'}</span></div>
    <section className="auto-facts">
      <div><strong>{employees.filter(e => e.tanggalLahir).length}</strong><span>pegawai punya tanggal lahir (dibaca dari NIP) — bahan pratinjau ulang tahun, belum ada pengiriman</span></div>
      <div><strong>{forgot}</strong><span>hari periode ini dengan scan masuk tanpa scan pulang — sasaran pengingat sore</span></div>
      <div><strong>{readiness}%</strong><span>pegawai sudah punya nomor WhatsApp; agama {employees.length ? Math.round(employees.filter(e => e.agama).length / employees.length * 100) : 0}% (untuk ucapan hari raya)</span></div>
    </section>
    <section className="blast-overview" aria-label="Kategori komunikasi WhatsApp HR">
      <div className="blast-lane public"><span>Publik</span><strong>Informasi yang berlaku luas</strong><p>Perubahan hari atau jam kerja, pengumuman resmi, dan arahan umum.</p></div>
      <div className="blast-lane targeted"><span>Tersegmentasi</span><strong>Kirim hanya ke sasaran relevan</strong><p>Area terdampak, hari raya berdasarkan agama, e-Kinerja, dan SPT Tahunan.</p></div>
      <div className="blast-lane personal"><span>Personal & benefit</span><strong>Satu pesan untuk pegawai terkait</strong><p>Ulang tahun, peristiwa keluarga, slip gaji, atau pembaruan klaim.</p></div>
    </section>
    <div className="automation-layout">
      <section className="card wa-connect"><div className="card-head"><div><h3>Koneksi WhatsApp HR</h3><p>Login perangkat tertaut dengan QR WhatsApp Web.</p></div><MessageCircleMore/></div>
        {!isAdmin ? <div className="wa-setup-note"><ShieldCheck size={20}/><p>Hanya administrator yang dapat melihat QR dan mengelola perangkat tertaut WhatsApp.</p></div> : <>
          {waConnected ? <div className="connected-state"><div className="connected-icon"><CheckCircle2/></div><h3>WhatsApp terhubung</h3><p>{waStatus.phoneNumber?`Nomor +${waStatus.phoneNumber}`:'Perangkat HR aktif'}</p><div className="connection-meta"><div><span>Status</span><strong>Terhubung</strong></div><div><span>Sesi</span><strong>Tersimpan terenkripsi</strong></div><div><span>Terhubung sejak</span><strong>{waStatus.connectedAt?new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(waStatus.connectedAt)):'Baru saja'}</strong></div></div><button type="button" className="btn secondary" disabled={waBusy} onClick={disconnectWhatsApp}><ShieldCheck size={16}/> Putuskan perangkat</button></div> : waStatus.qr ? <div className="qr-area"><div className="qr-box"><QRCodeSVG value={waStatus.qr} size={190} level="M" fgColor="#072c52" bgColor="#ffffff"/></div><strong>Pindai dari WhatsApp</strong><p>Buka WhatsApp di ponsel admin → <b>Perangkat tertaut</b> → <b>Tautkan perangkat</b>. QR akan diperbarui otomatis bila kedaluwarsa.</p><button type="button" className="btn secondary" disabled={waBusy} onClick={disconnectWhatsApp}>Batalkan login</button></div> : <div className="qr-area"><div className="qr-box qr-placeholder"><QrCode size={88}/></div><strong>{waStatus.status==='connecting'?'Menghubungkan ke WhatsApp…':waStatus.status==='reconnecting'?'Mencoba menyambungkan kembali…':waStatus.status==='logged_out'?'Sesi WhatsApp sudah keluar':waStatus.status==='error'?'Koneksi perlu diatur ulang':'Tautkan perangkat WhatsApp HR'}</strong><p>{waStatus.message??'Klik tombol untuk meminta QR langsung dari sesi WhatsApp.'}</p>{waStatus.status==='not_configured' ? <div className="wa-setup-note"><ShieldCheck size={18}/><p>Tambahkan <code>WHATSAPP_SESSION_ENCRYPTION_KEY</code> di Render, lalu restart service. Buat nilainya dengan <code>openssl rand -base64 32</code> dan simpan aman.</p></div> : <button type="button" className="btn primary" disabled={waBusy||waStatus.status==='connecting'||waStatus.status==='reconnecting'} onClick={connectWhatsApp}>{waBusy||waStatus.status==='connecting'||waStatus.status==='reconnecting'?<LoaderCircle size={17} className="spin-icon"/>:<QrCode size={17}/>} {waStatus.status==='error'?'Coba login ulang':'Mulai tautkan WhatsApp'}</button>}{waStatus.status==='error'&&waStatus.configured&&<button type="button" className="btn secondary wa-reset-button" disabled={waBusy} onClick={disconnectWhatsApp}>Hapus sesi tersimpan</button>}</div>}
          {waError&&<p className="wa-inline-error" role="alert">{waError}</p>}
        </>}
      </section>
      <section className="card automation-rules"><div className="card-head"><div><h3>Aturan pesan</h3><p>{rules.filter(r=>r.enabled).length} dari {rules.length} automation aktif · belum dikirim ke WhatsApp</p></div><Settings2/></div>
        <div className="scope-filter" role="group" aria-label="Filter jangkauan pesan">
          {(['all','public','segmented','personal'] as AutomationFilter[]).map(scope=><button type="button" key={scope} className={scopeFilter===scope?'active':''} aria-pressed={scopeFilter===scope} onClick={()=>setScopeFilter(scope)}>{scope==='all'?'Semua':scopeLabels[scope]}</button>)}
        </div>
        <div className="rules-list">{visibleRules.map(r=><div className={`rule-item ${r.enabled?'enabled':''} ${selectedRule===r.id?'selected':''}`} key={r.id}>
          <button type="button" className="rule-select" aria-pressed={selectedRule===r.id} onClick={()=>selectRule(r)}>
            <span className="rule-icon">{r.id==='forgotout'||r.id==='rejected'?<Clock3/>:r.id==='birthday'?<Cake/>:r.id==='religion'||r.id==='workday'?<CalendarDays/>:r.id==='training'?<BookOpenCheck/>:r.id==='datarefresh'||r.id==='payslip'?<Database/>:r.id==='safety'||r.id==='medicalclaim'?<ShieldCheck/>:r.id==='childbirth'||r.id==='condolence'?<HeartHandshake/>:r.id==='performance'?<FileSpreadsheet/>:r.id==='anniversary'?<BriefcaseBusiness/>:<Activity/>}</span>
            <span className="rule-copy"><span className="rule-title-line"><strong>{r.title}</strong><span className="category-tag">{r.category}</span><span className={`scope-tag ${r.scope}`}>{scopeLabels[r.scope]}</span>{r.privacy==='sensitive'&&<span className="privacy-tag">Privat</span>}</span><span className="rule-description">{r.description}</span><small>{r.trigger} • {r.audience}</small></span>
          </button>
          <button type="button" className={`switch ${r.enabled?'on':''}`} aria-label={`${r.enabled?'Nonaktifkan':'Aktifkan'} ${r.title} (simulasi)`} aria-pressed={r.enabled} onClick={()=>toggle(r.id)}><span/></button>
        </div>)}{visibleRules.length===0&&<p className="rules-empty">Belum ada aturan pada kategori ini.</p>}</div>
        <small className="rules-hint">{scopeFilter==='all'?`${rules.length} aturan total · gulir daftar untuk melihat lainnya.`:`${visibleRules.length} aturan ${scopeLabels[scopeFilter].toLowerCase()} ditampilkan.`}</small>
      </section>
    </div>
    <div className="dashboard-grid two-thirds automation-bottom">
      <Card title="Pratinjau pesan" subtitle="Pilih jangkauan lalu lihat contoh isi pesan" badge="Simulasi">
        <div className="composer-tabs" role="group" aria-label="Jangkauan template">
          {(['public','segmented','personal'] as AutomationScope[]).map(scope=><button type="button" key={scope} className={composerScope===scope?'active':''} aria-pressed={composerScope===scope} onClick={()=>selectScope(scope)}>{scopeLabels[scope]}</button>)}
        </div>
        <label className="template-picker">Template pesan<select value={selected?.id??''} onChange={event=>{const rule=rules.find(r=>r.id===event.target.value);if(rule)selectRule(rule)}} aria-label="Pilih template pesan">{composerRules.map(rule=><option key={rule.id} value={rule.id}>{rule.title}</option>)}</select></label>
        <div className="message-audience"><UsersRound size={14}/><span>Pratinjau untuk: <strong>{selected?.audience}</strong></span></div>
        <div className="message-preview"><div className="wa-bubble">{messageFor(selected?.id??'birthday',upcoming[0]??employees[0])}<span>Contoh</span></div></div>
        <div className="token-row">{tokensFor(selected?.id??'birthday').map(token=><span key={token}>{`{{${token}}}`}</span>)}</div>
        {selected?.privacy==='sensitive'&&<div className="privacy-note"><ShieldCheck size={16}/><p>{selected.id==='payslip'||selected.id==='medicalclaim'?'WhatsApp hanya menyampaikan pemberitahuan dan tautan portal HR. Jangan sertakan nominal, diagnosis, atau detail klaim.':selected.id==='childbirth'||selected.id==='condolence'?'Kirim secara pribadi setelah informasi diverifikasi HR dan kesediaan pegawai dipertimbangkan.':'Jangan sertakan data pribadi dalam isi WhatsApp; arahkan pegawai ke kanal resmi yang aman.'}</p></div>}
        <button type="button" className="btn secondary preview-action" onClick={()=>showToast('Pratinjau simulasi disiapkan. Tidak ada pesan WhatsApp yang dikirim.')}><MessageCircleMore size={15}/> Simulasikan pratinjau</button>
      </Card>
      <Card title="Antrean ulang tahun" subtitle="Pegawai dengan hari lahir dalam 30 hari" badge={`${upcoming.length} pegawai`}><div className="timeline">{upcoming.slice(0,6).map(e=><div key={e.id}><span className="timeline-dot"></span><div><strong>{e.nama}</strong><p>Ucapan ulang tahun • {nextBirthdayDays(e.tanggalLahir)} hari lagi</p></div><span className="ready-label">Preview</span></div>)}{upcoming.length===0&&<p className="empty-state">Belum ada hari lahir dalam 30 hari.</p>}</div></Card>
    </div>
    <section className="architecture-note"><AlertCircle size={20}/><div><strong>Login nyata, pengiriman masih nonaktif</strong><p>QR dan status koneksi kini berasal dari sesi WhatsApp sungguhan; toggle aturan dan pratinjau pesan masih belum mengirim pesan. Koneksi QR memakai Baileys, klien komunitas WhatsApp Web, sehingga WhatsApp dapat memutus atau membatasi akun. Gunakan nomor kerja khusus, bukan nomor utama/terverifikasi. Pesan slip gaji atau klaim hanya boleh menjadi notifikasi ke portal HR yang aman.</p></div></section>
  </>
}

export function tokensFor(type:string){
  const tokens:Record<string,string[]>={
    forgotout:['nama'],rejected:['nama','tanggal'],birthday:['nama'],religion:['nama','hari_raya'],anniversary:['nama','masa_kerja'],
    training:['nama','nama_pelatihan','tautan_resmi'],datarefresh:['nama','tautan_portal'],rolechange:['nama','tautan_portal'],
    workday:['tanggal_berlaku','ringkasan_perubahan','unit_terdampak','tautan_resmi'],safety:['area','ringkasan_resmi','tautan_resmi'],
    performance:['nama','jenis_pengingat','batas_waktu','tautan_resmi'],childbirth:['nama'],condolence:['nama'],
    payslip:['periode','tautan_portal'],medicalclaim:['tautan_portal'],
  }
  return tokens[type]??tokens.birthday
}

function messageFor(type:string,e?:Employee){
  const name=e?.nama??'{{nama}}'
  if(type==='forgotout') return `Yth. Bapak/Ibu ${name}, sistem mencatat absen masuk Anda hari ini, tetapi belum ada absen pulang. Mohon lakukan scan pulang atau presensi selesai di aplikasi sebelum meninggalkan kantor. Terima kasih. HR KPPU.`
  if(type==='rejected') return `Yth. Bapak/Ibu ${name}, presensi daring Anda tanggal {{tanggal}} berstatus ditolak (Reject). Mohon lengkapi atau ajukan koreksi melalui atasan/SDM agar rekap kehadiran dan uang makan tepat. HR KPPU.`
  if(type==='religion') return `Selamat memperingati {{hari_raya}}, Bapak/Ibu ${name}. Semoga momentum ini membawa kedamaian, kesehatan, sukacita, dan semangat baru dalam berkarya bersama KPPU. Salam hangat, Human Resources KPPU.`
  if(type==='anniversary') return `Selamat atas perjalanan ${e?tenureYears(e.tanggalMulaiKerja):'{{masa_kerja}}'} tahun bersama KPPU, Bapak/Ibu ${name}. Terima kasih atas dedikasi dan kontribusi yang telah diberikan. Semoga terus bertumbuh dan sukses dalam setiap amanah berikutnya.`
  if(type==='training') return `Yth. Bapak/Ibu ${name}, pengingat untuk mengikuti {{nama_pelatihan}} sesuai kebutuhan pengembangan kompetensi. Informasi dan pendaftaran tersedia di kanal resmi: {{tautan_resmi}}. Salam, HR KPPU.`
  if(type==='datarefresh') return `Yth. Bapak/Ibu ${name}, mohon periksa dan perbarui data kepegawaian Anda melalui Portal HR resmi: {{tautan_portal}}. Demi keamanan, lakukan pembaruan setelah masuk ke akun Anda.`
  if(type==='rolechange') return `Yth. Bapak/Ibu ${name}, terdapat pembaruan data kepegawaian untuk Anda. Silakan masuk ke Portal HR resmi untuk meninjau detailnya: {{tautan_portal}}. HR KPPU.`
  if(type==='workday') return `Yth. Bapak/Ibu, terdapat perubahan jadwal kerja yang berlaku {{tanggal_berlaku}}: {{ringkasan_perubahan}}. Informasi ini ditujukan untuk {{unit_terdampak}}. Rincian resmi: {{tautan_resmi}}. HR KPPU.`
  if(type==='safety') return `Informasi keselamatan untuk area {{area}}: {{ringkasan_resmi}}. Mohon mengikuti arahan otoritas dan memperhatikan kanal resmi berikut: {{tautan_resmi}}. HR KPPU.`
  if(type==='performance') return `Yth. Bapak/Ibu ${name}, pengingat {{jenis_pengingat}}. Mohon menindaklanjuti sebelum {{batas_waktu}} melalui kanal resmi: {{tautan_resmi}}. Jika sudah selesai, pesan ini dapat diabaikan. HR KPPU.`
  if(type==='childbirth') return `Selamat atas kelahiran buah hati, Bapak/Ibu ${name}. Semoga keluarga senantiasa diberi kesehatan, kebahagiaan, dan sukacita. Salam hangat dari keluarga besar KPPU.`
  if(type==='condolence') return `Bapak/Ibu ${name}, kami turut berbelasungkawa. Semoga Bapak/Ibu dan keluarga diberikan kekuatan. HR KPPU siap membantu bila ada dukungan administratif yang diperlukan.`
  if(type==='payslip') return `Slip gaji periode {{periode}} telah tersedia. Silakan masuk ke Portal HR resmi untuk melihat rincian secara aman: {{tautan_portal}}. Pesan ini tidak memuat nominal.`
  if(type==='medicalclaim') return `Pembaruan status klaim kesehatan/asuransi Anda tersedia di Portal HR resmi. Silakan masuk untuk melihat detail secara aman: {{tautan_portal}}. Detail klaim tidak disertakan di WhatsApp.`
  return `Selamat ulang tahun, Bapak/Ibu ${name}! 🎉 Semoga senantiasa diberikan kesehatan, kebahagiaan, keberkahan, serta kelancaran dalam setiap langkah. Terima kasih atas dedikasi dan semangat kerja untuk KPPU. Semoga tahun ini membawa banyak pencapaian baik dan kesempatan baru. 🙏`
}
