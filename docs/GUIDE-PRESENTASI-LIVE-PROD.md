# Panduan Presentasi Website Produksi KPPU HR

Tanggal: 18 November 2026  
Website: <https://absensi-kkpu.onrender.com/>  
Durasi utama: sekitar 25 menit  
Audiens: SDM, Keuangan, pimpinan, dan perwakilan Kanwil

## 1. Cerita yang ingin disampaikan

> “Aplikasi ini menghimpun catatan kerja seluruh pegawai KPPU dalam satu bulan. Mesin Offline, Mesin Online, dan Surat Tugas ditampilkan agar admin dapat memeriksa aktivitas pegawai per hari. Setelah bukti dan status harinya disahkan, aplikasi menghitung uang makan sesuai status kepegawaian, golongan, dan aturan yang berlaku.”

Client perlu memahami empat hal setelah presentasi:

1. Satu bulan mencakup Pusat dan seluruh Kanwil dalam satu proses KPPU.
2. Tiga jenis sumber membantu menjelaskan seluruh hari kerja pegawai. Jumlah file bisa lebih dari tiga karena sumber dan register ST dapat berasal dari beberapa kantor.
3. Admin menetapkan bukti dan status harian yang sah. Ketiga sumber berkedudukan setara.
4. Hasil UM tampil progresif dari hari yang telah sah dan memenuhi syarat. Pengajuan final memiliki persyaratan tambahan.

## 2. Persiapan sebelum client masuk

Lakukan persiapan sekitar 15 menit sebelum jadwal presentasi.

1. Buka website dan tunggu hingga halaman login atau ruang kerja tampil. Buka lebih awal agar waktu pemuatan layanan selesai sebelum sesi.
2. Masuk dengan akun Admin/SDM yang cakupannya seluruh kantor. Untuk bagian persetujuan, siapkan akun Keuangan berbeda pada profil browser lain.
3. Tentukan periode yang sudah memiliki data. Untuk demo ini pakai **April 2026**, karena dataset demo di produksi ada di bulan itu (lihat bagian Data demo di produksi di bawah).
4. Periksa **Impor Sumber**: Mesin Offline, Mesin Online, dan ST Pusat serta Kanwil I sampai VII harus siap untuk membuka rekonsiliasi.
5. Pilih satu pegawai dengan bukti lengkap, satu pegawai dengan isu, dan satu hari tanpa bukti jika tersedia. Catat nama dan tanggalnya pada lembar persiapan di bawah.
6. Buka **Uang Makan** untuk mengetahui kondisi aktual: bruto sudah muncul, tarif pending, atau PPh/netto belum ditetapkan. Gunakan kondisi tersebut dalam narasi.
7. Untuk demonstrasi menyimpan keputusan, gunakan catatan latihan yang telah disepakati. Setiap penyimpanan pada website produksi mengubah ruang kerja bersama.
8. Bila akan mengubah data latihan, unduh **backup ruang kerja** sebelum sesi. Backup JSON tidak mencakup seluruh berkas workbook asli.

Paket latihan lokal yang pernah dibuat tersedia di [folder dummy manual](../artifacts/dummy-manual-e2e-2026-09/README.md). Keberadaan folder tersebut tidak berarti seluruh datanya telah diunggah ke produksi.

Variasi 8 pegawai dan 15 jenis isu yang baru ditambahkan berada pada demo Netlify, bukan di produksi. Produksi punya dataset demo sendiri, dijelaskan di bawah.

### Catatan teknis: website produksi di Render Free

Produksi berjalan di Render Free (RAM 512 MB, CPU 0,1) di Singapura, jadi ada beberapa hal praktis yang perlu diingat presenter.

- **Buka 1 sampai 2 menit sebelum mulai.** Website tertidur setelah 15 menit tanpa akses, dan bangun lagi (cold start) butuh sekitar 1 menit. Bila jeda sejak terakhir dibuka lebih dari 15 menit, muat ulang lagi sebelum sesi.
- **Menyimpan unggahan atau keputusan clash pada bulan yang penuh bisa makan 20 sampai 60 detik.** Tunggu sampai status tersimpan muncul. Jangan klik dua kali.
- **Jika muncul 502**, tunggu sekitar satu menit lalu muat ulang halaman. Data aman di database.

### Data demo di produksi

Produksi sekarang berisi dataset demo: master pegawai sintetis (386 orang; hanya nama dan NIP/NI PPPK yang asli, field lain sintetis) dan sumber April 2026 per pekan (Mesin Offline, Mesin Online, Rekap ST) untuk pekan 1 sampai 5. Pilih periode **April 2026**. Tiga pegawai berikut cocok sebagai contoh:

