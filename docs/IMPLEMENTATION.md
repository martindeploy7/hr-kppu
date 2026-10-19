# Pelaksanaan fullstack HR KPPU

20 Oktober 2026. Instruksi terbaru memperluas dua blueprint menjadi aplikasi bersama. Stack mengikuti keluarga teknologi Cozzy: React/TypeScript/Vite, Hono, Drizzle, PostgreSQL. Target tetap satu Render Free Web Service untuk FE/API dan Supabase PostgreSQL melalui pooler. Upload sumber tetap manual. WhatsApp tetap simulasi, tanpa pengiriman.

Repository privat: https://github.com/martindeploy7/hr-kppu. File kerja tetap di checkout frontend existing; workbook asli di direktori induk tidak dipindah atau dibundel.

## Perubahan yang sudah ada

- Password Argon2, sesi 8 jam dalam cookie HttpOnly/Secure production, origin check, limiter login tersimpan di PostgreSQL, penggantian password yang mencabut sesi lain.
- Role admin/SDM/reviewer/Keuangan/viewer serta cakupan kantor. Workspace, kalkulasi, backup, pengajuan dan ekspor diperiksa server. Tes membuktikan akun Kanwil I tidak dapat membaca/mengubah Pusat.
- PostgreSQL menyimpan workspace berversi, sumber byte asli/hasil parsing, akun/sesi, audit, snapshot pengajuan dan kunci employee-date. Schema privat `hr_internal`; trigger melindungi audit dan isi snapshot/arsip dari perubahan.
- Transaksi + expected revision menolak overwrite antaradmin. UI memuat perubahan server saat tidak ada edit tertunda, dengan pemeriksaan revisi ringan setiap 15 detik. Kegagalan simpan terlihat; backup tetap bisa diunduh.
- Preview server, SHA-256, deduplikasi isi meski nama berubah, konfirmasi tambahan/pengganti dataset, revisi aktif/superseded dan invalidasi review berbasis signature fakta. Retry commit yang sama tidak menambah sumber.
- Parser matriks online, master+ST DPH, header dua tingkat, identitas dan tanggal ST, kelanjutan peserta pada profil register yang sesuai, serta provenance tanggal. Identifier panjang tidak dikonversi ulang dari Number untuk menebak digit. Tanggal mesin yang ambigu memerlukan pilihan format eksplisit.
- Nama/fuzzy hanya kandidat. NIP kuat berbeda tidak digabung otomatis. NIP peserta ST kosong tidak diwariskan dari peserta sebelumnya. Mapping eksplisit dapat menyelesaikan risiko identitas; status tanpa jam tetap tidak eligible.
- Larangan UM terkunci: telat tanpa toleransi, semua dinas, tugas belajar dan diperbantukan efektif. Satu pasangan jam berasal dari satu bukti. Future/missing bukan TK. Golongan/tarif/parameter belum disahkan menghasilkan nominal pending. Tarif dan pajak efektif dievaluasi per hari.
- Master menggunakan reader presisi yang sama untuk Excel/CSV, seluruh sheet yang dikenali, referensi baris, preview seluruh perubahan per field dan konfirmasi. Baris kompatibel dengan identifier sama digabung, konflik/precision risk/field tidak valid menahan seluruh batch. Nama tidak dipakai untuk upsert. API juga memvalidasi identifier ganda, tanggal dan field profil; penolakan tidak mengubah revisi. Field kosong tidak menghapus data lama.
- Backup JSON dengan preview/validasi dan restore admin; restore point server disimpan. Pembacaan state prototype lokal eksplisit dan tidak menghapus IndexedDB lama. Backup JSON tidak memuat byte workbook.
- Pengajuan memakai kalkulasi server, membutuhkan kelengkapan/review/nominal; pernyataan nihil ST harus eksplisit. Pengaju tidak bisa menyetujui diri sendiri. Kunci pegawai-tanggal mencegah pengajuan ganda. Snapshot Excel tetap sama ketika data aktif berubah.
- Koreksi snapshot terkunci memakai versi pengganti dengan alasan, checksum induk dan selisih employee-day. Satu cabang koreksi aktif per versi, persetujuan akun lain dan pemeriksaan revisi workspace. Usulan mereservasi hari baru; pembatalan melepas reservasi baru, penguncian memindahkan klaim secara atomik. Koreksi nol penuh dan rantai versi berikutnya didukung. Versi lama tetap utuh, UI/ekspor menandainya sebagai arsip setelah pengganti dikunci.
- Ekspor koreksi memuat nominatif penuh dan sheet selisih bruto/PPh/netto; selisih adalah bahan pemeriksaan, bukan perintah pembayaran tambahan otomatis. Pembulatan pajak per pegawai/bulan dipertahankan dalam rincian delta. File Excel yang sudah diunduh sebelumnya tetap merupakan snapshot waktu unduh.
- Penarikan sumber menunggu konfirmasi server sebelum menampilkan sukses; sumber tidak aktif tetap diarsipkan. Detail harian membedakan hari memenuhi syarat, nominal pending dan proses pembayaran.
- Font disajikan lokal; halaman dimuat terpisah; label koneksi WA konsisten sebagai simulasi. Konfigurasi Netlify lama diarsipkan.

