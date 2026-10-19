> Pembaruan 19 Oktober 2026: dokumen di bawah adalah snapshot frontend historis. Implementasi sudah diperluas dengan Hono/Drizzle/PostgreSQL, login, role/kantor, audit, impor server dan pengajuan snapshot. Status terkini, bukti tes dan pekerjaan tersisa ada di [IMPLEMENTATION.md](IMPLEMENTATION.md). Deployment live Render/Supabase belum diverifikasi.

# KPPU HR — Breakdown Fitur Frontend Saat Ini

> Snapshot: 19 Oktober 2026. Dokumen konteks untuk ChatGPT Work dan AI chat lainnya.
> Dasar: penelusuran kode frontend di `hr_kppu/kppu-hr-dashboard-demo`, bukan hanya README. Status di bawah berarti implementasi ditemukan dalam kode; sesi penyusunan dokumen ini tidak menjalankan pengujian browser, build, atau verifikasi website produksi.

## 1. Ringkasan produk dan tahap pengembangan

KPPU HR adalah prototype frontend untuk menggabungkan sumber absensi KPPU, menyatukan identitas pegawai, meninjau konflik kehadiran, dan menghasilkan daftar nominatif uang makan. Tersedia dashboard kepegawaian, direktori pegawai, pemeliharaan master, serta simulasi komunikasi WhatsApp.

Alur inti sudah memiliki logika pemrosesan di browser: unggah Excel → parsing → roster pegawai → pencocokan identitas → rekonsiliasi per hari → keputusan reviewer → perhitungan uang makan → ekspor Excel. Angka dashboard berasal dari data yang diimpor, bukan jumlah pegawai tetap yang ditanam ke halaman.

**Tahap saat ini: prototype fungsional berbasis file dengan penyimpanan lokal.** Backend operasional, autentikasi, hak akses, sinkronisasi antar pengguna, pengiriman WhatsApp, dan proses pembayaran belum tersedia dalam frontend yang ditelusuri.

### Arti status

| Status | Makna |
| --- | --- |
| Terimplementasi di FE | UI dan logika terkait ada; pemrosesan berjalan di browser. |
| Simulasi | Interaksi tampilan tersedia, tetapi integrasi atau eksekusi operasional belum berjalan. |
| Rancangan | Usulan atau skema dokumentasi; belum merupakan modul operasional. |

## 2. Peta seluruh halaman

| Kelompok | Halaman | ID navigasi internal | Status |
| --- | --- | --- | --- |
| Absensi & uang makan | Ringkasan Kehadiran | `overview` | Terimplementasi di FE |
| Absensi & uang makan | Impor Sumber | `import` | Terimplementasi di FE |
| Absensi & uang makan | Rekonsiliasi | `reconcile` | Terimplementasi di FE |
| Absensi & uang makan | Pencocokan Identitas | `identity` | Terimplementasi di FE |
| Absensi & uang makan | Uang Makan | `meal` | Terimplementasi di FE |
| Kepegawaian | People Dashboard | `dashboard` | Terimplementasi di FE |
| Kepegawaian | Data Pegawai | `employees` | Terimplementasi di FE |
| Kepegawaian | Tambah Data | `add` | Terimplementasi di FE |
| Komunikasi & rencana | Automation Center | `automation` | UI simulasi + indikator dari roster/rekonsiliasi |
| Komunikasi & rencana | Peta Fitur & Data | `ideas` | Dokumentasi interaktif dan rancangan |

Navigasi menggunakan state React dalam satu aplikasi, belum menggunakan URL terpisah per halaman. Bila belum ada file sumber, aplikasi mengarahkan tampilan awal ke Impor Sumber.

## 3. Fitur umum aplikasi