| Pegawai | Yang ditunjukkan | Angka acuan |
| --- | --- | --- |
| Cepi Sumantri | Pegawai bersih tanpa isu. | 21 hari UM, Rp 735.000 |
| Fitri Ayundhani | Clash terbuka pada 13 April 2026. Setelah admin memilih **Akui hadir**, UM naik. | Rp 518.000 menjadi Rp 555.000 |
| Rifqi Maulana | Pada 8 April hanya ada jam pulang 18:48, tanpa jam masuk, jadi hari itu tidak dapat UM. | Total Rp 665.000 |

Semua angka di tabel adalah **angka acuan, cocokkan saat demo**. Catat angka yang benar-benar tampil pada lembar persiapan di bawah. Memutuskan clash Fitri mengubah data bersama (lihat langkah 7 di atas), jadi putuskan sebelum sesi apakah keputusannya akan benar-benar disimpan.

### Lembar persiapan presenter

| Yang perlu dicatat | Isi sebelum presentasi |
| --- | --- |
| Periode yang dipilih | … |
| Jumlah pegawai yang terlihat | … |
| Jumlah hari kerja pada periode | … |
| Pegawai dengan hari valid dan UM tersedia | … |
| Pegawai/tanggal dengan konflik sumber | … |
| Pegawai/tanggal terlambat | … |
| Pegawai/tanggal tanpa check-out | … |
| Pegawai/tanggal WFA | … |
| Pegawai/tanggal dinas | … |
| Pegawai/tanggal tanpa bukti | … |
| Kondisi parameter tarif dan PPh/netto | … |
| Pengajuan/snapshot yang sudah ada | … |

Jika suatu contoh belum tersedia, gunakan penjelasan kasus pada bagian 6 tanpa menyebutnya sebagai kejadian dalam data produksi.

## 3. Urutan presentasi 25 menit

| Menit | Halaman | Fokus |
| --- | --- | --- |
| 0 sampai 2 | Login dan pemilih periode | Satu konteks bulan untuk seluruh KPPU. |
| 2 sampai 5 | Impor Sumber | Kelengkapan tiga jenis sumber dan cakupan ST per kantor. |
| 5 sampai 7 | Pencocokan Identitas | Satu orang ditautkan melalui identitas yang tepat. |
| 7 sampai 13 | Rekonsiliasi | Matriks, bukti harian, isu, dan keputusan admin. |
| 13 sampai 17 | Uang Makan | Kelayakan, tarif, hasil progresif, rincian, dan ekspor. |
| 17 sampai 19 | Pengajuan pada Uang Makan | Syarat final, pemeriksa berbeda, dan snapshot. |
| 19 sampai 22 | Ringkasan Kehadiran, People Dashboard, Data Pegawai | Pemantauan dan profil pegawai. |
| 22 sampai 24 | Tambah Data, Automation Center, Ruang Kerja & Akses | Pelengkapan master, komunikasi, dan administrasi. |
| 24 sampai 25 | Peta Fitur & Data dan penutup | Cakupan produk dan pertanyaan client. |

## 4. Pembukaan: login dan periode

**Yang diklik**

1. Buka website produksi dan masuk menggunakan akun yang disiapkan.
2. Tunjukkan identitas/peran pengguna di bagian atas.
3. Pada **Periode KPPU**, pilih bulan presentasi.
4. Tunggu status penyimpanan selesai. Bila paket bulan itu belum lengkap, aplikasi mengarahkan Admin/SDM ke **Impor Sumber**.

**Narasi**

> “Kita mulai dengan memilih bulan yang akan dikelola. Semua sumber, rekonsiliasi, dan hasil uang makan mengikuti bulan ini. Kantor dipakai untuk melihat asal data dan cakupan ST, sedangkan proses bulanan mencakup seluruh KPPU.”

> “Jumlah hari kerja mengikuti kalender bulan yang dipilih. Karena itu, targetnya tidak selalu 22 hari.”

**Tunjukkan pada layar:** periode aktif, peran akun, dan status penyimpanan.

## 5. Impor Sumber dan Pencocokan Identitas

### A. Tunjukkan kelengkapan paket bulanan

**Yang diklik**

1. Buka **Impor Sumber**.
2. Tunjukkan checklist **Mesin Offline**, **Mesin Online**, dan **ST** setiap kantor.
3. Tunjukkan tabel **Cakupan sumber per kantor** serta periode sumber yang telah masuk.
4. Tunjukkan tombol **Lanjut ke rekonsiliasi**. Jelaskan mengapa tombol aktif atau belum aktif sesuai kondisi layar.

