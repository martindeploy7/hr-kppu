import type { Religion } from '../src/engine/types.ts'

/**
 * Kontrak automation WhatsApp (dipakai server dan UI).
 *
 * Alur: scheduler di proses server berdetak tiap menit → planner membuat item antrean (outbox) untuk aturan yang jatuh
 * tempo hari ini (zona WIB) → sender mengirim satu per satu dengan jeda, retry, dan jam kirim. Setiap item punya kunci
 * dedupe sehingga detak berulang, restart server, atau beberapa instance tidak pernah mengirim pesan yang sama dua kali.
 */
export type AutomationRuleId =
  | 'birthday' | 'religion' | 'anniversary' | 'rejected' | 'forgotout' | 'datarefresh' | 'rolechange'
  | 'training' | 'workday' | 'safety' | 'performance' | 'childbirth' | 'condolence' | 'payslip' | 'medicalclaim'

/** scheduled = dijalankan otomatis setiap hari; event = dipicu perubahan data; campaign = disusun HR lalu dijadwalkan. */
export type AutomationKind = 'scheduled' | 'event' | 'campaign'
export type AutomationScope = 'public' | 'segmented' | 'personal'
export type AutomationCategory = 'Celebration' | 'Lifecycle' | 'Data Quality' | 'Learning' | 'Change Event' | 'Informasi Publik' | 'Keselamatan' | 'Kinerja' | 'Peristiwa Pegawai' | 'Hak & Benefit' | 'Absensi'

export type AutomationRuleOptions = {
  /** anniversary: tahun masa kerja yang dirayakan; kosong = setiap tahun. */
  milestones?: number[]
  /** rejected/forgotout: hanya bukti absensi dalam N hari terakhir yang diberitahukan. */
  lookbackDays?: number
  /** datarefresh: bulan pengiriman (1–12); dikirim pada hari kerja pertama bulan tersebut. */
  months?: number[]
}

export type AutomationRuleDef = {
  id: AutomationRuleId
  title: string
  description: string
  kind: AutomationKind
  scope: AutomationScope
  category: AutomationCategory
  privacy: 'standard' | 'sensitive'
  /** Token yang boleh dipakai di template, tanpa kurung kurawal. */
  tokens: string[]
  audience: string
  defaultTemplate: string
  defaultSendTime: string
  defaultEnabled: boolean
  defaultOptions?: AutomationRuleOptions
}

export type AutomationRule = AutomationRuleDef & {
  enabled: boolean
  /** HH:MM WIB. Untuk aturan event: jam paling awal pesan dikirim setiap hari. */
  sendTime: string
  template: string
  options: AutomationRuleOptions
  updatedAt?: string
  updatedBy?: string
}

export type AutomationSettings = {
  /** Mode uji: semua pesan dialihkan ke nomor uji (dengan label penerima asli). Default aktif. */
  testMode: boolean
  testNumbers: string[]
  /** Batas pesan per hari selama mode uji, agar nomor uji tidak dibanjiri. */
  testDailyLimit: number
  /** Simulasi: sender menandai pesan terkirim tanpa menghubungi WhatsApp (untuk uji lokal). */
  dryRun: boolean
  /** Jendela kirim WIB. Di luar jendela pesan menunggu. */
  windowStart: string
  windowEnd: string
  /** Jeda minimum antar pesan (detik) + jitter acak hingga jitterSec. */
  minIntervalSec: number
  jitterSec: number
  dailyLimit: number
  maxAttempts: number
  portalUrl: string
  /** Pengirim yang tercantum di akhir pesan. */
  signature: string
  paused: boolean
}

export type ReligiousHoliday = {
  id: string
  date: string
  name: string
  religions: Religion[]
  /** Kalimat pembuka ucapan, mis. "Selamat Hari Raya Idul Fitri 1447 H. Mohon maaf lahir dan batin". */
  greeting: string
  /** Tanggal sudah sesuai SKB/ketetapan resmi. Hari raya yang belum dikonfirmasi tidak dikirim. */
  confirmed: boolean
  enabled: boolean
}

export type CampaignAudience =
  | { kind: 'all' }
  | { kind: 'kantor' | 'unit' | 'agama' | 'pegawai'; values: string[] }