- Sidebar dengan kelompok menu, penanda menu aktif, jumlah isu rekonsiliasi dan identitas yang perlu perhatian.
- Menu untuk layar kecil dengan tombol buka/tutup dan overlay.
- Pemilih periode global untuk analisis absensi dan uang makan.
- Input nama reviewer global, dipakai saat menyimpan keputusan.
- Indikator jumlah file sumber dan pegawai yang terbentuk.
- Loading state saat memuat penyimpanan, empty state saat data belum ada, dan notifikasi toast.
- Drawer untuk detail profil, hari, kasus, dan uang makan; animasi perpindahan halaman.
- Format angka, rupiah, dan tanggal Indonesia; grafik dan tabel yang dapat digulir.
- Tombol hapus seluruh data lokal dengan konfirmasi.

**Catatan periode:** daftar bulan dibentuk dari bukti absensi selain surat tugas, dengan minimal 20 catatan per bulan. Periode pilihan yang masih valid dipertahankan; bila belum dipilih, sistem memprioritaskan bulan yang cocok dengan awal periode sumber daring, lalu bulan terbaru yang tersedia.

## 4. Impor Sumber

**Tujuan:** memasukkan file yang digunakan pada proses rekap absensi tanpa harus menyusun ulang seluruh sumber ke satu template.

### Interaksi yang tersedia

- Unggah banyak file Excel `.xls` dan `.xlsx` melalui pemilih file atau drag and drop.
- Deteksi jenis format dari isi workbook; nama file dan isi header membantu menentukan kantor asal.
- Hasil berhasil/gagal per file, pesan format tidak dikenali, dan jumlah baris hasil baca.
- File baru dengan nama sama menggantikan file sumber sebelumnya.
- Daftar file dengan rincian sumber, periode, statistik, dan peringatan parsing.
- Koreksi kantor asal file dan penghapusan file sumber individual.
- Matriks cakupan sumber per kantor: mesin, aplikasi HP, rekap manual/laporan, surat tugas, dan jumlah pegawai.
- Penanda kantor yang hanya terpantau dari aplikasi HP.

### Enam format sumber yang memiliki parser

| Format | Isi yang diolah |
| --- | --- |
| Ekspor mesin harian | Scan masuk/pulang atau clock in/out, identitas, pengecualian, jadwal, dan lembur yang tersedia. |
| Presensi daring/aplikasi HP | WFO/WFA, jam, lokasi, koordinat, status Approved/Reject, dan identitas aplikasi. |
| Matriks transaksi Kanwil | Nama/nomor mesin × tanggal, termasuk sel rentang jam. |
| Jadwal absen manual Kanwil | Sheet bulanan, jam masuk/pulang, keterangan dinas, WFA, sakit, dan absen error. |
| Daily Attendance Checking Report | Kode harian tanpa jam, mengikuti interpretasi legenda format terkait. |
| Rekap surat tugas sekretaris | Nomor/tanggal surat, nama peserta, tanggal kegiatan, tujuan, dan unit yang tersedia. |

### Penanganan variasi data

- Pembacaan tanggal numerik Excel dan variasi urutan hari/bulan pada format yang dikenali.
- Koreksi header tanggal tertukar pada matriks Kanwil berdasarkan periode laporan.
- Parsing rentang tanggal kegiatan berbahasa Indonesia, termasuk lintas bulan dan tahun yang diambil dari konteks surat.
- Pemecahan beberapa nama dalam rekap surat tugas sesuai format sumber.
- Peringatan file yang namanya menyerupai register ST tetapi isinya jadwal absensi.
- Deteksi heuristik ekspor mesin yang belum lengkap agar data yang terpotong tidak langsung diperlakukan sebagai TK.

**Batas:** dukungan ini khusus pola yang memiliki parser; bukan jaminan dapat membaca sembarang format Excel. Unggah folder rekursif dan pengambilan otomatis dari mesin/API belum tersedia.

## 5. Pencocokan Identitas

**Tujuan:** membentuk satu profil pegawai dari identitas yang berbeda antarsumber.