**Narasi**

> “Pegawai yang sering dinas tetap memiliki aktivitas kerja meskipun jarang tercatat di mesin kantor. Karena itu, sumber dikumpulkan untuk menjelaskan aktivitas sepanjang bulan.”

> “ST diperiksa per kantor agar penugasan Pusat dan setiap Kanwil tercakup. Bila suatu kantor memang tidak memiliki penugasan, petugas mencatat pernyataan nihil berdasarkan konfirmasi kantor tersebut.”

> “Paket lengkap berarti sumber dan cakupannya siap diperiksa. Status setiap hari tetap memerlukan keputusan admin.”

### B. Tunjukkan proses upload bila diperlukan

Untuk presentasi yang datanya sudah lengkap, cukup jelaskan file yang telah tercatat. Bila ingin menunjukkan upload dengan berkas latihan yang sudah disiapkan:

1. Klik area upload dan pilih berkas sumber.
2. Pada preview, tunjukkan jenis sumber, periode, kantor, jumlah baris, dan catatan pembacaan.
3. Jelaskan **Perlakuan data**: menambah sumber, mengganti dataset lengkap, atau memilih register ST sesuai jenis sumber.
4. Untuk register yang memang telah dikonfirmasi lengkap, isi **Lengkap sampai** sesuai akhir periode.
5. Isi **Alasan impor / dasar kelengkapan**, lalu klik **Hitung diff & dampak**.
6. Tunjukkan baris yang ditambah/berubah serta dampaknya pada hari dan nominal UM.
7. Bila sesi hanya untuk menunjukkan preview, pilih **Batalkan**. Jika berkas latihan memang akan dimasukkan, periksa konfirmasi sebelum menyimpan.

**Narasi**

> “Petugas melihat hasil pembacaan dan dampak perubahan sebelum mengaktifkan sumber. Revisi data dapat membuat keputusan harian lama perlu diperiksa ulang.”

Jika isi file identik dengan yang sudah tersimpan, jelaskan bahwa sistem mengenalinya sebagai duplikat. Mengganti nama file tidak membuat isinya menjadi sumber baru.

### C. Cocokkan identitas

**Yang diklik**

1. Buka **Pencocokan Identitas**.
2. Tunjukkan urutan identitas yang tersedia, seperti NIP, NIKA/ID aplikasi, nomor mesin dalam konteks kantor, dan nama.
3. Buka bagian **Surat tugas perlu keputusan**, **Pegawai tanpa NIP**, atau **Tautan otomatis**, sesuai data yang tersedia.
4. Bila ada kandidat ambigu, tunjukkan cara membandingkan profil. Simpan mapping hanya setelah identitasnya dipastikan.

**Narasi**

> “Orang yang sama bisa memakai identitas berbeda di setiap sumber. Di sini kita memastikan catatan tersebut masuk ke pegawai yang tepat. Kemiripan nama membantu mencari kandidat; identitas tetap perlu diperiksa sebelum digabung.”

Jika seluruh peserta sudah tertaut, tampilkan hasil tersebut dan lanjutkan. Tidak perlu membuat konflik baru untuk presentasi.

## 6. Rekonsiliasi: bagian utama presentasi

### A. Jelaskan matriks harian

**Yang diklik**

1. Buka **Rekonsiliasi** dengan tampilan **Matriks harian**.
2. Gunakan filter **Semua** untuk memperlihatkan pegawai yang sudah selesai maupun yang masih perlu tindakan.
3. Tunjukkan satu baris pegawai dan kolom tanggalnya.
4. Tunjukkan jumlah **valid**, **flag**, **tidak ditemukan**, dan **target hari-orang**.
5. Klik satu sel tanggal untuk membuka **Detail hari**.

**Narasi**

> “Setiap baris adalah pegawai dan setiap kolom adalah tanggal. Dari sini kita dapat memeriksa apakah seluruh hari kerja sudah memiliki penjelasan.”

| Penanda | Penjelasan untuk client |
| --- | --- |
| Valid | Admin telah memilih bukti dan menetapkan status aktivitas hari tersebut. |
| Flag | Bukti masih menunggu keputusan atau memiliki isu yang perlu diselesaikan. |
| Tidak ditemukan | Belum ada bukti yang menjelaskan hari tersebut; petugas perlu menelusurinya. |
| Belum berlangsung | Tanggal berada setelah waktu analisis dan belum menjadi hasil kehadiran final. |

> “Flag juga dapat berarti hari belum ditinjau. Hari dengan bukti yang konsisten tetap perlu ditetapkan admin. Hari tanpa bukti tidak otomatis dianggap tanpa keterangan.”