export type CampaignStatus = 'scheduled' | 'done' | 'cancelled'
export type Campaign = {
  id: string
  ruleId: AutomationRuleId
  title: string
  template: string
  /** Nilai token tambahan, mis. { tautan_resmi: 'https://…', batas_waktu: '31 Maret 2027' }. */
  variables: Record<string, string>
  audience: CampaignAudience
  sendAt: string
  repeatMonthly: boolean
  status: CampaignStatus
  createdBy: string
  createdAt: string
  lastRunOn?: string
  recipients?: number
}

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled' | 'expired'
export type OutboxItem = {
  id: string
  dedupeKey: string
  ruleId: AutomationRuleId
  campaignId?: string
  employeeId?: string
  recipientName: string
  /** Nomor tujuan asli (format 62…); kosong bila pegawai belum punya nomor. */
  phone: string
  /** Nomor yang benar-benar dikirimi (nomor uji saat mode uji). */
  deliverTo: string
  test: boolean
  message: string
  scheduledFor: string
  expiresAt: string
  status: OutboxStatus
  attempts: number
  nextAttemptAt?: string
  lastError?: string
  sentAt?: string
  createdAt: string
}

export type SchedulerState = {
  /** leader = instance ini memegang kunci dan menjalankan automation; standby = instance lain sedang memegangnya. */
  role: 'leader' | 'standby' | 'stopped'
  startedAt?: string
  lastTickAt?: string
  lastTickMs?: number
  lastError?: string
  lastErrorAt?: string
  lastPlanned: Partial<Record<AutomationRuleId, { at: string; queued: number }>>
  /** Alasan sender sedang menunggu, mis. WhatsApp belum terhubung atau di luar jam kirim. */
  waiting?: string
  lastSentAt?: string
}

export type AutomationCounts = { pending: number; sentToday: number; failed: number; skippedToday: number; sentTotal: number }

export type RulePreview = {
  ruleId: AutomationRuleId
  date: string
  /** Jumlah pesan yang akan/sudah diantrikan untuk tanggal tersebut. */
  recipients: { employeeId: string; name: string; phone: string; message: string; note?: string }[]
  /** Pegawai sasaran yang tidak bisa dikirimi (tanpa nomor/nomor tidak valid). */
  missingPhone: { employeeId: string; name: string }[]
  /** Keterangan bila aturan tidak menghasilkan pesan pada tanggal tersebut. */
  note?: string
}

export type AutomationOverview = {
  now: string
  today: string
  settings: AutomationSettings
  rules: AutomationRule[]
  holidays: ReligiousHoliday[]
  scheduler: SchedulerState
  counts: AutomationCounts
  whatsappReady: boolean
  /** Ringkasan 30 hari ke depan: ulang tahun, hari raya, masa kerja. */
  upcoming: { date: string; ruleId: AutomationRuleId; label: string; recipients: number }[]
  warnings: string[]
}