- Pencocokan berjenjang menggunakan NIP, NIKA/ID aplikasi, nomor mesin per kantor, kemiripan nama, dan keputusan manual HR.
- Normalisasi nama dengan dukungan singkatan, inisial, serta toleransi kemiripan/salah ketik pada logika pencocokan.
- KPI jumlah pegawai, pegawai dengan/tanpa NIP, nama ST yang tertaut, kandidat ambigu, dan nama yang tidak ditemukan.
- Panel konflik identitas, termasuk orang yang diduga sama dengan NIP berbeda.
- Pilihan menggabungkan profil memakai salah satu identitas atau menandai sebagai orang berbeda.
- Tab surat tugas perlu keputusan, pegawai tanpa NIP, dan tautan otomatis/diabaikan.
- Kandidat pegawai beserta skor kecocokan; pencarian alternatif berdasarkan nama, NIP, atau alias.
- Tautkan nama surat tugas ke pegawai, abaikan nama yang bukan pegawai, gabungkan identitas absensi, atau konfirmasi sebagai pegawai tersendiri.
- Pembatalan keputusan pada tautan yang memiliki kontrol tersebut.
- Keputusan disimpan lokal dengan reviewer dan waktu; dipakai kembali dalam pembentukan roster.

**Batas:** skor nama adalah bantuan peninjauan. Keputusan lokal ini belum merupakan data alias terpusat yang dibagikan antarpengguna.

## 6. Rekonsiliasi Absensi

**Tujuan:** menentukan status satu pegawai per hari dari gabungan bukti, lalu menyediakan antrean keputusan manusia.

### Antrean isu

- Pengelompokan isu serupa per pegawai menjadi kasus untuk tanggal berurutan, termasuk jeda akhir pekan tertentu.
- Urutan prioritas tingkat tinggi, sedang, rendah; indikator risiko dan status terbuka/selesai.
- Filter jenis isu, kantor, tingkat keparahan, status penyelesaian, serta pencarian nama/NIP/unit.
- Detail kasus berisi pegawai, tanggal, tingkat risiko, dampak terhadap uang makan, dan bukti per hari.
- Keputusan sesuai jenis kasus: akui dinas, akui hadir, nyatakan tidak sah/tidak hadir, atau tandai sudah ditinjau.
- Catatan keputusan, reviewer, waktu, penerapan keputusan untuk beberapa hari dalam satu kasus, dan pembatalan keputusan.
- Status harian dan uang makan dihitung ulang setelah keputusan berubah.

### Jenis isu yang dideteksi engine

| Isu | Penanganan yang tersedia |
| --- | --- |
| Dinas tetapi scan di kantor | Tampilkan benturan; akui dinas atau hadir. Hari berangkat/pulang dibedakan tingkatnya. |
| Cuti/sakit tetapi ada jam hadir | Pertahankan keterangan atau akui kehadiran. |
| ST tumpang tindih | Tinjau surat berbeda pada hari sama dan kemungkinan peralihan perjalanan. |
| PD tanpa ST yang mencakup tanggal | Ditandai bila register ST kantor tersedia. |
| ST tanpa nomor | Minta konfirmasi dasar penugasan. |
| Presensi daring ditolak | Tampilkan status Reject bila belum ada bukti hadir pengganti yang sesuai. |
| Scan tidak lengkap | Tampilkan bukti masuk/pulang yang belum lengkap. |
| WFO jauh dari titik kantor | Hitung jarak terhadap titik perkiraan dari kumpulan koordinat WFO yang disetujui. |
| Jam sama dengan hari sebelumnya | Tandai indikasi salin-tempel dari rekap manual. |
| Jam manual / Absen Eror | Minta peninjauan bukti pendukung. |
| Jadwal puasa di luar rentang konfigurasi | Tandai jadwal tidak sesuai dan gunakan logika jadwal normal. |
| Hadir pada hari libur | Informasi untuk pemeriksaan lembur/SPKL. |
| WFA saat perjalanan dinas | Informasi benturan presensi daring dengan dinas. |