## Bukti lokal

- Checkpoint lokal: 51 tes domain/API/parser dan 7 tes browser lulus. Angka ini tidak mencakup E2E cloud.
- Workbook dengan rentang sheet sangat besar ditolak sebelum ekspansi baris; arsip terkompresi juga memiliki batas ukuran hasil ekstraksi.
- Smoke bundle dalam mode production lokal: FE/health/login/logout merespons 200, cookie memakai `__Host-`/Secure/HttpOnly/SameSite dan origin asing ditolak 403. Ini bukan bukti HTTPS live.
- `npm run build`: FE dan BE berhasil dibangun. Ini belum merupakan deployment Render.
- Suite `tests/*.test.ts`: domain, identifier XML, parser multi-sheet, review stale, migrasi, transaksi, RBAC/scope, impor/revisi/idempotency, restore, audit, approval/lock dan konsistensi Excel.
- Browser e2e: login, master bertahan setelah reload, logout, 390px, preview/konfirmasi dan upload ulang identik; tambahan tes menunjukkan perubahan klien lain muncul otomatis. Bulk master membuktikan penolakan konflik, konfirmasi eksplisit, satu pegawai setelah penggabungan, persistensi sesudah reload dan lebar 390px. Alur koreksi browser memakai akun pengaju dan Keuangan berbeda: submit, approve/lock, revisi tarif, usulan selisih, approve/lock ulang, arsip lama utuh dan lebar 390/1280px. Fixture kerja dipulihkan lewat restore point dan akun sintetis dinonaktifkan setelah tes. Tes penarikan sumber membuktikan jumlah aktif berkurang setelah respons sukses dan dataset lama tetap ada sebagai arsip.
- `npm audit --omit=dev`: tidak melaporkan vulnerability dependency runtime pada pemeriksaan sesi ini. Ini bukan pentest.
- `scripts/parser-audit.ts`: 19 isi workbook unik diperiksa; 18 sumber dikenali. Workbook dashboard sintetis sengaja tidak dipakai sebagai sumber operasional. Laporan aktual berada di `artifacts/parser-audit.json` (privat, tidak di-commit).

Kontrol data aktual: offline Oktober 6.204 bukti; matriks online 1.229 status dan 396 risiko identifier numerik; DPH 175 penugasan (8 tanpa NIP), 286 kandidat master setelah satu duplikat, 3 masalah master; Kanwil I 53 penugasan + 22 identitas; Kanwil V 15 kegiatan; Kanwil VI 148 penugasan Januari–September; Kanwil VII 1 penugasan. Count adalah bukti parsing file versi ini, bukan bukti kelengkapan bulan atau pembayaran sah. Baris tanpa status/tanggal atau sheet yang belum dapat ditafsirkan terlihat di karantina.

## Pekerjaan yang masih diperlukan untuk tujuan penuh

1. **Deployment live:** login Render kedaluwarsa; device flow berakhir timeout/slow_down; validasi Blueprint online mendapat 401. Supabase CLI tersedia tetapi belum autentikasi/project. Belum ada database Supabase atau layanan Render yang dibuat untuk aplikasi ini. Jangan mengganti target menjadi penyimpanan lokal atau provider lain untuk menyebut deployment selesai.
2. **Review dan revisi lebih rinci:** preview pengganti masih seluruh dataset yang dipilih, bukan diff record terinci/seleksi sebagian register. Pemilihan bukti dan pembatalan peserta ST individual dengan alasan masih memerlukan penyempurnaan; jangan menyediakan bypass UM.
3. **Baseline data/master:** Reader bulk dan preview konflik sudah disatukan. History kantor/jadwal efektif dan perubahan kantor lintas periode belum lengkap.
4. **Keputusan operasional:** jadwal/kalender, kamus kode, tarif/pajak/pembulatan, WFA dan alur pengesahan harus dikonfirmasi SDM/Keuangan. Default parameter adalah draft; sistem tidak boleh menyebut nominal pembayaran nyata sudah valid.
5. **Gerbang akhir:** ulangi E2E pada deployment live, role kantor, revision/health commit, database persisten, backup/restore, serta seluruh M01–M18 dan skenario operasional relevan setelah gap ditutup. Bukti lokal dan konfigurasi YAML belum membuktikan production-ready.

## Lanjutan terdekat

Tutup gap review/diff serta history kantor/jadwal efektif sambil akses cloud disiapkan. Setelah login layanan tersedia, buat Supabase Free khusus HR KPPU, isi connection string secara privat, apply migrasi, deploy Render Free dan verifikasi URL live. Jangan memasukkan workbook, kredensial, dump atau screenshot berdata personal ke repository.
