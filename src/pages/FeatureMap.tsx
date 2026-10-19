import { ChevronRight, Database, Lightbulb, SearchCheck } from 'lucide-react'
import type { Nav, Page } from '../App.tsx'

const FINDINGS: { found: string; impact: string; handled: string }[] = [
  { found: 'Tidak ada ID bersama: mesin pusat & HP memakai NIP, mesin Kanwil II memakai NIKA, Kanwil I/VI nomor mesin, Kanwil V & rekap ST hanya nama.', impact: 'Rekap gabungan tidak bisa sekadar VLOOKUP NIK.', handled: 'Pencocokan berjenjang NIP → NIKA/ID aplikasi → No. mesin → nama, dengan antrean keputusan HR yang diingat sebagai alias.' },
  { found: 'Rekap surat tugas menulis nama singkatan & panggilan ("A. Muhari", "Febi N", "Shobi", "Mhd. Reskam"), nama dipisah koma/baris baru, satu sel berisi banyak orang.', impact: 'Pencocokan ST ke absensi rawan salah orang.', handled: 'Parser khusus per format + skor kemiripan per token (inisial, singkatan Muhammad/Akhmad, salah ketik 1 huruf).' },
  { found: 'Tanggal kegiatan berupa teks bebas: "31 Ags-2 Sep 2026", "28 Sept - 6 Okt 2026", "30 Sep - 2 Oktober" (tanpa tahun), "Tanggal Tugas 08 September 2026".', impact: 'Tidak bisa difilter per tanggal di Excel.', handled: 'Parser rentang tanggal bahasa Indonesia; tahun diambil dari tanggal ST bila kosong.' },
  { found: 'Format tanggal mesin berbeda: pusat M/D/Y, Kanwil II D/M/Y; header Kanwil I berupa serial Excel dengan hari/bulan tertukar.', impact: 'Salah baca 1 Sep sebagai 9 Jan.', handled: 'Urutan tanggal dideteksi per file; header dikoreksi berdasarkan periode laporan.' },
  { found: 'Kode PD di mesin pusat sering mencakup hari di luar rentang ST; ada ST yang tumpang tindih untuk orang yang sama (mis. ST 619 & 620, 1783 & 640).', impact: 'Risiko uang harian ganda / dinas tanpa dasar.', handled: 'Isu "PD tanpa ST" dan "ST tumpang tindih" dengan rujukan nomor surat & baris file.' },
  { found: 'Pegawai dinas luar tetapi tetap scan di kantor pada hari tengah perjalanan.', impact: 'Uang makan & uang harian bisa dibayar bersamaan.', handled: 'Hari ditahan sampai HR memilih "akui dinas" atau "akui hadir"; hari berangkat/pulang diberi tingkat rendah.' },
  { found: 'Rekap manual Kanwil V memuat "Absen Eror" dengan jam diketik dan jam identik dengan hari sebelumnya.', impact: 'Indikasi isian salin-tempel.', handled: 'Ditandai dan menahan uang makan sampai ada bukti.' },
  { found: 'Mesin Kanwil II memakai jadwal "Puasa" (08:00–15:00) di bulan September.', impact: 'Pulang cepat/terlambat terhitung salah.', handled: 'Dihitung ulang dengan jadwal normal; konfigurasi mesin perlu diperbaiki.' },
  { found: 'NIP satu pegawai berbeda antara aplikasi HP dan mesin (tanggal lahir sama).', impact: 'Satu orang terhitung dua kali.', handled: 'Konflik identitas + tombol gabungkan.' },
  { found: 'Kanwil III, IV, VII hanya muncul lewat aplikasi HP; Kanwil VI hanya laporan kode tanpa jam.', impact: 'Ketidakhadiran tidak bisa dibuktikan; ketepatan waktu tidak bisa dicek.', handled: 'Status "belum ada data" dipisah dari "tanpa keterangan"; matriks cakupan sumber di halaman Impor.' },
  { found: 'Ekspor mesin pusat diambil sebelum hari selesai: 29 Sep hanya berisi scan masuk (137 pegawai), 30 Sep hampir kosong (224 "Absent").', impact: 'Ratusan pegawai akan tercatat tanpa keterangan dan kehilangan uang makan.', handled: 'Tanggal ekspor belum lengkap dideteksi otomatis; tidak dihitung TK, uang makan ditahan sampai ekspor ulang.' },
  { found: 'Struktur NIP PPPK (YYYYMMDD 2025 21 G NNN) memuat tanggal lahir & jenis kelamin.', impact: 'Data ulang tahun & demografi tersedia tanpa master.', handled: 'Diturunkan otomatis, diberi label "dari NIP".' },
]

