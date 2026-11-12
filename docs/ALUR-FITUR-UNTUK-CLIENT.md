# Alur Fitur dan Use Case KPPU HR

- Panduan presentasi client
- Pembaruan: **26 Oktober 2026**
Acuan implementasi: commit `0ef80d0`

## Cerita produk

KPPU HR mengumpulkan catatan dari Mesin Offline, Mesin Online, dan Surat Tugas (ST), menyusunnya per pegawai dan hari kerja, lalu membantu SDM dan Keuangan memvalidasi dasar uang makan dalam satu rekap bulanan seluruh KPPU.

Pusat dan Kanwil I–VII diproses sebagai satu organisasi. Sistem menampilkan bukti yang belum ditemukan atau masih bertentangan, mencatat keputusan petugas, serta memperlihatkan hasil uang makan secara bertahap untuk pegawai yang datanya sudah siap.

## Alur presentasi utama

### 1. Masuk dan pilih periode

Petugas masuk dengan akun sesuai perannya, lalu memilih bulan yang akan diolah. Bulan tersebut menjadi cakupan kerja bersama untuk Pusat dan seluruh Kanwil. Jumlah hari kerja mengikuti kalender bulan terpilih, jadi tidak diasumsikan selalu 22 hari.

### 2. Siapkan paket absensi bulanan

Pada **Impor Sumber**, petugas mengunggah Mesin Offline, Mesin Online, dan register ST untuk setiap kantor. Jika suatu kantor tidak memiliki ST, petugas mencatat pernyataan nihil beserta dasar konfirmasinya. Checklist memperlihatkan sumber dan kantor yang sudah siap. Rekonsiliasi baru dapat dilanjutkan setelah paket satu bulan lengkap.

File dibaca dan ditampilkan dalam preview. Petugas memeriksa jenis sumber, periode, kantor, jumlah data, peringatan, dan perubahan sebelum menyimpan. Proses revisi menyediakan perbandingan data dan dampaknya, sedangkan sumber yang ditarik dari perhitungan tetap tersimpan sebagai arsip.

### 3. Pastikan catatan mengarah ke pegawai yang benar

Di **Pencocokan Identitas**, SDM meninjau peserta ST dan catatan yang belum terhubung. NIP/NIKA membantu menyatukan sumber yang memang merujuk ke orang yang sama. Kemiripan nama hanya menjadi kandidat; keputusan penggabungan dilakukan petugas agar dua pegawai berbeda tidak tercampur.

Master pegawai bisa dilengkapi lewat input satu per satu atau impor Excel/CSV. Preview memperlihatkan pegawai baru, pembaruan, dan baris yang perlu diperbaiki sebelum disimpan.

### 4. Tinjau kehadiran per pegawai dan per hari

Di **Rekonsiliasi**, petugas melihat matriks seluruh pegawai dengan status harian dan daftar isu. Mesin Offline, Mesin Online, dan ST berkedudukan setara. Jika beberapa sumber mencatat hal yang berbeda, petugas membandingkan bukti, memilih catatan yang digunakan, menetapkan status hari, dan menyimpan alasannya.

Hari yang sudah diperiksa ditandai valid. Bukti yang masih perlu keputusan menjadi flag; hari tanpa penjelasan tampil sebagai tidak ditemukan. Karena keduanya tidak dianggap final, petugas dapat melihat pekerjaan yang tersisa sebelum mengesahkan hasil.

### 5. Lihat hasil uang makan yang siap secara bertahap

Halaman **Uang Makan** menunjukkan hari yang memenuhi syarat, hari yang masih ditahan, dasar tarif, dan total bruto. Hasil pegawai yang sudah siap dapat terlihat meskipun peninjauan pegawai lain masih berlangsung. Ketetapan tarif yang menjadi acuan adalah:

| Pegawai | Golongan | Tarif per hari |
| --- | --- | ---: |
| PNS | I–II | Rp35.000 |
| PPPK | I–VIII | Rp35.000 |
| PNS | III | Rp37.000 |
| PPPK | IX–XII | Rp37.000 |
| PNS | IV | Rp41.000 |
| PPPK | XIII–XVII | Rp41.000 |

WFA tetap dapat menjadi hari UM jika bukti dan ketentuan hari tersebut terpenuhi. Bruto ditampilkan terpisah dari PPh dan netto. Parameter pajak belum ditetapkan dalam ketetapan tarif ini, sehingga PPh/netto menunggu input dan pengesahan tersendiri.

Contoh presentasi dengan data sintetis: pegawai PNS golongan III yang memiliki 10 hari UM siap menunjukkan bruto Rp370.000. Hari lain yang masih perlu ditinjau tidak diperlakukan sebagai hasil final.

### 6. Ajukan, tinjau, dan kunci hasil

Jika paket sumber, keputusan harian, mapping, tarif, dan parameter pengajuan sudah siap, SDM mengajukan satu nominatif untuk seluruh KPPU. Keuangan meninjau dari akun yang berbeda, kemudian mengunci snapshot yang disetujui. Snapshot menyimpan hasil dan dasar sumber pada revision tersebut, serta dapat diunduh sebagai Excel.

Jika data berubah setelah penguncian, petugas membuat versi koreksi dengan alasan. Versi sebelumnya tetap tersimpan untuk perbandingan; koreksi menampilkan perubahan hari dan nominal untuk ditinjau sebelum disetujui dan dikunci.

### 7. Gunakan fitur pemantauan dan administrasi

Setelah proses inti, pimpinan/SDM dapat memakai **Ringkasan Kehadiran** untuk melihat komposisi status, kehadiran per unit, dan perhatian disiplin pada bulan terpilih. **People Dashboard** merangkum roster berdasarkan kantor, unit, kelompok usia, kelengkapan data, dan ulang tahun terdekat.

**Data Pegawai** menyediakan direktori dan profil yang dapat ditelusuri ke identitas/sumber. **Ruang Kerja & Akses** menampilkan peran, cakupan kantor, status simpan, password, akun, backup/restore, pernyataan nihil ST, dan riwayat perubahan sesuai kewenangan.

## Use case berdasarkan peran

| Pengguna | Use case normal | Hasil |
| --- | --- | --- |
| SDM/Admin | Memilih bulan, mengumpulkan sumber, merapikan identitas, meninjau hari, dan melengkapi master. | Data absensi dan roster seluruh KPPU siap dihitung serta dapat ditelusuri. |
| Reviewer | Membuka flag, membandingkan bukti, menetapkan status harian dengan catatan. | Keputusan valid tercatat atas nama akun dan waktu tindakan. |
| Keuangan | Memeriksa tarif/parameter yang berwenang, meninjau nominatif, menyetujui dan mengunci hasil. | Snapshot uang makan yang disetujui tersimpan per periode seluruh KPPU. |
| Pimpinan/Viewer | Memfilter ringkasan dan direktori sesuai cakupan aksesnya. | Melihat gambaran kehadiran dan pegawai tanpa mengubah data. |
| Admin | Mengelola akun/peran, status koneksi WhatsApp, dan pengaturan ruang kerja. | Akses dikelola melalui akun dan tindakan penting memiliki jejak. |

## Peta fitur yang tersedia