### B. Tunjukkan satu keputusan harian

Gunakan satu kasus yang sudah dicatat saat persiapan.

1. Buka tanggal pegawai tersebut.
2. Pada **Keputusan hari**, bandingkan sumber, jam masuk/pulang, keterangan, rujukan, dan ST yang tersedia.
3. Tunjukkan checkbox **Gunakan** untuk memilih catatan absensi dan ST yang berlaku.
4. Pilih status aktivitas, misalnya **Hadir di kantor**, **Hadir WFA**, atau **Perjalanan dinas**, sesuai bukti.
5. Isi alasan yang menerangkan keputusan, misalnya: `Pasangan scan mesin telah diperiksa; catatan online pada tanggal ini dikonfirmasi keliru.` Gunakan alasan ini hanya jika memang sesuai hasil pemeriksaan.
6. Pada catatan latihan yang akan disahkan, klik **Sahkan hari ini**. Bila mengubah keputusan yang sudah ada, tombolnya **Simpan perubahan keputusan**.
7. Tunggu status tersimpan, lalu tunjukkan perubahan status hari dan hasil perhitungannya.

**Narasi**

> “Mesin Offline, Mesin Online, dan ST berkedudukan setara. Admin membandingkan catatan, memilih bukti yang berlaku, lalu mencatat status dan alasannya. Keputusan tersebut menjadi dasar perhitungan.”

> “Memilih status hadir memerlukan bukti masuk dan pulang yang lengkap dalam satu catatan terpilih. Sistem tidak membuat jam yang belum tersedia.”

Jika hari masih berflag setelah keputusan disimpan, buka isu yang tersisa. Pilihan status hari dan penyelesaian isu perlu sama-sama diperiksa.

### C. Pilih maksimal tiga contoh tambahan

Gunakan contoh yang memang tersedia. Cukup dua atau tiga kasus untuk menunjukkan mekanismenya.

| Contoh | Yang ditunjukkan | Pesan utama |
| --- | --- | --- |
| Telat check-in | Jam masuk, menit keterlambatan, dan alasan UM. | Hari bisa valid sebagai hadir, sementara UM gugur karena ketentuan waktu. |
| Tidak check-out atau tidak check-in | Salah satu jam kosong pada bukti. | Hari itu tidak dapat UM dan alasannya tertulis jelas, misalnya "Hanya ada jam masuk 07:45, tanpa jam pulang; tidak dapat UM". Status hadir tetap tidak boleh disahkan dari pasangan jam yang belum tersedia. |
| Offline + online + ST pada hari sama | Catatan absensi dan daftar ST dalam satu detail hari. | Beberapa sumber tidak otomatis dijumlah menjadi beberapa hari hadir; admin menetapkan aktivitas yang berlaku untuk tanggal itu. |
| WFA | Bukti online dengan mode WFA dan pasangan jam lengkap. | WFA dapat menjadi hari UM setelah divalidasi dan memenuhi ketentuan waktu. |
| Dinas | ST yang mencakup tanggal tersebut. | Hari tetap tercatat sebagai aktivitas dinas; pada aturan aplikasi saat ini dinas tidak masuk UM. |
| ST tumpang tindih | Nomor surat, tujuan, dan rentang tanggal. | Admin memeriksa penugasan yang bertabrakan sebelum menuntaskan hari tersebut. |
| Tidak ada bukti | Sel berstatus tidak ditemukan. | Kekosongan data perlu ditelusuri; status TK memerlukan penetapan. |
| Lokasi online menyimpang atau jam manual | Detail indikasi dan rujukan sumber. | Isu adalah bahan pemeriksaan petugas, bukan vonis otomatis terhadap pegawai. |

Untuk melihat daftar permasalahan menurut kategori, beralih ke **Detail isu**. Tunjukkan filter **Jenis isu**, **Kantor**, dan **Status isu**. Buka satu kasus untuk memperlihatkan bukti serta tindakan pemeriksaannya.

## 7. Uang Makan: hubungkan bukti dengan angka

**Yang diklik**

1. Buka **Uang Makan**.
2. Tunjukkan **Bruto UM terhitung**, **Hari uang makan**, **Hari valid**, dan **Hari ditahan**.
3. Pada **Daftar nominatif**, cari pegawai yang tadi dibuka.
4. Klik barisnya, lalu buka satu tanggal untuk melihat alasan mendapat, tidak mendapat, atau ditahan dari UM.
5. Bandingkan hari hadir biasa, WFA, dinas, atau terlambat yang tersedia pada data.
6. Tunjukkan **Aturan & tarif** bila peran akun mengizinkan. Gunakan nilai yang telah disahkan pada lingkungan presentasi.
7. Klik **Unduh daftar nominatif** untuk menunjukkan keluaran Excel. File mengikuti kantor dan pencarian yang sedang dipakai; kembalikan filter ke seluruh pegawai untuk ekspor seluruh KPPU.