Tidak semua isu otomatis menahan uang makan. Engine memakai penanda `blocksMeal`, status hari, dan aturan aktif.

### Matriks harian

- Tampilan pegawai × tanggal satu bulan dengan kode status berwarna dan legenda.
- Filter kantor, pencarian pegawai, hanya pegawai berisu, atau hanya pegawai dengan TK.
- Penanda akhir pekan dan isu terbuka; paginasi 50 pegawai.
- Klik sel untuk melihat detail hari dan melakukan peninjauan isu terkait.

### Detail bukti harian

- Status akhir dan dasar penentuannya.
- Sumber, jam masuk/pulang, kode, WFO/WFA, Approved/Reject, lokasi/koordinat yang tersedia, serta jadwal.
- Nama file dan rujukan baris/sheet untuk penelusuran kembali.
- ST terkait beserta nomor, rentang tanggal, tujuan, dan nama yang tertulis di sumber.
- Menit terlambat, pulang cepat, lembur tercatat, alasan uang makan, dan keputusan lokal.

**Status harian yang dikenal:** hadir, hadir WFA, dinas lokal, dinas luar, diklat/konsinyering, cuti, sakit, izin, tidak lengkap, tanpa keterangan, belum ada data, dan libur.

**Batas:** pendeteksian WFO memakai median koordinat sumber dengan minimal lima titik per lokasi, bukan koordinat kantor resmi yang telah diverifikasi. Keputusan reviewer belum memiliki autentikasi atau audit server yang tidak dapat diubah.

## 7. Ringkasan Kehadiran

- Filter kantor dengan periode global.
- KPI pegawai terpantau, persentase hadir/bertugas, hari perjalanan dinas, TK, bukti tidak lengkap, dan isu perlu ditinjau.
- Grafik batang bertumpuk per hari kerja; dapat diganti ke tabel angka harian.
- Komposisi hadir kantor, WFA, dinas/diklat, cuti/sakit/izin, serta TK/tidak lengkap.
- Rekap per unit: jumlah pegawai, tingkat hadir/bertugas, keterlambatan, TK, dan dinas; diurutkan dari tingkat hadir terendah.
- Pantauan disiplin bulanan untuk pegawai dengan TK/keterlambatan; tautan ke profil.
- Akumulasi jam lembur tercatat per kantor sebagai kandidat pemeriksaan SPKL.
- Insight ekspor belum lengkap, proporsi WFA Jumat, kantor hanya dari HP, dan keterlambatan.

**Batas:** indikator memakai data periode dan cakupan sumber yang tersedia. Pantauan disiplin belum menghitung sanksi atau akumulasi tahunan; jam lembur belum menjadi perhitungan pembayaran lembur.

## 8. Uang Makan

### Perhitungan dan peninjauan

- Perhitungan per pegawai per hari dari hasil rekonsiliasi.
- Tiga hasil kelayakan: dibayar, ditahan, atau tidak memenuhi syarat, masing-masing dengan alasan.
- Rekap hari uang makan, hari ditahan, tarif, bruto, PPh, dan netto.
- KPI total netto/bruto/PPh, hari dibayar, hari ditahan, dan hari gugur karena terlambat.
- Pencarian nama/NIP/unit, filter kantor, dan pengurutan nama, hari UM, hari ditahan, atau netto.
- Detail pegawai dengan status, jam, alasan, nominal, dan bukti per hari.
- Peringatan penerima tanpa NIP dan pegawai dengan golongan/tarif yang masih diasumsikan.
- Penahanan untuk ekspor belum lengkap, isu tertentu, dan Non-ASN sesuai kondisi aturan.

### Aturan yang dapat diubah melalui UI