const NEXT: { n: string; title: string; status: 'ready' | 'validate' | 'later'; statusLabel: string; data: string; value: string; guard: string }[] = [
  { n: '01', title: 'Uang lembur dari jam lembur + SPKL', status: 'validate', statusLabel: 'Butuh aturan & SPKL', data: 'Kolom Lembur/OT di mesin & HP, absen hari libur', value: 'Kegunaan #3 di narasi (pengajuan uang lembur) memakai rekap yang sama.', guard: 'Hanya jam yang punya Surat Perintah Kerja Lembur; tarif per golongan dari Keuangan.' },
  { n: '02', title: 'Register surat tugas digital', status: 'ready', statusLabel: 'Dampak terbesar', data: 'Form sekretaris dengan pilihan pegawai (bukan ketik nama), rentang tanggal, tujuan', value: 'Menghapus akar masalah nama singkatan & tanggal teks bebas; ST langsung tertaut NIP.', guard: 'Nomor ST otomatis & unik per unit; impor Excel tetap didukung masa transisi.' },
  { n: '03', title: 'Penarikan otomatis dari mesin & aplikasi', status: 'later', statusLabel: 'Butuh akses API', data: 'API/ekspor terjadwal mesin sidik jari & presensi daring', value: 'Langkah unggah manual hilang; rekonsiliasi berjalan harian, bukan akhir bulan.', guard: 'Akun layanan baca-saja, log sinkronisasi, retensi data sesuai kebijakan.' },
  { n: '04', title: 'Rekonsiliasi uang harian SPD', status: 'validate', statusLabel: 'Perlu data SPD', data: 'Nomor blanko SPD (sudah ada di rekap Kanwil VI), ST, absensi', value: 'Mencegah uang harian dibayar pada hari pegawai terbukti di kantor.', guard: 'Keputusan akhir tetap pada PPK/Keuangan.' },
  { n: '05', title: 'Akumulasi disiplin tahunan (PP 94/2021)', status: 'ready', statusLabel: 'Data sudah ada', data: 'Tanpa keterangan & keterlambatan lintas bulan', value: 'Kegunaan #2 di narasi; atasan mendapat peringatan sebelum ambang hukuman.', guard: 'Hanya setelah isu rekonsiliasi diputuskan; bukan keputusan otomatis.' },
  { n: '06', title: 'Alur persetujuan berjenjang & audit log', status: 'validate', statusLabel: 'Perlu peran pengguna', data: 'Keputusan reviewer (sudah tercatat), peran sekretaris/SDM/Keuangan', value: 'Daftar nominatif terkunci per periode setelah disetujui.', guard: 'Login, RBAC, dan jejak perubahan di server.' },
  { n: '07', title: 'Geofence WFO & pemantauan WFA', status: 'ready', statusLabel: 'Data sudah ada', data: 'Koordinat check-in/out presensi daring', value: 'WFO di luar radius kantor dan jarak masuk–pulang yang janggal terdeteksi otomatis.', guard: 'Koordinat adalah data pribadi; tampilkan hanya ke peninjau berwenang.' },
  { n: '08', title: 'Kalender kerja terpusat', status: 'ready', statusLabel: 'Mudah', data: 'Libur nasional, cuti bersama, jadwal Ramadan, WFA Jumat', value: 'Satu sumber jadwal untuk mesin, aplikasi, dan perhitungan.', guard: 'Diubah hanya oleh SDM; perubahan memicu pengumuman WA publik.' },
]

const TABLES: { name: string; cols: string }[] = [
  { name: 'pegawai', cols: 'id (PK) · nip (UNIQUE, null) · nika (UNIQUE, null) · nik_ktp (UNIQUE, null) · nama · kantor_id · unit_id · status_kepegawaian · golongan · jabatan · tanggal_lahir · jenis_kelamin · agama · no_wa · email' },
  { name: 'pegawai_alias', cols: 'id · pegawai_id (FK) · jenis (nip/nika/app/mesin/nama) · nilai · sumber · dikonfirmasi_oleh · UNIQUE(jenis, sumber, nilai)' },
  { name: 'file_sumber', cols: 'id · nama_file · jenis · kantor_id · periode_mulai · periode_selesai · hash · diimpor_oleh · diimpor_pada' },
  { name: 'catatan_absensi', cols: 'id · file_id (FK) · pegawai_id (FK, null) · tanggal · jam_masuk · jam_pulang · kode · mode (WFO/WFA) · approved · lat/lng · rujukan_baris' },
  { name: 'surat_tugas · surat_tugas_pegawai', cols: 'nomor · tanggal_st · unit · tujuan · tgl_mulai · tgl_selesai · lokal │ st_id · pegawai_id · nama_tertulis' },
  { name: 'rekap_harian', cols: 'pegawai_id · tanggal (PK gabungan) · status · dasar · jam_masuk · jam_pulang · terlambat_mnt · status_um · nominal_um' },
  { name: 'isu · keputusan', cols: 'pegawai_id · tanggal · jenis · tingkat │ isu_id · keputusan · catatan · reviewer · waktu (audit)' },
  { name: 'aturan_um · periode_um', cols: 'versi aturan & tarif per golongan │ periode · status (draf/disetujui/terkunci)' },
]