**Narasi**

> “Setelah hari disahkan, aplikasi memeriksa kelayakan uang makannya. Valid sebagai aktivitas kerja dan berhak uang makan adalah dua hal yang berbeda.”

> “Hasil bertambah dari hari yang sudah sah dan memenuhi ketentuan. Petugas dapat melihat hasil yang sudah siap meskipun pemeriksaan hari atau pegawai lain masih berjalan.”

### Aturan jam UM (tetap)

Aturannya sama untuk setiap hari kerja, Senin sampai Jumat: hari kerja mendapat UM hanya bila jam masuk paling lambat 08:00 (tepat 08:00 masih dihitung) **dan** jam pulang paling cepat 16:30. Jadwal yang tertulis di file mesin tidak dipakai, dan jadwal Ramadan tidak lagi dipertimbangkan.

> “Batas jam ini tetap. Di **Aturan & tarif** ia tampil sebagai aturan tetap, tanpa pilihan batas kedatangan dan tanpa saklar pulang cepat.”

Hari yang hanya punya jam masuk atau hanya jam pulang tidak mendapat UM, dengan alasan yang tertulis jelas, misalnya "Hanya ada jam masuk 07:45, tanpa jam pulang; tidak dapat UM". Dua pengecualian tetap berstatus **ditahan**, bukan gugur: clash ketika sumber lain punya pasangan jam yang lengkap (admin memutuskan di Rekonsiliasi), dan tanggal ketika ekspor mesin terpotong (file diambil sebelum pegawai pulang).

### Tarif yang dijelaskan kepada client

| Status | Golongan asli | Tarif harian |
| --- | --- | ---: |
| PNS | I dan II | Rp35.000 |
| PPPK | I sampai VIII | Rp35.000 |
| PNS | III | Rp37.000 |
| PPPK | IX sampai XII | Rp37.000 |
| PNS | IV | Rp41.000 |
| PPPK | XIII sampai XVII | Rp41.000 |

> “Tarif mengikuti status PNS/PPPK dan golongan. Contoh ilustrasi: 10 hari UM yang memenuhi syarat untuk PNS golongan III menghasilkan bruto Rp370.000.”

Apabila tarif efektif berubah di tengah bulan, perhitungan mengikuti rentang tarif yang tercatat. Jabatan tetap ditampilkan pada profil; tabel tarif ini tidak menetapkan nominal berbeda berdasarkan jabatan.

### Saat layar menampilkan pending

- **Tarif/golongan pending:** jelaskan data atau pengesahan parameter yang belum lengkap. Sistem tidak memberikan nominal siap bayar dari golongan tebakan.
- **PPh/netto belum ditetapkan:** jelaskan bahwa bruto sudah bisa dibaca, sedangkan penghitungan pajak dan netto menunggu parameter yang disahkan.
- **Tepat pukul 08:00:** masuk 08:00 pas masih mendapat UM. Tidak ada pilihan yang perlu diputuskan.
- **Hari ditahan:** buka alasannya. Bedakan clash antar-sumber yang menunggu keputusan admin, ekspor mesin yang terpotong (perlu ekspor ulang), dan informasi tarif yang belum siap.

Di Excel, tunjukkan sheet **Nominatif**, **Rincian Harian**, **Ditahan**, **Review Sumber**, dan **Parameter**. Sebut ekspor dari halaman ini sebagai rekap progresif jika pemeriksaan belum selesai.

## 8. Pengajuan, persetujuan, dan snapshot

Bagian **Pengajuan & snapshot periode KPPU** berada pada halaman **Uang Makan**.

### Bila periode belum siap diajukan

1. Tunjukkan tombol **Ajukan** dan keterangan persyaratannya.
2. Jelaskan pekerjaan yang tersisa sesuai layar: paket sumber, keputusan harian, isu, tarif, atau PPh/netto.
3. Bila ada pengajuan terdahulu, buka **Lihat rincian** untuk menunjukkan hasil yang pernah diajukan.

**Narasi**

> “Perhitungan progresif membantu petugas melihat hasil selama proses berlangsung. Untuk pengajuan final seluruh KPPU, semua pemeriksaan dan parameter harus siap.”

### Bila periode latihan sudah siap dan pengajuan akan diperagakan