- Wajib scan masuk dan pulang.
- Wajib tepat waktu beserta toleransi keterlambatan.
- Pulang cepat menggugurkan kelayakan.
- WFA dihitung atau tidak.
- Dinas lokal yang diperlakukan sebagai ≤8 jam dihitung atau tidak.
- Penahanan hari dengan isu terbuka yang memblokir pembayaran.
- Penyertaan Non-ASN.
- Tarif/PPh kelompok I–IV, kelompok default untuk golongan kosong, dan daftar hari libur.
- Tiga preset dengan pratinjau dampak total hari dan netto: tepat waktu lengkap; scan lengkap tanpa syarat tepat waktu; toleransi 15 menit.

### Nilai awal di kode, bukan penetapan kebijakan resmi

| Kelompok tarif | Tarif/hari | PPh |
| --- | ---: | ---: |
| I | Rp35.000 | 0% |
| II | Rp35.000 | 0% |
| III | Rp37.000 | 5% |
| IV | Rp41.000 | 15% |

Default: scan lengkap, tepat waktu tanpa toleransi, tidak pulang cepat, WFA/dinas lokal dihitung, tahan isu pemblokir, Non-ASN belum dibayar, kelompok kosong memakai III. Kode memiliki pemetaan golongan PNS/PPPK ke kelompok tarif. Seluruh nilai, pemetaan, kalender, dan interpretasi kelayakan perlu disahkan HR/Keuangan sebelum dipakai membayar.

### Ekspor Excel

Tombol unduh menghasilkan workbook `.xlsx` berdasarkan baris hasil filter, berisi:

1. **Nominatif:** identitas, golongan, kehadiran, hari UM/ditahan, tarif, bruto, PPh, netto, dan catatan.
2. **Rincian Harian:** status, jam, keterlambatan, kelayakan, alasan, nominal, dasar, dan sumber.
3. **Ditahan:** tanggal, alasan penahanan, dan detail isu.
4. **Parameter:** aturan/tarif yang digunakan saat ekspor.

**Batas:** belum ada persetujuan Keuangan, penguncian periode, bukti pembayaran, atau transfer. Sumber yang hanya menyebut hadir tanpa jam dapat lolos perhitungan dengan catatan ketepatan waktu tidak dapat diperiksa. Dinas lokal mengikuti klasifikasi data, bukan pengukuran durasi perjalanan otomatis.

## 9. People Dashboard

- Total pegawai dan komposisi PPPK/PNS/Non-ASN/status belum diketahui.
- Jumlah kantor, rata-rata usia dari tanggal lahir yang tersedia, serta rasio laki-laki/perempuan.
- Sebaran pegawai per unit (delapan unit terbesar) dan per kantor.
- Distribusi usia <30, 30–39, 40–49, dan 50+.
- Kelengkapan NIP, golongan, jabatan, WhatsApp, agama, email, dan tanggal lahir.
- Daftar ulang tahun dalam 30 hari; tampilkan sampai lima pegawai dengan hitung mundur dan akses profil.
- Tautan ke direktori, tambah/lengkapi data, dan Automation Center.
- Penurunan field tertentu dari struktur NIP, termasuk tanggal lahir, jenis kelamin, dan status kepegawaian; profil memberi label field turunan.

**Batas:** ini statistik roster yang terbentuk dari sumber/master, bukan jaminan seluruh pegawai KPPU telah terdaftar atau datanya lengkap.

## 10. Data Pegawai

