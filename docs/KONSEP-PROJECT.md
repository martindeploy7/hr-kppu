# Konsep Inti Absensi dan Uang Makan KPPU

Tanggal pembaruan: **23 Oktober 2026**

Status: **Arah produk disepakati; implementasi mengikuti konsep ini. Kesesuaian runtime live diverifikasi per release melalui revision dan `/api/health`.**

Dokumen ini menjelaskan tujuan dan aturan inti produk. Dokumen ini membedakan arah yang telah disepakati dari kemampuan kode yang sudah diperiksa; keberadaan fitur dalam kode bukan bukti bahwa fitur telah berjalan atau disahkan di website live.

## Tujuan

Menghimpun dan memvalidasi catatan aktivitas kerja setiap pegawai KPPU untuk semua hari kerja dalam satu bulan, lalu menghitung uang makan dari catatan harian yang telah ditetapkan valid oleh admin.

Satu periode adalah **satu proses dan satu rekap seluruh KPPU**. Pusat dan semua Kanwil termasuk dalam cakupan yang sama. Kantor menunjukkan asal pegawai, lokasi sumber, dan cakupan Surat Tugas (ST); kantor bukan batas perhitungan atau pengajuan terpisah.

Jumlah hari kerja diturunkan dari kalender bulan yang dipilih. Jumlahnya berubah sesuai bulan, akhir pekan, dan hari libur; angka 22 hanya perkiraan.

## Prinsip sumber dan rekonsiliasi

Tiga kelompok sumber absensi yang dihimpun adalah **Mesin Offline**, **Mesin Online**, dan **Surat Tugas (ST)**. Paket bulanan mencakup seluruh KPPU; ST diperiksa per kantor, termasuk Pusat dan setiap Kanwil. Jumlah file dapat lebih dari tiga karena satu kelompok dapat memiliki beberapa file.

Ketiga sumber berkedudukan **sama dan setara**:

- Tidak ada sumber yang otomatis benar atau memiliki prioritas.
- Satu sumber tidak otomatis mengesahkan atau menjadi pendukung kebenaran sumber lain.
- Catatan yang sama dari beberapa sumber tetap perlu keputusan admin; sistem tidak menggabungkannya menjadi bukti yang otomatis valid.
- Jika dua atau tiga sumber mencatat pegawai pada tanggal yang sama, admin meninjau bukti dan menetapkan data/status harian yang berlaku.
- Bukti asli, asal kantor, tanggal, dan keputusan admin tetap dapat ditelusuri.

Rekonsiliasi menyatukan catatan menurut pegawai dan tanggal agar admin dapat membandingkan bukti, memutuskan benturan, dan mengisi status untuk hari yang belum ditemukan datanya. Mesin tidak memilih hasil melalui urutan sumber.

## Kelengkapan per pegawai dan hari kerja

Untuk setiap pegawai yang terdaftar pada master seluruh KPPU, sistem menampilkan status semua hari kerja dalam periode. Master pegawai harus mencakup seluruh pegawai agar orang yang tidak tercantum di file absensi tetap tampak untuk ditinjau.

Pada bulan dengan **N hari kerja**, status harian harus dapat menjelaskan N hari:

| Status harian | Makna |
| --- | --- |
| **Valid** | Admin telah memeriksa bukti dan menetapkan status hari yang berlaku. |
| **Flag / menunggu keputusan** | Bukti bertentangan, berganda, tidak lengkap, identitasnya belum pasti, atau masih menunggu penilaian admin. |
| **Tidak ditemukan** | Belum ada bukti atau keterangan yang menjelaskan hari kerja tersebut. Ini bukan otomatis berarti tanpa keterangan. |

Hari yang dijelaskan dapat berupa hadir di kantor, WFA, dinas, cuti, sakit, izin, atau ketidakhadiran yang telah dikonfirmasi. Status aktivitas harian dan hak UM adalah dua hasil yang berbeda: hari kerja yang valid sebagai dinas tidak otomatis menjadi hari UM.

Contoh: dalam bulan dengan 22 hari kerja, seorang pegawai memiliki 12 hari hadir kantor, 8 hari dinas, 1 hari berflag, dan 1 hari tidak ditemukan. Dua puluh hari telah memiliki penjelasan; dua hari masih memerlukan penyelesaian. Delapan hari dinas tetap masuk rekap aktivitas kerja meskipun perhitungan UM untuk dinas mengikuti aturan UM tersendiri.

Kelengkapan paket tiga jenis sumber diperiksa sebelum admin masuk ke rekonsiliasi. Pemeriksaan paket berarti sumber, periode, dan cakupan kantornya tersedia serta dapat dibaca; pemeriksaan ini **tidak** menyatakan setiap hari sudah valid. Hari yang belum dijelaskan tetap muncul dalam rekonsiliasi sebagai flag atau tidak ditemukan.

## Alur kerja yang dituju

1. Admin memilih bulan untuk seluruh KPPU.
2. Website meminta paket Mesin Offline, Mesin Online, serta ST dengan cakupan Pusat dan semua Kanwil.
3. Sistem memeriksa jenis sumber, periode, kantor, dan keberhasilan pembacaan. Admin belum dapat lanjut jika persyaratan paket belum lengkap.
4. Sistem menyusun matriks pegawai × hari kerja dengan bukti dari semua sumber, status sementara, dan bagian yang belum ditemukan.
5. Admin menentukan data/status yang valid dan menyelesaikan flag. Keputusan dicatat dengan pelaku dan alasan.
6. Hasil UM diperbarui bertahap untuk pegawai yang telah memenuhi dasar data dan aturan. Admin tidak harus menunggu seluruh KPPU selesai untuk melihat hasil pegawai yang sudah siap.
7. Rekap menampilkan jumlah hari kerja, status setiap hari, bukti yang dipakai, hari UM, dasar tarif, dan nominal.