export const RULE_DEFS: AutomationRuleDef[] = [
  {
    id: 'birthday', title: 'Ucapan ulang tahun personal', kind: 'scheduled', scope: 'personal', category: 'Celebration', privacy: 'standard',
    description: 'Ucapan, doa, dan semangat kerja dikirim pada hari ulang tahun pegawai. Lahir 29 Februari dirayakan 28 Februari di tahun bukan kabisat.',
    audience: 'Pegawai aktif yang berulang tahun hari ini', tokens: ['sapaan', 'nama', 'nama_depan', 'usia', 'pengirim'], defaultSendTime: '07:00', defaultEnabled: true,
    defaultTemplate: 'Selamat ulang tahun, {{sapaan}} {{nama}}! 🎉 Semoga senantiasa diberikan kesehatan, kebahagiaan, keberkahan, serta kelancaran dalam setiap langkah. Terima kasih atas dedikasi dan semangat kerja untuk KPPU. Semoga tahun ini membawa banyak pencapaian baik dan kesempatan baru. 🙏\n\n{{pengirim}}',
  },
  {
    id: 'religion', title: 'Hari raya keagamaan', kind: 'scheduled', scope: 'segmented', category: 'Celebration', privacy: 'standard',
    description: 'Ucapan dikirim pada hari raya sesuai agama pegawai, mengikuti kalender hari raya yang dikonfirmasi HR.',
    audience: 'Pegawai yang agamanya sesuai hari raya', tokens: ['sapaan', 'nama', 'hari_raya', 'ucapan', 'pengirim'], defaultSendTime: '07:00', defaultEnabled: true,
    defaultTemplate: '{{ucapan}}, {{sapaan}} {{nama}}. Semoga momentum {{hari_raya}} membawa kedamaian, kesehatan, sukacita, dan semangat baru dalam berkarya bersama KPPU.\n\nSalam hangat,\n{{pengirim}}',
  },
  {
    id: 'anniversary', title: 'Apresiasi masa kerja', kind: 'scheduled', scope: 'personal', category: 'Lifecycle', privacy: 'standard',
    description: 'Apresiasi pada tanggal mulai kerja ketika pegawai mencapai milestone masa kerja.',
    audience: 'Pegawai yang mencapai milestone masa kerja hari ini', tokens: ['sapaan', 'nama', 'masa_kerja', 'pengirim'], defaultSendTime: '08:00', defaultEnabled: true,
    defaultOptions: { milestones: [1, 5, 10, 15, 20, 25, 30, 35] },
    defaultTemplate: 'Selamat atas perjalanan {{masa_kerja}} tahun bersama KPPU, {{sapaan}} {{nama}}. Terima kasih atas dedikasi dan kontribusi yang telah diberikan. Semoga terus bertumbuh dan sukses dalam setiap amanah berikutnya.\n\n{{pengirim}}',
  },
  {
    id: 'rejected', title: 'Presensi daring ditolak', kind: 'event', scope: 'personal', category: 'Absensi', privacy: 'standard',
    description: 'Setelah setoran Mesin Online diunggah, pegawai dengan presensi berstatus Reject diberi tahu agar segera mengajukan koreksi sebelum rekap bulanan.',
    audience: 'Pegawai pemilik presensi Reject', tokens: ['sapaan', 'nama', 'tanggal', 'pengirim'], defaultSendTime: '09:00', defaultEnabled: false,
    defaultOptions: { lookbackDays: 14 },
    defaultTemplate: 'Yth. {{sapaan}} {{nama}}, presensi daring Anda tanggal {{tanggal}} berstatus ditolak (Reject). Mohon lengkapi atau ajukan koreksi melalui atasan/SDM agar rekap kehadiran dan uang makan tepat.\n\n{{pengirim}}',
  },
  {
    id: 'forgotout', title: 'Scan pulang tidak tercatat', kind: 'event', scope: 'personal', category: 'Absensi', privacy: 'standard',
    description: 'Setelah setoran mingguan masuk, pegawai yang punya scan masuk tanpa scan pulang diberi tahu tanggalnya agar bisa mengajukan koreksi. Satu pesan per pegawai per pekan.',
    audience: 'Pegawai dengan scan masuk tanpa scan pulang', tokens: ['sapaan', 'nama', 'tanggal', 'pengirim'], defaultSendTime: '09:00', defaultEnabled: false,
    defaultOptions: { lookbackDays: 14 },
    defaultTemplate: 'Yth. {{sapaan}} {{nama}}, sistem mencatat scan masuk tanpa scan pulang pada {{tanggal}}. Bila Anda sebenarnya hadir penuh, mohon ajukan koreksi melalui atasan/SDM sebelum rekap bulanan ditutup.\n\n{{pengirim}}',
  },
  {
    id: 'datarefresh', title: 'Konfirmasi data berkala', kind: 'scheduled', scope: 'personal', category: 'Data Quality', privacy: 'sensitive',
    description: 'Meminta pegawai memeriksa data kontak melalui portal HR resmi pada hari kerja pertama bulan yang dipilih.',
    audience: 'Seluruh pegawai aktif', tokens: ['sapaan', 'nama', 'tautan_portal', 'pengirim'], defaultSendTime: '09:00', defaultEnabled: false,
    defaultOptions: { months: [1, 7] },
    defaultTemplate: 'Yth. {{sapaan}} {{nama}}, mohon periksa dan perbarui data kepegawaian Anda melalui Portal HR resmi: {{tautan_portal}}. Demi keamanan, lakukan pembaruan setelah masuk ke akun Anda.\n\n{{pengirim}}',
  },
  {
    id: 'rolechange', title: 'Notifikasi perubahan jabatan', kind: 'event', scope: 'personal', category: 'Change Event', privacy: 'sensitive',
    description: 'Saat jabatan, golongan, unit, atau kantor pegawai berubah di master, pegawai diminta meninjau detailnya di portal. Isi perubahan tidak ditulis di WhatsApp.',
    audience: 'Pegawai yang datanya berubah', tokens: ['sapaan', 'nama', 'tautan_portal', 'pengirim'], defaultSendTime: '09:00', defaultEnabled: false,
    defaultTemplate: 'Yth. {{sapaan}} {{nama}}, terdapat pembaruan data kepegawaian untuk Anda. Silakan masuk ke Portal HR resmi untuk meninjau detailnya: {{tautan_portal}}.\n\n{{pengirim}}',
  },
  {
    id: 'training', title: 'Pengingat pelatihan', kind: 'campaign', scope: 'segmented', category: 'Learning', privacy: 'standard',
    description: 'Pengingat pelatihan untuk unit/kantor sasaran, disusun HR lalu dijadwalkan.',
    audience: 'Pegawai sasaran pelatihan', tokens: ['sapaan', 'nama', 'nama_pelatihan', 'tautan_resmi', 'pengirim'], defaultSendTime: '09:00', defaultEnabled: true,
    defaultTemplate: 'Yth. {{sapaan}} {{nama}}, pengingat untuk mengikuti {{nama_pelatihan}} sesuai kebutuhan pengembangan kompetensi. Informasi dan pendaftaran tersedia di kanal resmi: {{tautan_resmi}}.\n\n{{pengirim}}',
  },
  {
    id: 'workday', title: 'Perubahan hari atau jam kerja', kind: 'campaign', scope: 'public', category: 'Informasi Publik', privacy: 'standard',
    description: 'Pengumuman perubahan jadwal kerja kepada seluruh pegawai atau unit terdampak.',
    audience: 'Seluruh pegawai / unit terdampak', tokens: ['sapaan', 'nama', 'tanggal_berlaku', 'ringkasan_perubahan', 'tautan_resmi', 'pengirim'], defaultSendTime: '09:00', defaultEnabled: true,
    defaultTemplate: 'Yth. {{sapaan}} {{nama}}, terdapat perubahan jadwal kerja yang berlaku {{tanggal_berlaku}}: {{ringkasan_perubahan}}. Rincian resmi: {{tautan_resmi}}.\n\n{{pengirim}}',
  },
  {
    id: 'safety', title: 'Informasi keselamatan', kind: 'campaign', scope: 'segmented', category: 'Keselamatan', privacy: 'standard',
    description: 'Informasi resmi keselamatan atau bencana, dibatasi ke kantor/area terdampak.',
    audience: 'Pegawai di area terdampak', tokens: ['sapaan', 'nama', 'area', 'ringkasan_resmi', 'tautan_resmi', 'pengirim'], defaultSendTime: '07:00', defaultEnabled: true,
    defaultTemplate: 'Informasi keselamatan untuk area {{area}}: {{ringkasan_resmi}}. Mohon mengikuti arahan otoritas dan memperhatikan kanal resmi berikut: {{tautan_resmi}}.\n\n{{pengirim}}',
  },
  {
    id: 'performance', title: 'Pengingat e-Kinerja & SPT', kind: 'campaign', scope: 'segmented', category: 'Kinerja', privacy: 'sensitive',
    description: 'Pengingat tenggat e-Kinerja atau SPT Tahunan. Bisa diulang setiap bulan.',
    audience: 'Pegawai yang perlu menindaklanjuti', tokens: ['sapaan', 'nama', 'jenis_pengingat', 'batas_waktu', 'tautan_resmi', 'pengirim'], defaultSendTime: '09:00', defaultEnabled: true,
    defaultTemplate: 'Yth. {{sapaan}} {{nama}}, pengingat {{jenis_pengingat}}. Mohon menindaklanjuti sebelum {{batas_waktu}} melalui kanal resmi: {{tautan_resmi}}. Jika sudah selesai, pesan ini dapat diabaikan.\n\n{{pengirim}}',
  },
  {
    id: 'childbirth', title: 'Ucapan kelahiran anak', kind: 'campaign', scope: 'personal', category: 'Peristiwa Pegawai', privacy: 'sensitive',
    description: 'Pesan empati setelah HR mengonfirmasi informasi dan pegawai bersedia dihubungi.',
    audience: 'Pegawai terkait', tokens: ['sapaan', 'nama', 'pengirim'], defaultSendTime: '09:00', defaultEnabled: true,
    defaultTemplate: 'Selamat atas kelahiran buah hati, {{sapaan}} {{nama}}. Semoga keluarga senantiasa diberi kesehatan, kebahagiaan, dan sukacita.\n\nSalam hangat dari keluarga besar KPPU.',
  },
  {
    id: 'condolence', title: 'Ucapan belasungkawa', kind: 'campaign', scope: 'personal', category: 'Peristiwa Pegawai', privacy: 'sensitive',
    description: 'Pesan pribadi yang dikirim setelah verifikasi HR.',
    audience: 'Pegawai terkait', tokens: ['sapaan', 'nama', 'pengirim'], defaultSendTime: '09:00', defaultEnabled: true,
    defaultTemplate: '{{sapaan}} {{nama}}, kami turut berbelasungkawa. Semoga {{sapaan}} dan keluarga diberikan kekuatan. HR KPPU siap membantu bila ada dukungan administratif yang diperlukan.\n\n{{pengirim}}',
  },
  {
    id: 'payslip', title: 'Slip gaji tersedia', kind: 'campaign', scope: 'personal', category: 'Hak & Benefit', privacy: 'sensitive',
    description: 'Pemberitahuan ketersediaan slip gaji tanpa nominal; detail hanya di portal HR. Bisa diulang setiap bulan.',
    audience: 'Pegawai pemilik slip', tokens: ['sapaan', 'nama', 'periode', 'tautan_portal', 'pengirim'], defaultSendTime: '10:00', defaultEnabled: true,
    defaultTemplate: 'Yth. {{sapaan}} {{nama}}, slip gaji periode {{periode}} telah tersedia. Silakan masuk ke Portal HR resmi untuk melihat rincian secara aman: {{tautan_portal}}. Pesan ini tidak memuat nominal.\n\n{{pengirim}}',
  },
  {
    id: 'medicalclaim', title: 'Pembaruan klaim kesehatan', kind: 'campaign', scope: 'personal', category: 'Hak & Benefit', privacy: 'sensitive',
    description: 'Notifikasi status klaim tanpa diagnosis atau nilai klaim; detail hanya di portal aman.',
    audience: 'Pegawai pemilik klaim', tokens: ['sapaan', 'nama', 'tautan_portal', 'pengirim'], defaultSendTime: '10:00', defaultEnabled: true,
    defaultTemplate: 'Yth. {{sapaan}} {{nama}}, pembaruan status klaim kesehatan/asuransi Anda tersedia di Portal HR resmi. Silakan masuk untuk melihat detail secara aman: {{tautan_portal}}. Detail klaim tidak disertakan di WhatsApp.\n\n{{pengirim}}',
  },
]

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  testMode: true, testNumbers: [], testDailyLimit: 20, dryRun: false,
  windowStart: '07:00', windowEnd: '20:00', minIntervalSec: 8, jitterSec: 7, dailyLimit: 600, maxAttempts: 5,
  portalUrl: 'https://portal-hr.kppu.go.id', signature: 'Human Resources KPPU', paused: false,
}

