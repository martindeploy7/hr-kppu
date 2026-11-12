# Adaptasi Format Impor Absensi KPPU

Tanggal pemeriksaan: 29 Oktober 2026  
Parser: `2.2.0`

## Ringkasan

Adapter impor sekarang membaca variasi format mesin Pusat dan Kanwil yang tersedia, mempertahankan nilai sumber dan provenance, meminta konfirmasi untuk identitas/kantor/tanggal yang belum pasti, serta melewatkan alur preview, konfirmasi dampak, commit, dan baca ulang dari database. Nilai durasi tidak dipakai untuk menebak jadwal.

Jadwal yang tidak tersedia atau hanya berlabel asumsi kini ditandai pada detail hari dan menahan uang makan sampai jadwal resmi tersedia. Batas kedatangan pukul 08:00 tetap berasal dari parameter aturan yang sudah ada.

Pengujian API dan persistensi dilakukan pada PostgreSQL sementara di mesin lokal. Tidak ada file absensi nyata yang dikirim ke produksi dan tidak ada database live yang diubah.

## Pemetaan sumber ke aplikasi

| Data sumber | Normalisasi dan penyimpanan | Tampilan/ekspor | Bukti pengujian |
|---|---|---|---|
| NIK/NIP/NI PPPK/NIKA/No. ID/Emp No./AC-No. | Identifier dipisahkan ke namespace `ids.nip`, `ids.nika`, `ids.mesin`, dan `ids.appId`; nilai mentah disimpan di `sourceValues`. Angka berisiko tidak dipulihkan dengan tebakan. | Preview impor, detail sumber harian, dan sheet `Rincian Sumber`. | `tests/import-adapters.test.ts`, `tests/parsers.test.ts`, `tests/import-persistence.test.ts`. |
| Kantor eksplisit, Unit/Departemen, nama file/sheet | Disimpan sebagai `office`; kandidat yang belum pasti memakai `officePending`/`officeCandidates`; konflik kantor menghentikan commit. Unit tidak otomatis dianggap kantor penempatan. | Distribusi preview per kantor dan flag konfirmasi; rincian UM memuat status kantor. | `tests/import-adapters.test.ts`, `tests/import-scope.test.ts`. |
| Tanggal teks, ISO, serial Excel, profil DMY/MDY | Disimpan sebagai ISO `date`; tanggal asal tetap tersedia di `sourceValues.date`. Pola ambigu meminta pilihan, pola campuran tanpa pilihan ditolak. | Periode dan distribusi tanggal mengikuti isi transaksi, bukan nama file atau bulan UI. | `tests/import-adapters.test.ts`, `tests/parsers.test.ts`. |
| Jadwal masuk/pulang dan scan aktual | Jadwal tersimpan di `schedule`; scan aktual di `clockIn`/`clockOut`. Nilai Jml Jam Kerja, Durasi, Min. Durasi, terlambat, pulang cepat, dan lembur tetap terpisah. | Detail hari membedakan jadwal dan scan. Jika jadwal resmi hilang/asumsi, tampil “Jadwal resmi perlu dikonfirmasi” dan UM ditahan. | `tests/import-adapters.test.ts`, `tests/domain.test.ts`. |
| Approved/Reject/Pending/Not Approved | Status sumber dipetakan secara tepat ke `approvalStatus`; status sumber tidak menggantikan keputusan admin untuk rekonsiliasi. | Rincian bukti menampilkan approval asal. | `tests/online-status.test.ts`, `tests/import-adapters.test.ts`. |
| Jenis WFA/WFO, Target Pekerjaan, Hasil Pekerjaan | Jenis dipertahankan sebagai mode; teks pekerjaan disimpan di `targetPekerjaan`/`hasilPekerjaan` dan `sourceValues`. Field kosong tidak membatalkan impor. | Detail harian dan sheet `Rincian Sumber`. | `tests/import-adapters.test.ts`, `tests/import-persistence.test.ts`. |
| Sheet, baris, kolom, file asli | `ref`, hash SHA-256, versi parser, nilai asal, dan hasil normalisasi tersimpan. Upload menyimpan byte asli; state workspace menyimpan bukti hasil parse. | Rujukan sumber muncul di detail dan ekspor. | `tests/import-persistence.test.ts` membandingkan byte/hash sebelum dan sesudah commit serta membaca ulang workspace. |

Format yang diuji mencakup ekspor Pusat 8 kolom, ekspor historis 29 kolom, Offline standar 11 kolom dan compact, Online 18 kolom dan compact 12 kolom, ekspor mesin Kanwil II, matriks Kanwil I, laporan Kanwil VI, dan rekap jadwal Kanwil V. Deteksi dilakukan dari struktur/header dan isi, bukan jumlah kolom atau nama file saja.

## Workbook nyata yang tersedia dan terbaca

Hash dicantumkan untuk mengidentifikasi salinan yang diperiksa. Ringkasan tidak mencantumkan nama atau identifier pegawai.