1. Admin/SDM dengan cakupan seluruh kantor mengajukan bulan tersebut melalui tombol **Ajukan**.
2. Pada akun Keuangan yang berbeda, klik **Muat pengajuan**, lalu periksa rincian dan catatan tindakannya.
3. Setelah alasan tindakan terisi, tunjukkan **Setujui**, kemudian **Kunci**, sesuai tahap pengajuan.
4. Buka **Lihat rincian** dan **Unduh snapshot Excel**.
5. Bila sudah ada versi terkunci, jelaskan **Ajukan koreksi**: koreksi memuat alasan, versi baru, dan perbandingan perubahan terhadap versi sebelumnya.

Lakukan pengajuan dan penguncian hanya pada periode latihan yang memang disiapkan untuk alur tersebut. Bila parameter resmi belum tersedia, jelaskan persyaratannya tanpa mengisi angka pajak fiktif pada produksi.

**Narasi**

> “Pengaju dan pemeriksa menggunakan akun berbeda. Snapshot menyimpan hasil pada versi data tertentu, sehingga perubahan berikutnya bisa ditinjau melalui koreksi versi.”

> “Keluaran aplikasi adalah perhitungan dan nominatif. Pencairan uang makan mengikuti proses organisasi.”

## 9. Pemantauan dan data pegawai

### Ringkasan Kehadiran

1. Buka **Ringkasan Kehadiran**.
2. Tunjukkan KPI, komposisi status harian, rekap per unit, dan filter kantor.
3. Beralih antara grafik dan tabel bila diperlukan.
4. Tunjukkan tautan menuju matriks atau pegawai yang perlu perhatian.

**Narasi:** “Pimpinan dapat membaca kondisi bulan ini dan melihat bagian yang masih memerlukan pemeriksaan. Ringkasan mengikuti data serta keputusan yang sudah tercatat.”

Catatan disiplin pada dashboard adalah bahan pemeriksaan. Penyajiannya tidak sama dengan penetapan hukuman pegawai.

### People Dashboard

1. Buka **People Dashboard**.
2. Tunjukkan sebaran kantor/unit, status kepegawaian, kelompok usia, dan kelengkapan profil.
3. Tunjukkan ulang tahun terdekat sebagai contoh pemanfaatan data master untuk kebutuhan HR.

**Narasi:** “Data pegawai yang sudah dihimpun dapat dipakai untuk melihat komposisi SDM dan field yang masih perlu dilengkapi.”

### Data Pegawai

1. Buka **Data Pegawai**.
2. Cari nama, NIP, atau NIKA dan gunakan filter kantor/status.
3. Klik satu pegawai untuk membuka profil.
4. Tunjukkan identitas, unit, jabatan, golongan, kehadiran, serta identitas dari sumber.
5. Bila relevan, tunjukkan panel status kerja bertanggal dan tarif efektif beserta dasar dokumennya.

**Narasi:** “Profil menghubungkan data kepegawaian dengan catatan absensi. Rentang status khusus dan tarif efektif membantu menjelaskan perubahan yang berlaku pada tanggal tertentu.”

## 10. Pelengkapan master, komunikasi, dan administrasi

### Tambah Data

1. Buka **Tambah Data**.
2. Tunjukkan **Bulk import** dan **Input manual**.
3. Klik **Download template** agar client melihat format master yang diterima.
4. Bila berkas latihan tersedia, tampilkan preview pembaruan, pegawai baru, dan baris yang perlu diperbaiki.
5. Jelaskan bahwa **Simpan ke master** memerlukan pemeriksaan batch, sedangkan **Simpan pegawai** dipakai untuk input satu orang.

**Narasi:** “Master dilengkapi melalui format yang disediakan aplikasi. Untuk impor, NIP/NIKA menjadi dasar pembaruan. Baris yang bermasalah perlu diperbaiki sebelum batch disimpan.”

Gunakan kolom template sebagai acuan kemampuan impor saat ini. Sebagian riwayat kepegawaian yang lebih rinci belum seluruhnya tersedia melalui impor master.

### Automation Center

1. Buka **Automation Center**.
2. Tunjukkan status koneksi WhatsApp yang sebenarnya tampil.
3. Pilih kategori **Publik**, **Tersegmentasi**, atau **Personal**, lalu pilih template dan lihat pratinjaunya.
4. Tunjukkan kesiapan data kontak, agama, atau tanggal lahir yang digunakan oleh contoh template.

**Narasi:** “Halaman ini menyediakan pengelolaan koneksi WhatsApp dan pratinjau kebutuhan komunikasi HR. Penautan perangkat menggunakan QR ketika layanan sudah dikonfigurasi. Aturan dan pratinjau pesan saat ini belum mengirim pesan atau menjalankan jadwal otomatis.”