/**
 * Kalender awal. 2026 mengikuti daftar libur nasional di kebijakan UM (SKB). 2027 masih perkiraan (hisab/kalender
 * astronomis) sehingga belum dikonfirmasi: HR wajib mencocokkan dengan SKB 3 Menteri sebelum ucapan dikirim.
 */
export const DEFAULT_HOLIDAYS: ReligiousHoliday[] = [
  ['2026-01-16', 'Isra Mi\'raj Nabi Muhammad SAW', ['Islam'], 'Selamat memperingati Isra Mi\'raj Nabi Muhammad SAW', true],
  ['2026-02-17', 'Tahun Baru Imlek 2577 Kongzili', ['Konghucu'], 'Selamat Tahun Baru Imlek 2577 Kongzili. Gong Xi Fa Cai', true],
  ['2026-03-19', 'Hari Suci Nyepi Tahun Baru Saka 1948', ['Hindu'], 'Selamat Hari Suci Nyepi Tahun Baru Saka 1948', true],
  ['2026-03-20', 'Idul Fitri 1447 H', ['Islam'], 'Selamat Hari Raya Idul Fitri 1447 H. Mohon maaf lahir dan batin', true],
  ['2026-04-05', 'Paskah', ['Kristen', 'Katolik'], 'Selamat Hari Paskah', true],
  ['2026-05-14', 'Kenaikan Yesus Kristus', ['Kristen', 'Katolik'], 'Selamat memperingati Kenaikan Yesus Kristus', true],
  ['2026-05-27', 'Idul Adha 1447 H', ['Islam'], 'Selamat Hari Raya Idul Adha 1447 H', true],
  ['2026-05-31', 'Hari Raya Waisak 2570 BE', ['Buddha'], 'Selamat Hari Raya Waisak 2570 BE', true],
  ['2026-06-16', 'Tahun Baru Islam 1448 H', ['Islam'], 'Selamat Tahun Baru Islam 1448 H', true],
  ['2026-08-25', 'Maulid Nabi Muhammad SAW', ['Islam'], 'Selamat memperingati Maulid Nabi Muhammad SAW', true],
  ['2026-12-25', 'Natal', ['Kristen', 'Katolik'], 'Selamat Hari Natal', true],
  ['2027-01-05', 'Isra Mi\'raj Nabi Muhammad SAW', ['Islam'], 'Selamat memperingati Isra Mi\'raj Nabi Muhammad SAW', false],
  ['2027-02-06', 'Tahun Baru Imlek 2578 Kongzili', ['Konghucu'], 'Selamat Tahun Baru Imlek 2578 Kongzili. Gong Xi Fa Cai', false],
  ['2027-03-08', 'Hari Suci Nyepi Tahun Baru Saka 1949', ['Hindu'], 'Selamat Hari Suci Nyepi Tahun Baru Saka 1949', false],
  ['2027-03-10', 'Idul Fitri 1448 H', ['Islam'], 'Selamat Hari Raya Idul Fitri 1448 H. Mohon maaf lahir dan batin', false],
  ['2027-03-28', 'Paskah', ['Kristen', 'Katolik'], 'Selamat Hari Paskah', false],
  ['2027-05-06', 'Kenaikan Yesus Kristus', ['Kristen', 'Katolik'], 'Selamat memperingati Kenaikan Yesus Kristus', false],
  ['2027-05-17', 'Idul Adha 1448 H', ['Islam'], 'Selamat Hari Raya Idul Adha 1448 H', false],
  ['2027-05-20', 'Hari Raya Waisak 2571 BE', ['Buddha'], 'Selamat Hari Raya Waisak 2571 BE', false],
  ['2027-06-06', 'Tahun Baru Islam 1449 H', ['Islam'], 'Selamat Tahun Baru Islam 1449 H', false],
  ['2027-08-15', 'Maulid Nabi Muhammad SAW', ['Islam'], 'Selamat memperingati Maulid Nabi Muhammad SAW', false],
  ['2027-12-25', 'Natal', ['Kristen', 'Katolik'], 'Selamat Hari Natal', false],
].map(([date, name, religions, greeting, confirmed]) => ({
  id: `${date}:${(name as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  date: date as string, name: name as string, religions: religions as Religion[], greeting: greeting as string, confirmed: confirmed as boolean, enabled: true,
}))

/** Normalisasi nomor Indonesia ke format 62xxxxxxxxxx. undefined bila tidak valid. */
export function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  else if (digits.startsWith('8')) digits = `62${digits}`
  if (!/^628\d{7,11}$/.test(digits)) return undefined
  return digits
}

export const isHHMM = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