| File | Hasil baca | Karantina/peringatan | SHA-256 |
|---|---|---|---|
| `Rekap ST/Absensi Offline/Absensi Pusat Oktober.xls` | 6.204 bukti; 1–30 Okt 2026; 282 pegawai. File 8 kolom aktif, bukan kontrak 11 kolom pada instruksi. | 0 karantina; 3 peringatan. | `5c437295f1c173ceead77b9bb13ff58eae51d3003eb6d1aa8bcff2293d575e93` |
| `Rapat Absensi/Pusat/Data Rekap absensi_pusat.xls` | 6.204 bukti; 1–30 Sep 2026; 282 pegawai. Ekspor mesin 29 kolom; tanggal slash terdeteksi sebagai M/D. | 0 karantina; 2 peringatan. | `7d9c339147f48de83f46055616708b129364081311bb4cdf0b88930082468198` |
| `Rapat Absensi/Data Rekap Absensi_Online_DariHP.xlsx` | 2.031 bukti; Sep 2026; 356 pegawai. | 0 karantina; 2 peringatan. | `c81705555292e5c5ab956dfed1122760c9357d3b69956c88f818828fb7404e1a` |
| `Rekap ST/Absensi Online/Rekap Absensi Online.xlsx` | 1.229 bukti; 1–15 Okt 2026; 314 pegawai. | 407 entri karantina: 396 baris berisiko presisi identifier XML tetap dipertahankan sebagai bukti `identityPending`; 11 baris tidak menghasilkan bukti; 1 peringatan. | `5f4f78d22d17af8c272ffb6b9b95655851bf2e164837e4f68748392df558a505` |
| `Rapat Absensi/Kanwil/kanwil 2 - Bulan September 2026 .xls.dbf.xls` | 482 bukti; Sep 2026; 22 pegawai. Tanggal D/M teridentifikasi dari isi. | 0 karantina. | `fe388447576f29bd90669179bccad23394d0b6479a4c6a97326704fe444ed1a9` |
| `Rapat Absensi/Kanwil/Data Rekap Absensi _ Kanwil I _ Bulan September 2026.xls` | 402 bukti matriks transaksi; Sep 2026; 22 pegawai. | 1 karantina; 2 peringatan. | `b52a168a06623ef92145252f387f50b8ff52f82b66d4eb0bc037b89ee119b23b` |
| `Rapat Absensi/Kanwil/Rekapitulasi Absen_Kanwi VI Makassar_ 25 SEPTEMBER 2026.xls` | 190 catatan; sampai 25 Sep 2026; 10 pegawai. Laporan status tanpa jam tidak dianggap scan lengkap. | 1 karantina; 1 peringatan. | `0bb30b5bce152f50417b83957752f9ca4773e66d6d94cb60adbc48b344626f6d` |
| `Rapat Absensi/Kanwil/Data Rekap Penomoran ST _ Kanwil V Bulan Januari-September 2026.xlsx` | 1.122 bukti pada 9 sheet; Jan–Sep 2026; 7 pegawai. Isi terdeteksi sebagai jadwal kehadiran Kanwil V meski nama file menyebut ST. | 0 karantina; 7 peringatan. | `8bdfe7d7ac8eb7a9d4742649788815f19fdf7c8d3bbb5f92d508d5792d5a0d2a` |
| `Absensi Online.xlsx` | 1.737 bukti; 1–21 Okt 2026; 329 pegawai. | 78 baris bernama tanpa bukti jam/status masuk karantina; 1 peringatan. | `fcf82cfe8a5b7902a93304c0e5d448276196c51c4434088dd64457977776482f` |

## File yang diminta tetapi tidak ditemukan

Pencarian workspace tidak menemukan file dengan nama persis `April.xls`, `Oktober.xls`, atau `2. Absensi dari mesin online - Okt.xlsx` yang disebut di instruksi. Karena itu:

- Hasil Pusat Oktober 8 kolom dan ekspor Pusat September 29 kolom di atas adalah format nyata yang tersedia, bukan pengganti yang diklaim identik dengan template asli 11 kolom.
- Workbook online 11.348 baris yang dirujuk dalam instruksi tidak tersedia. API menerima workbook sintetis 11.348 baris dengan layout 18 kolom yang sama untuk uji volume; ini tidak membuktikan isi workbook nyata tersebut sudah diproses.
- `Data Rekap Absensi_Online_DariHP.xlsx` berisi transaksi September meski nama sumber lain menyebut Oktober. Periode yang dipakai tetap tanggal dalam file.

## Verifikasi lokal

- `npm run typecheck`: lulus.
- Uji regresi terarah: 13 file, 92 uji lulus.
- `tests/import-persistence.test.ts` pada PostgreSQL sementara: lulus; byte/hash file asli, provenance WFA, preview/commit, dan data workspace sesudah reload sesuai.
- Uji volume sintetis 11.348 baris, workbook 8.112.233 byte: baca 579 ms, parse 87 ms, upload API 890 ms, preview dampak 15.014 ms, commit 19.257 ms, reload 107 ms. Pengukuran lokal satu kali ini bukan kapasitas atau SLA produksi; waktu preview/commit perlu dipantau saat uji dengan infrastruktur representatif.
- `npm run build`: lulus. Vite memberi peringatan bahwa beberapa chunk klien melebihi 500 kB.
- Percobaan suite penuh menjalankan 14 file uji lain dengan 93 uji lulus, tetapi `tests/api.test.ts` berhenti pada setup karena fixture masih membuat role lama (`hr`, `reviewer`, `finance`, `viewer`), sedangkan validasi akun kini menerima `superadmin`, `admin`, `operator_st`. 23 uji API tidak berjalan. Fixture lama tidak diubah dalam pekerjaan adapter ini.
- Tidak dilakukan browser E2E manual untuk halaman impor. Komponen UI lolos typecheck/build; round-trip impor diuji lewat API dan PostgreSQL lokal.

## Migrasi dan ruang lingkup

Tidak ada kolom database baru untuk adapter. Bukti disimpan dalam state workspace yang sudah ada, dan byte upload/hash berada pada tabel upload yang sudah ada. Migrasi `drizzle/0007_current_roles.sql` memperbarui constraint role agar mengenali role aplikasi saat ini sambil mempertahankan nilai lama untuk kompatibilitas. Migrasi berjalan pada database uji terisolasi; database live tidak disentuh.

Perubahan kode belum di-commit dan tidak di-deploy. Status Git berisi perubahan lain dari pekerjaan sebelumnya; laporan ini hanya merangkum bagian yang terkait adaptasi impor.