- Direktori dengan pencarian nama, NIP, NIKA, unit, dan alias.
- Filter kantor/status kepegawaian, urutan nama, dan tombol tampilkan lebih banyak.
- Daftar menampilkan identitas, variasi nama, kantor/unit, status, dan sumber pembentuk profil.
- Drawer profil memuat NIP/NIKA, tanggal lahir/usia, jenis kelamin, status, golongan, WhatsApp, agama, dan penanda data turunan.
- Edit terbatas dari profil: NIP, golongan, jabatan, nomor WhatsApp, email, dan agama.
- Ringkasan kehadiran periode aktif: strip harian, hadir, dinas, TK, terlambat, netto uang makan, serta tautan isu pegawai.
- Alias lintas sumber dikelompokkan menjadi NIP, NIKA, ID aplikasi, nomor mesin, dan nama tertulis.
- Daftar ST periode terkait pada kondisi tampilan yang didukung.
- Informasi master tambahan bila tersedia: pendidikan, disiplin ilmu, pelatihan, alamat, dan kontak darurat.

**Batas:** belum ada hapus pegawai individual, riwayat mutasi formal, pengelolaan berkas personal, atau CRUD penuh semua field lewat drawer profil.

## 11. Tambah Data dan Master Pegawai

### Bulk import

- Unduh template Excel dengan sheet master dan petunjuk.
- Baca `.xlsx`, `.xls`, atau `.csv`; memakai sheet pertama sebagai data master.
- Pemetaan header sesuai template/nama field dengan normalisasi penulisan.
- Konversi tanggal Excel/teks dan pemisahan daftar pelatihan memakai koma/titik koma.
- Pratinjau jumlah baris, perkiraan cocok/baru, dan contoh delapan baris.
- Simpan melalui upsert: perbarui pegawai yang ditemukan atau tambahkan master baru; tampilkan jumlah hasil.
- Pencocokan utama menggunakan NIP/alias NIP, NIKA, lalu nama dengan kondisi tertentu. Proses simpan juga mempertimbangkan kantor saat mencocokkan nama tanpa NIP.

### Cakupan kolom template

NIP, NIKA, nama, kantor, unit, status kepegawaian, golongan, jabatan, tanggal/tempat lahir, jenis kelamin, agama, WhatsApp, email, pendidikan, disiplin ilmu, pelatihan, tanggal mulai kerja, alamat, nama/nomor kontak darurat, dan status perkawinan.

### Input manual

- Form identitas: nama, NIP, NIKA, tanggal/tempat lahir, agama, WhatsApp, dan email.
- Form kepegawaian: kantor, unit, status, golongan, jabatan, dan tanggal mulai kerja.
- Nama wajib; NIP jika diisi harus 18 digit; penyimpanan dapat memperbarui pegawai yang sudah ada.

**Batas:** field template lebih luas daripada form manual. Validasi belum menyeluruh; impor master belum memiliki validasi setara server/HRIS. UI menyatakan workbook `Dashboard_Data_Pegawai_KPPU_V3.xlsx` sebagai contoh sintetis; jangan menganggapnya master resmi tanpa verifikasi.

## 12. Automation Center — Simulasi

### UI yang tersedia

- QR dan status koneksi demo, tombol simulasi koneksi/disconnect.
- Daftar aturan dengan toggle aktif/nonaktif dan filter publik, tersegmentasi, personal.
- Pemilihan template, pratinjau isi pesan, dan token placeholder.
- Penanda privasi untuk pesan sensitif; template mengarahkan rincian gaji/klaim ke portal resmi.
- Statistik dari data lokal: pegawai dengan tanggal lahir, hari dengan scan masuk tanpa pulang, kelengkapan WhatsApp/agama.
- Antrean ulang tahun 30 hari ke depan, menampilkan sampai enam pegawai.
- Tombol simulasi pratinjau dengan notifikasi bahwa tidak ada pesan dikirim.

### Lima belas aturan/template yang sudah ada