export function FeatureMap({ nav }: { nav: Nav }) {
  const demo: { title: string; description: string; page: Page }[] = [
    { title: 'Impor 11 file apa adanya', description: 'Tunjukkan deteksi format & matriks cakupan per kantor.', page: 'import' },
    { title: 'Cocokkan identitas', description: 'Nama singkatan di ST → NIP; konflik NIP Aldila.', page: 'identity' },
    { title: 'Rekonsiliasi', description: 'Buka kasus ST tumpang tindih & dinas-tapi-scan; ambil keputusan.', page: 'reconcile' },
    { title: 'Uang makan', description: 'Bandingkan aturan "tepat waktu" vs "hadir"; unduh nominatif.', page: 'meal' },
    { title: 'Ringkasan & pegawai', description: 'Dashboard per unit, profil dengan alias lintas sumber.', page: 'overview' },
  ]
  return <div className="feature-studio">
    <header className="studio-intro">
      <div><span className="studio-kicker"><SearchCheck size={15} /> Diselaraskan dengan data nyata</span><h2>Apa yang ditemukan di data, dan langkah berikutnya</h2><p>Disusun dari 11 file rapat absensi September 2026 (pusat, Kanwil I, II, V, VI, rekap sekretaris Kesekjenan & Kedeputian).</p></div>
      <span className="studio-status"><span /> Prototype berbasis data riil</span>
    </header>

    <section className="panel">
      <div className="panel-head"><div><h3>Temuan data → penanganan di sistem</h3><p>Masalah yang selama ini membuat rekap manual lambat dan rawan salah.</p></div></div>
      <div className="table-wrap"><table className="data findings">
        <thead><tr><th>Temuan</th><th>Dampak</th><th>Ditangani dengan</th></tr></thead>
        <tbody>{FINDINGS.map((f, i) => <tr key={i}><td>{f.found}</td><td>{f.impact}</td><td>{f.handled}</td></tr>)}</tbody>
      </table></div>
    </section>

    <div className="studio-section-heading"><div><h3><Lightbulb size={16} /> Fitur berikutnya</h3><p>Prioritas kedua — memanfaatkan data yang sekarang sudah tersatukan.</p></div><span>{NEXT.length} usulan</span></div>
    <div className="opportunity-grid">{NEXT.map(item => <article className="opportunity-card" key={item.n}>
      <header className="opportunity-card-heading"><div><span className="opportunity-number">{item.n}</span><h3>{item.title}</h3></div><span className={`opportunity-status ${item.status}`}>{item.statusLabel}</span></header>
      <div className="opportunity-notes">
        <div><strong>Data</strong><p>{item.data}</p></div>
        <div><strong>Nilai</strong><p>{item.value}</p></div>
        <div><strong>Prasyarat & kontrol</strong><p>{item.guard}</p></div>
      </div>
    </article>)}</div>

    <section className="panel">
      <div className="panel-head"><div><h3><Database size={16} /> Rancangan database relasional</h3><p>Kunci utama memakai ID internal; NIP, NIKA, dan NIK KTP disimpan sebagai kolom unik opsional. Alasannya: kolom "NIK" di mesin pusat ternyata berisi NIP, NIK KTP tidak ada di sumber absensi mana pun, dan sebagian pegawai Kanwil belum punya NIP di data. DDL lengkap: <code>docs/rancangan-database.sql</code>.</p></div></div>
      <div className="schema-grid">{TABLES.map(t => <div key={t.name}><strong>{t.name}</strong><p>{t.cols}</p></div>)}</div>
    </section>

    <section className="presentation-plan">
      <div className="presentation-heading"><div><h3>Alur demo</h3><p>Urutan yang menceritakan masalah nyata → solusi.</p></div><span>±7 menit</span></div>
      <div className="presentation-steps">{demo.map((s, i) => <button type="button" className="presentation-step" key={s.title} onClick={() => nav(s.page)}><span>{String(i + 1).padStart(2, '0')}</span><div><strong>{s.title}</strong><p>{s.description}</p></div><ChevronRight size={15} /></button>)}</div>
    </section>
  </div>
}