Jika statusnya perlu konfigurasi, sampaikan kondisi tersebut. Demonstrasi penautan dilakukan menggunakan nomor kerja yang memang disiapkan untuk aplikasi.

### Ruang Kerja & Akses

1. Buka **Ruang Kerja & Akses**.
2. Tunjukkan peran, cakupan kantor, dan revisi ruang kerja.
3. Tunjukkan tempat mengganti password, mengelola akun, mencatat nihil ST, serta backup/pemulihan sesuai kewenangan akun.
4. Klik **Muat riwayat** untuk menampilkan aktor, waktu, tindakan, revisi, dan alasan perubahan jika akun memiliki akses.

**Narasi:** “Tindakan petugas terhubung dengan akun yang masuk. Pembagian peran dan riwayat perubahan membantu menelusuri siapa yang memeriksa atau mengubah data.”

Untuk mengenalkan fitur pemulihan, cukup tunjukkan letak dan preview-nya. Pemulihan backup mengganti ruang kerja bersama.

### Peta Fitur & Data

Buka halaman ini sebagai penutup penjelasan fitur. Tunjukkan hubungan data dan area pengembangan; sebut bagian usulan sebagai rencana, sesuai label pada layar.

## 11. Jika kondisi live berbeda saat presentasi

| Kondisi | Langkah presenter | Kalimat yang bisa digunakan |
| --- | --- | --- |
| Masuk ke impor setelah memilih bulan | Periksa periode dan checklist sumber. | “Bulan ini belum memiliki paket lengkap. Kita lihat bagian yang masih diperlukan.” |
| Rekonsiliasi belum terbuka | Pilih bulan persiapan yang lengkap atau jelaskan checklist. | “Pemeriksaan harian dibuka setelah cakupan sumber bulanan siap.” |
| Daftar pegawai terlihat kosong | Ubah filter ke Semua, kosongkan pencarian, lalu periksa master dan cakupan akun. | “Saya periksa cakupan dan filter data yang sedang ditampilkan.” |
| Jenis isu yang dicari tidak ada | Gunakan isu lain yang tersedia, lalu jelaskan ilustrasi yang belum ada. | “Pada data bulan ini kasus tersebut belum tersedia; mekanisme pemeriksaannya sama.” |
| Tombol simpan belum tersedia | Periksa peran, pilihan status/bukti, alasan, dan status penyimpanan. | “Keputusan harus memiliki bukti dan alasan yang sesuai sebelum disimpan.” |
| Perubahan pengguna lain membuat revisi berbeda | Tunggu penyimpanan atau muat ulang keadaan server, lalu tinjau kembali. | “Ada pembaruan pada ruang kerja bersama; kita gunakan data terbarunya.” |
| Bruto pending atau netto belum ditetapkan | Buka keterangan tarif/parameter. | “Informasi ini belum lengkap untuk menghasilkan nominal yang disahkan.” |
| Ajukan belum aktif | Tunjukkan persyaratan yang belum terpenuhi. | “Hasil progresif tersedia, sementara finalisasi menunggu pemeriksaan bulan ini selesai.” |
| Halaman lambat, simpan terasa lama, atau muncul 502 | Tunggu 20 sampai 60 detik tanpa klik ulang. Bila 502, tunggu satu menit lalu muat ulang. | “Layanan demo ini berjalan di paket gratis, jadi kadang butuh waktu. Datanya aman di database.” |
| WhatsApp perlu konfigurasi | Tunjukkan status dan lanjutkan ke pratinjau. | “Koneksi perangkat perlu disiapkan; pratinjau template sudah dapat kita tinjau.” |

## 12. Jawaban singkat untuk pertanyaan client

**Apakah Pusat dan Kanwil dihitung terpisah?**  
Satu periode dan pengajuan mencakup seluruh KPPU. Filter kantor membantu pemeriksaan dan cakupan akses.

**Apakah Mesin Offline lebih dipercaya?**  
Ketiga sumber setara. Admin memilih bukti dan aktivitas harian yang berlaku.

**Apakah semua pegawai harus selesai dulu agar UM terlihat?**  
Hasil diperbarui dari hari yang sudah sah dan memenuhi syarat. Finalisasi pengajuan seluruh KPPU memiliki persyaratan kelengkapan tersendiri.

**Apakah WFA mendapat UM?**  
Ya, dengan bukti WFA yang divalidasi dan memenuhi aturan kelayakan hari tersebut.

**Apakah hari dinas berarti pegawai tidak bekerja?**  
Hari dinas tetap menjelaskan aktivitas pegawai. Pada aturan aplikasi saat ini dinas tidak menjadi hari UM.