| Template | Jangkauan |
| --- | --- |
| Pengingat lupa scan pulang | Personal |
| Presensi daring ditolak | Personal |
| Ucapan ulang tahun | Personal |
| Hari raya keagamaan | Tersegmentasi |
| Apresiasi masa kerja | Personal |
| Learning gap reminder | Tersegmentasi |
| Konfirmasi data berkala | Personal |
| Notifikasi perubahan jabatan | Personal |
| Perubahan hari/jam kerja | Publik |
| Informasi keselamatan | Tersegmentasi |
| Pengingat e-Kinerja & SPT | Tersegmentasi |
| Ucapan kelahiran anak | Personal |
| Ucapan belasungkawa | Personal |
| Slip gaji tersedia | Personal |
| Pembaruan klaim kesehatan | Personal |

**Batas penting:** tidak ada sesi WhatsApp nyata, scheduler, evaluasi trigger operasional, pengiriman, delivery status, atau antrean pesan backend. Toggle dan koneksi disimpan sebagai state komponen sehingga kembali ke awal saat halaman dilepas/dimuat ulang. Template gaji, klaim, pelatihan, dan kinerja tidak berarti modul transaksi tersebut sudah tersedia. Pratinjau memakai contoh data/placeholder; belum ada composer bebas dan pemilihan penerima operasional.

## 13. Peta Fitur & Data

- Tabel temuan variasi sumber, dampaknya, dan penanganan dalam prototype.
- Delapan kartu usulan pengembangan dengan kebutuhan data, manfaat, dan kontrol.
- Ringkasan rancangan tabel database beserta referensi DDL.
- Alur demo lima langkah dengan tombol menuju halaman terkait.

**Batas:** temuan di halaman ini adalah narasi statis dari sampel sumber, bukan hasil audit otomatis terhadap unggahan terbaru. Label seperti “Data sudah ada”, “Mudah”, atau “Dampak terbesar” pada usulan bukan tanda fitur telah selesai.

## 14. Penyimpanan, arsitektur, dan integrasi

| Bagian | Kondisi saat ini |
| --- | --- |
| Stack | React, TypeScript, Vite; Recharts, Framer Motion, Lucide, SheetJS, QR renderer. |
| Pemrosesan | Parser, pencocokan identitas, rekonsiliasi, dan kalkulasi berjalan di browser. |
| Penyimpanan | IndexedDB `kppu-hr`, store `kv`, key `state-v1`. |
| Data tersimpan | Sumber terurai, master, override profil, keputusan identitas, resolusi isu, kebijakan UM, reviewer, dan periode. |
| Hitung ulang | Roster/rekonsiliasi diturunkan dari state; berubah ketika sumber, keputusan, periode, atau kebijakan berubah. |
| Integrasi input/output | Baca file lokal dan unduh workbook Excel. |
| Database server | Ada rancangan `docs/rancangan-database.sql`; bukan bukti database tersebut telah diterapkan. |
| Hosting | Ada konfigurasi build dan fallback SPA Netlify; URL/revisi deploy aktif belum diverifikasi dalam dokumen ini. |
| Backend/API | Belum menjadi jalur operasional pada state aplikasi yang diperiksa. |

Data browser tidak otomatis sama di perangkat, profil browser, atau origin yang berbeda. Penghapusan penyimpanan browser dapat menghilangkan data lokal. Dokumen ini tidak menyertakan isi data pribadi pegawai.

## 15. Fitur yang masih berupa rencana atau belum lengkap