Hasil yang belum selesai harus tampak sebagai sementara atau pending. Sistem tidak menampilkan data belum ditinjau sebagai keputusan final.

## Tarif uang makan yang ditetapkan

Tarif harian yang disampaikan pengguna:

| Status pegawai | Golongan | Uang makan per hari |
| --- | --- | ---: |
| PNS | I–II | Rp35.000 |
| PPPK | I–VIII | Rp35.000 |
| PNS | III | Rp37.000 |
| PPPK | IX–XII | Rp37.000 |
| PNS | IV | Rp41.000 |
| PPPK | XIII–XVII | Rp41.000 |

Tarif ditentukan dari status PNS/PPPK dan golongan. Aturan tarif yang disampaikan belum menetapkan tarif berbeda berdasarkan jabatan. Data jabatan tetap menjadi bagian profil pegawai.

Perhitungan bruto memakai tarif per hari untuk jumlah hari yang valid dan memenuhi aturan UM:

```text
Bruto UM = jumlah tarif harian dari hari UM yang memenuhi syarat
```

Hari valid sebagai aktivitas kerja tidak otomatis menjadi hari UM. WFA tetap berhak UM sesuai klarifikasi pengguna, dengan bukti harian yang telah divalidasi. Status dinas, waktu, dan status kerja mengikuti aturan UM yang disahkan. Persentase PPh, pemotongan lain, dan rumus netto belum ditetapkan dalam klarifikasi tarif ini dan tidak boleh disimpulkan dari tabel tarif.

Data status atau golongan yang hilang/tidak valid harus ditandai untuk diperbaiki; tarif tidak boleh ditebak dari jabatan atau fallback golongan.

## Kesesuaian implementasi

Kode lokal sudah diperbarui untuk mengikuti alur dan aturan yang disepakati. Tabel ini menjelaskan perilaku implementasi; hasil tes lokal dan status deployment dicatat terpisah agar tidak disamakan.

| Area | Perilaku implementasi |
| --- | --- |
| Pemilihan bulan | Bulan proses dipilih dari bar atas dan disimpan sebagai periode ruang kerja. Admin/SDM diarahkan ke impor saat paket periode itu belum lengkap. |
| Kelengkapan paket | Rekonsiliasi dan hasil UM dikunci sampai ada Mesin Offline, Mesin Online, serta register ST lengkap untuk Pusat dan tujuh Kanwil pada bulan yang dipilih. Kantor tanpa ST harus menyimpan pernyataan nihil dengan alasan dan akun pelaku. |
| Sumber setara | Mesin Offline, Mesin Online, dan ST ditampilkan sebagai bukti yang setara. Tidak ada urutan sumber yang otomatis menentukan data final. |
| Keputusan harian | Admin/SDM/reviewer memilih bukti absensi dan ST, menetapkan status, serta mengisi alasan. Pilihan, waktu, dan pelaku tersimpan di workspace. Perubahan bukti atau identitas membuat keputusan lama perlu ditinjau ulang. |
| Cakupan harian | Matriks menghitung target hari-orang sesuai kalender aktif dan menampilkan hari valid, flag, tidak ditemukan, atau belum berlangsung. “Tidak ditemukan” tidak otomatis menjadi tanpa keterangan. |
| Perhitungan progresif | Setelah keputusan suatu hari sah dan tidak ada isu terbuka, UM untuk pegawai yang sudah memenuhi syarat dapat dihitung meski hari pegawai lain masih perlu ditinjau. Bruto yang siap tampil terpisah dari hasil yang pending. |
| Tarif dan WFA | Tarif bruto mengikuti tabel PNS/PPPK pada dokumen ini. Golongan tak dikenal tidak diberi tarif tebakan. WFA tetap dihitung setelah bukti hari divalidasi; aturan ini dipaksakan pada konfigurasi server. |
| Pajak dan pengajuan | PPh/netto tidak dihitung dari angka asumsi. Parameter PPh dimulai sebagai draf 0% dan memerlukan input serta pengesahan terpisah. Pengajuan satu periode seluruh KPPU tetap terkunci sampai seluruh hari, nominal, dan parameter pengajuan siap. |

Referensi kode: [pemeriksaan paket bulanan](../src/engine/monthlyFlow.ts), [keputusan harian](../src/engine/dayReview.ts), [engine rekonsiliasi dan UM](../src/engine/reconcile.ts), [pemetaan tarif](../src/engine/policy.ts), [halaman impor](../src/pages/ImportPage.tsx), [matriks rekonsiliasi](../src/pages/ReconcilePage.tsx), dan [halaman uang makan](../src/pages/MealPage.tsx).

## Batas bukti dan hal yang belum ditetapkan

- Implementasi dan tes lokal tidak dengan sendirinya membuktikan deployment live berhasil atau aturan operasional telah disahkan.
- Daftar master pegawai harus dipastikan sebagai daftar seluruh pegawai KPPU.
- Kalender resmi per bulan harus dicocokkan; daftar hari libur konfigurasi saat ini masih perlu pemeliharaan.
- Aturan kelayakan UM selain tarif, termasuk perlakuan dinas dan ketentuan jam, perlu memiliki dasar kebijakan yang disahkan.
- Tarif PPh/pemotongan dan pengelolaan perubahan golongan/status di tengah bulan perlu ditetapkan terpisah bila digunakan.