**Jika pegawai tidak punya NIP/NI PPPK pada sumber, apakah datanya hilang?**  
Catatan dapat ditelusuri melalui NIKA, identitas aplikasi/mesin, dan pemeriksaan mapping. Identitas serta kelayakan yang belum pasti perlu dilengkapi sebelum hasil resmi disahkan.

**Jika tidak ada absen, apakah langsung TK?**  
Hari tanpa bukti ditampilkan sebagai tidak ditemukan. Admin menelusuri dan menetapkan statusnya berdasarkan hasil pemeriksaan.

**Apakah netto dan pajak sudah pasti?**  
Lihat status parameter PPh/netto pada periode presentasi. Tarif bruto tidak dengan sendirinya menetapkan persentase pajak.

**Apakah aplikasi sudah mengirim pesan WhatsApp otomatis?**  
Koneksi perangkat dapat dikelola jika konfigurasinya siap. Pengiriman aturan/template dan scheduler masih belum aktif.

**Apakah aplikasi langsung membayar UM?**  
Aplikasi menghitung dan menghasilkan nominatif/snapshot untuk proses organisasi. Pencairan dilakukan melalui proses pembayaran yang berlaku.

## 13. Penutup yang bisa dibacakan

> “Dari alur ini, petugas dapat melihat bukti kerja pegawai sepanjang bulan, menyelesaikan bagian yang belum jelas, dan menelusuri hasil uang makan sampai ke hari serta sumbernya. Hari yang sudah siap dapat dihitung sambil pemeriksaan lainnya berjalan. Setelah seluruh persyaratan selesai, hasil seluruh KPPU dapat diajukan dan ditinjau melalui versi yang tercatat.”

Lanjutkan diskusi dengan client mengenai format sumber yang digunakan tiap kantor, kelengkapan master, kalender serta parameter operasional, dan pembagian peran pemeriksa.

## 14. Versi singkat jika waktu hanya 10 menit

1. **1 menit:** pilih periode dan jelaskan cakupan seluruh KPPU.
2. **2 menit:** tunjukkan checklist Impor Sumber dan mapping identitas.
3. **3 menit:** buka matriks dan satu detail kasus untuk menunjukkan bukti serta keputusan admin.
4. **3 menit:** buka UM pegawai tersebut, rincian hari, tarif, dan ekspor; jelaskan syarat pengajuan final.
5. **1 menit:** tunjukkan direktori/riwayat perubahan dan sampaikan status fitur WhatsApp.

## 15. Acuan dan hasil pengecekan panduan

- Pada 27 Oktober 2026, halaman publik produksi merespons HTTP 200. Endpoint `/api/health` memberikan `ok: true` dan revision aplikasi `0ef80d0734a5`.
- Label dan urutan fitur pada panduan disusun dari implementasi lokal dengan HEAD `0ef80d0`. Revision aplikasi tersebut bukan nomor revisi data workspace.
- Aturan UM jam masuk 08:00 dan jam pulang 16:30 mengikuti pembaruan commit `c2cc51f`. Cek ulang `/api/health` sebelum presentasi untuk memastikan produksi sudah memakai revision terbaru.
- Jumlah pegawai, kasus, status koneksi WhatsApp, parameter aktif, dan pengajuan pada akun produksi belum diperiksa melalui sesi login saat penulisan panduan. Angka contoh pada bagian Data demo di produksi adalah angka acuan; isi lembar persiapan menggunakan kondisi yang tampil pada akun presenter.
- Pemeriksaan naskah: tidak memuat em dash; contoh angka ditandai sebagai ilustrasi; kasus demo Netlify tidak dinyatakan sebagai data produksi; kondisi pengajuan dan komunikasi mengikuti implementasi yang diperiksa.

Rujukan:

- [Alur fitur untuk client](ALUR-FITUR-UNTUK-CLIENT.md).
- [Konsep inti absensi dan UM](KONSEP-PROJECT.md).
- [Panduan Penggunaan Web SDM KPPU (PDF)](PANDUAN-PENGGUNAAN-WEB-SDM-KPPU.pdf).
- [Daftar kasus khusus demo Netlify](../demo/SKENARIO-DATA.md).
- Implementasi: [impor](../src/pages/ImportPage.tsx), [identitas](../src/pages/IdentityPage.tsx), [rekonsiliasi](../src/pages/ReconcilePage.tsx), [keputusan hari](../src/components/DayReviewEditor.tsx), [UM](../src/pages/MealPage.tsx), dan [pengajuan](../src/components/SubmissionPanel.tsx).