| Fitur | Penggunaan sehari-hari | Keluaran |
| --- | --- | --- |
| Login dan peran | Pengguna masuk dengan akun individual; tindakan mengikuti peran dan cakupan kantor. | Akses kerja tercatat atas nama pengguna. |
| Pemilihan periode | Menetapkan bulan bersama untuk proses absensi dan UM seluruh KPPU. | Satu konteks periode untuk impor, rekonsiliasi, dan hasil. |
| Impor Sumber | Membaca Mesin Offline, Mesin Online, ST, serta rekap/laporan Kanwil sebagai bukti tambahan. | Preview data, kelengkapan sumber, peringatan, dan arsip revisi. |
| Pencocokan Identitas | Memetakan catatan sumber ke profil pegawai yang benar. | Roster gabungan dengan konflik/identitas yang perlu ditinjau. |
| Rekonsiliasi | Membandingkan bukti, memeriksa isu, memilih sumber/status harian, dan memberi alasan. | Matriks valid, flag, tidak ditemukan, atau belum berlangsung. |
| Ringkasan Kehadiran | Meninjau KPI, grafik/tabel status, kantor/unit, serta perhatian disiplin. | Ringkasan bulan aktif yang mengikuti data dan keputusan saat ini. |
| Uang Makan | Melihat kelayakan harian, hari ditahan, tarif, bruto, nominatif, dan hasil yang masih pending. | Perhitungan progresif yang dapat dilacak ke hari dan bukti. |
| Pengajuan dan snapshot | Mengajukan hasil, meninjau, menyetujui, mengunci, mengekspor, atau membuat koreksi versi. | Nominatif dan riwayat versi yang dapat dibandingkan. |
| People Dashboard | Melihat komposisi roster dan kelengkapan data pegawai. | Ringkasan pegawai per kantor/unit, kelompok usia, dan ulang tahun terdekat. |
| Direktori dan master | Mencari profil, mengisi satu pegawai, atau mengimpor master secara massal. | Master pegawai yang dapat dilengkapi dan ditelusuri. |
| Automation Center | Admin menautkan WhatsApp melalui QR dan melihat status sesi; pengguna meninjau kesiapan data serta preview template. | Koneksi akun dan pratinjau komunikasi. |
| Ruang Kerja & Akses | Mengubah password, mengelola akun/peran, membuat backup, memeriksa restore, mencatat nihil ST, dan melihat audit. | Pengelolaan ruang kerja dengan kontrol akses dan jejak perubahan. |
| Peta Fitur & Data | Melihat peta informasi dan usulan pengembangan. | Referensi arah produk; item usulan bukan berarti modul operasional sudah tersedia. |

## Batas yang perlu dijelaskan saat presentasi

- Website menghitung dan menyiapkan nominatif; **pencairan/pembayaran uang makan belum dilakukan oleh aplikasi**.
- Pengajuan final menunggu paket semua sumber dan kantor, keputusan hari kerja, mapping identitas, serta parameter tarif dan PPh/netto yang disahkan. Perhitungan progresif yang terlihat tidak sama dengan pengajuan final.
- Upload sumber masih dilakukan petugas. Daftar master aktif dan kalender libur tetap perlu dipastikan lengkap dan benar.
- Penautan WhatsApp melalui QR memiliki implementasi koneksi server dan dikelola Admin; kesiapan koneksinya bergantung pada konfigurasi server serta sesi perangkat yang ditautkan. Template, segmentasi, dan preview di Automation Center belum mengirim pesan atau menjalankan scheduler.
- Parameter PPh/netto dan aturan UM operasional di luar tarif yang telah disepakati harus ditetapkan SDM/Keuangan sebelum dijadikan dasar hasil resmi.
- Dashboard dan profil mengikuti data yang saat itu tersedia. Kelengkapan tampilan tidak dengan sendirinya membuktikan bahwa seluruh data pegawai atau absensi sudah benar.

## Rujukan untuk tim

- [Konsep inti alur dan aturan UM](KONSEP-PROJECT.md)
- [Dokumentasi progres fitur dan data](PROGRES-FITUR-DAN-DATA.md)
- [Alur impor](../src/pages/ImportPage.tsx), [rekonsiliasi](../src/pages/ReconcilePage.tsx), dan [perhitungan UM](../src/pages/MealPage.tsx)
- [Server workspace dan akses](../server/app.ts), [pengajuan dan snapshot](../server/submissions.ts)