| Area | Yang sudah menjadi fondasi | Pekerjaan yang belum tersedia |
| --- | --- | --- |
| Backend dan akses | Model frontend, nama reviewer lokal, rancangan SQL | Login, RBAC, API, database server, multiuser, audit terpusat. |
| Persetujuan uang makan | Kalkulasi, peninjauan isu, ekspor | Approval berjenjang, snapshot/penguncian periode, pembayaran. |
| Surat tugas | Parser rekap dan penautan pegawai | Register digital, form penerbitan, penomoran unik, persetujuan ST. |
| Uang lembur | Jam lembur dan indikator hadir hari libur | Validasi SPKL, aturan/tarif, kalkulasi dan nominatif lembur. |
| SPD/uang harian | Isu benturan ST dengan absensi | Pengelolaan SPD dan rekonsiliasi transaksi uang harian. |
| Disiplin tahunan | Pantauan TK/keterlambatan per bulan | Akumulasi tahunan dan alur pembinaan/persetujuan formal. |
| Sinkronisasi absensi | Unggah file manual | Koneksi API mesin/aplikasi, jadwal sinkronisasi, log sinkronisasi. |
| Lokasi dan kalender | Deteksi jarak WFO, libur dan jadwal awal | Master titik kantor resmi, kalender terpusat dengan otorisasi, kontrol lintas sistem. |
| Komunikasi | UI, indikator kesiapan, dan 15 template | Provider WA, sesi persisten, scheduler, consent/penerima, retry, log pengiriman. |
| HR lanjutan | Field profil dan template notifikasi | Modul payroll/slip, klaim, LMS/gap kompetensi, e-Kinerja/SPT, dan portal pegawai. |

## 16. Alur penggunaan yang sudah dapat dirangkai

1. Buka **Impor Sumber**, unggah file absensi dan rekap ST yang didukung.
2. Periksa jenis/kantor sumber, peringatan parser, dan kelengkapan cakupan kantor.
3. Buka **Pencocokan Identitas**, putuskan nama ambigu, konflik, atau profil tanpa NIP.
4. Lengkapi master melalui **Tambah Data** atau **Data Pegawai**.
5. Pilih periode dan isi nama reviewer.
6. Buka **Rekonsiliasi**, periksa bukti, beri keputusan dan catatan.
7. Tinjau **Ringkasan Kehadiran** dan **People Dashboard**.
8. Buka **Uang Makan**, sesuaikan aturan yang telah disepakati, periksa hari ditahan/asumsi golongan, lalu unduh nominatif.
9. Gunakan **Automation Center** untuk mendemokan template dan kesiapan data komunikasi.

## 17. Panduan konteks untuk AI berikutnya

Saat melanjutkan pengembangan, gunakan batas berikut:

- Proyek aktif adalah `hr_kppu/kppu-hr-dashboard-demo`; `hr_kppu/_backup_prototype_v0` adalah prototype lama.
- Sudah ada engine frontend yang mengolah file sumber; pertahankan alur impor, identitas, bukti, keputusan, dan kalkulasi yang saling terhubung.
- Jangan menyebut WA sudah terintegrasi, database sudah produksi, reviewer sudah login, atau nominal UM sudah sah hanya karena UI/rancangannya tersedia.
- Bedakan data sumber, field hasil penurunan NIP, override master, keputusan reviewer, dan nilai asumsi/default.
- Jangan menyimpulkan jumlah pegawai atau progres produksi dari angka statis pada narasi demo.
- Jika diminta kesiapan operasional, verifikasi runtime/deploy dan kebijakan resmi; dokumen ini adalah snapshot implementasi lokal.

### Peta kode untuk melanjutkan pekerjaan

| Kebutuhan | Lokasi |
| --- | --- |
| Navigasi dan shell | `src/App.tsx` |
| Sepuluh halaman | `src/pages/*.tsx` |
| State, impor, keputusan, persistensi | `src/state/HrData.tsx`, `src/state/idb.ts` |
| Deteksi format dan parser | `src/engine/parse.ts`, `src/engine/parsers/` |
| Identitas dan roster | `src/engine/roster.ts`, `names.ts`, `ids.ts` |
| Rekonsiliasi dan UM | `src/engine/reconcile.ts`, `policy.ts`, `dates.ts` |
| Bukti harian dan komponen umum | `src/components/DayDetail.tsx`, `ui.tsx` |
| Pembacaan/ekspor Excel | `src/lib/xlsx.ts` |
| Rancangan database | `docs/rancangan-database.sql` |

Untuk memperbarui snapshot, baca ulang kode terkait dan ubah tanggal serta status fitur sesuai bukti terbaru.
