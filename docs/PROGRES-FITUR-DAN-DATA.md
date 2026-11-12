# KPPU HR — Progres Fitur dan Data

Tanggal penyusunan: **20 Oktober 2026**. Acuan kode: revisi `df1f139`.

Dokumen ini menjelaskan kemampuan website dari sudut pandang pekerjaan SDM/Keuangan, data yang diolah, hasil yang dihasilkan, dan perubahan dari [progres FE demo sebelumnya](PROGRES-FITUR-FRONTEND.md). Dasarnya adalah penelusuran kode saat penyusunan, bukan klaim bahwa semua alur telah digunakan atau disahkan secara operasional.

Dokumen ini tidak menghitung ulang isi workspace yang sedang dipakai. Jumlah file, pegawai, kasus, dan nominal aktual harus dibaca dari dataset/periode yang diperiksa. Angka pada narasi demo lama bukan jumlah data terbaru.

## 1. Arah produk dan progres utama

Fokus produk tetap **mengolah sumber absensi yang berbeda menjadi rekap kehadiran dan usulan uang makan yang dapat ditelusuri kembali ke buktinya**.

Alur inti dipertahankan:

1. Unggah sumber offline, online, dan rekap surat tugas untuk periode yang hendak diperiksa.
2. Periksa hasil pembacaan, kantor, tanggal, kelengkapan, dan dampak perubahan sumber.
3. Satukan identitas yang memang orang yang sama; selesaikan peserta ST yang belum tertaut.
4. Lengkapi master pegawai dan data yang diperlukan untuk tarif/pajak.
5. Tinjau status harian, bukti yang bertentangan, dan keputusan rekonsiliasi.
6. Hitung hari yang memenuhi syarat serta bruto, PPh, dan netto yang sudah memiliki dasar.
7. Ajukan hasil per periode/kantor, tinjau dengan akun berbeda, lalu kunci snapshot.
8. Bila ada koreksi setelah penguncian, buat versi pengganti dan bandingkan selisihnya.

Perkembangan utama dari demo adalah **pengendalian perubahan data**. Upload, pencocokan, koreksi, dan pengajuan kini memiliki langkah peninjauan yang lebih jelas. Website tetap bergantung pada mutu file, kecocokan periode, identitas, dan aturan yang dikonfirmasi oleh SDM/Keuangan.

### Cara membaca status dalam dokumen

| Status | Arti |
| --- | --- |
| Tersedia dalam implementasi | Ada jalur fungsi dan pengolahan datanya dalam kode yang diperiksa. |
| Terbatas / bersyarat | Ada fungsi, tetapi hanya untuk format, data, hak akses, atau kondisi tertentu. |
| Pratinjau / simulasi | Dapat dilihat/dicoba sebagai contoh; belum mengeksekusi tindakan operasional terkait. |
| Rencana | Masih berupa usulan, narasi, atau kebutuhan data. |

## 2. Data yang menjadi dasar fitur

### 2.1 Tiga kelompok sumber operasional

| Kelompok | Data yang dibawa | Kegunaan | Batas bukti |
| --- | --- | --- | --- |
| Absensi offline | Identitas mesin, nama, tanggal, scan masuk/pulang, jadwal, kode pengecualian, dan lembur jika tersedia. | Memeriksa pasangan jam dan status harian dari mesin/rekap kantor. | Cakupan ekspor dan kantor harus benar; ekspor yang belum selesai tidak membuktikan ketidakhadiran penuh. |
| Absensi online | Identitas, nama/unit, WFO/WFA, jam atau kode harian, approval, lokasi/koordinat jika tersedia. | Melengkapi bukti WFO/WFA dan membandingkannya dengan sumber lain. | Ekspor rinci dengan jam berbeda kekuatan buktinya dari matriks status tanpa jam. |
| Rekap surat tugas | Nomor/tanggal surat, peserta, NIP bila tersedia, rentang kegiatan, tujuan, kantor/unit. | Menentukan konteks dinas dan mendeteksi benturan dengan presensi. | Rekap ST bukan bukti bahwa uang harian sudah ditransfer; peserta harus tertaut ke pegawai yang tepat. |

File nyata tersedia di direktori kerja `hr_kppu/Rekap ST` dan `hr_kppu/Rekap ST 2`, termasuk ekspor offline, matriks online, dan register ST. Keberadaan file di folder tidak berarti seluruh isinya telah diimpor, benar, atau lengkap untuk satu bulan.

**Tiga file untuk bulan yang sama adalah bahan awal pengujian gabungan, bukan jaminan kelengkapan bulan.** Tetap perlu memeriksa kantor, rentang tanggal, peserta, jam yang tersedia, karantina, serta konfirmasi kelengkapan ST.

### 2.2 Lapisan data yang dibedakan

| Lapisan | Isi | Arti bagi pengguna |
| --- | --- | --- |
| Sumber asli | Workbook yang diunggah dan identitas isi file. | Dasar penelusuran saat hasil perlu dikonfirmasi. |
| Hasil pembacaan | Bukti presensi, peserta ST, master yang dikenali, peringatan, dan karantina. | Menunjukkan bagian file yang berhasil atau belum berhasil dipahami. |
| Bukti aktif | Bagian sumber yang dipilih dan masih berlaku setelah revisi/review. | Hanya bukti aktif yang dipakai membentuk roster dan kalkulasi. |
| Master pegawai | Profil yang diimpor atau dimasukkan manual. | Melengkapi field yang tidak tersedia di absensi. |
| Field turunan | Misalnya tanggal lahir, jenis kelamin, dan status tertentu dari struktur NIP. | Tetap dibedakan dari field yang diverifikasi/dimasukkan melalui master. |
| Keputusan manusia | Mapping identitas, resolusi isu, pengeluaran/aktivasi kembali catatan, beserta alasan. | Menjelaskan mengapa hasil berbeda dari pembacaan awal sumber. |
| Hasil hitung berjalan | Status harian, isu, hari UM, dan nominal berdasarkan sumber/aturan saat ini. | Berubah bila data atau keputusan yang relevan berubah. |
| Snapshot pengajuan | Salinan hasil periode/kantor, aturan, referensi sumber, dan revisi data saat pengajuan. | Menjaga hasil yang diajukan tetap dapat dibandingkan dengan versi berikutnya. |

Roster adalah hasil penyatuan master dan sumber aktif. Roster belum otomatis menjadi daftar resmi seluruh pegawai KPPU. Model logis pada tabel ini juga tidak berarti semua entitas telah menjadi tabel HRIS terpisah seperti rancangan lama.

## 3. Peta fitur saat ini

| Halaman / area | Kemampuan utama | Posisi dibanding demo |
| --- | --- | --- |
| Ringkasan Kehadiran | KPI, komposisi status per hari, rekap unit, pantauan TK/terlambat, indikasi cakupan data. | Dipertahankan; makna angka mengikuti sumber aktif dan rekonsiliasi. |
| Impor Sumber | Baca file, preview, diff, pilihan penambahan/penggantian, kelengkapan, penelusuran catatan. | Diperluas untuk revisi dan pemeriksaan dampak. |
| Pencocokan Identitas | Identifier kuat, kandidat nama, konflik, mapping/merge manual. | Diperketat agar kemiripan nama tidak langsung menggabungkan orang. |
| Rekonsiliasi | Antrean kasus, matriks harian, detail bukti, keputusan dan koreksi catatan. | Dipertahankan dan diperkuat keterkaitannya dengan perubahan sumber. |
| Uang Makan | Kelayakan harian, nominal siap/pending, parameter, nominatif dan ekspor. | Aturan wajib dan arti hasil diperjelas. |
| Pengajuan & snapshot | Ajukan, setujui, kunci, batalkan pengajuan yang belum terkunci, dan koreksi versi. | Penambahan pada halaman Uang Makan. |
| People Dashboard | Komposisi pegawai, unit/kantor, demografi, kelengkapan, ulang tahun. | Dipertahankan sebagai ringkasan roster. |
| Data Pegawai | Direktori, profil, alias, kehadiran, status kerja dan tarif efektif bertanggal. | Profil diperluas. |
| Tambah Data | Template, bulk import master, preview perubahan dan input manual. | Validasi dan pencocokan master diperketat. |
| Automation Center | Penautan WA lewat QR, status sesi, template dan indikator kesiapan komunikasi. | Koneksi dan pratinjau pesan kini perlu dibedakan. |
| Ruang Kerja & Akses | Password, akun/peran, cakupan kantor, backup/restore, nihil ST dan riwayat perubahan. | Halaman tambahan. |
| Peta Fitur & Data | Temuan sampel, usulan, rancangan dan alur presentasi. | Masih tersedia; sebagian narasinya tertinggal dari perkembangan fitur. |

## 4. Impor sumber dan pengelolaan revisi

### Yang tersedia

- Upload beberapa `.xls`/`.xlsx` melalui pemilih file atau drag and drop.
- Pengenalan format dari struktur isi workbook; kantor dapat dibantu oleh informasi nama file/header dan diperiksa pengguna.
- Hasil baca per file: jenis, kantor, rentang periode, jumlah bukti/nama, peringatan, karantina, versi parser, dan identitas isi file.
- Pemilihan urutan tanggal mesin `DD/MM/YYYY` atau `MM/DD/YYYY` bila interpretasinya ambigu.
- Deteksi isi identik agar upload ulang tidak otomatis menambah sumber baru.
- Matriks cakupan sumber per kantor: **Mesin Offline**, **Mesin Online**, rekap manual/laporan, dan ST.
- Penanda kantor yang hanya terpantau dari Mesin Online.

### Format yang dapat dibaca

| Format | Hasil utama |
| --- | --- |
| Ekspor mesin harian | Jam masuk/pulang, jadwal, identitas, pengecualian dan lembur yang tersedia. |
| Ekspor rinci presensi HP | WFO/WFA, jam, approval, lokasi/koordinat dan unit. |
| Matriks online bulanan | Kode WFO/WFA/dinas/cuti/sakit per tanggal; **tidak menambahkan jam yang tidak ada di sumber**. |
| Matriks transaksi mesin Kanwil | Pegawai/nomor mesin × tanggal, termasuk pasangan jam dalam sel. |
| Jadwal absen manual Kanwil | Sheet bulanan, keterangan, jam dan indikasi absen error. |
| Laporan kode harian Kanwil | Kode status tanpa jam, mengikuti legenda format terkait. |
| Rekap surat tugas | Nomor surat, peserta, tanggal kegiatan, tujuan dan unit. Variasi register serta header bertingkat ditangani oleh parser terkait. |

Workbook tertentu juga dapat menyertakan sheet master yang dikenali. Master tersebut tetap perlu diperiksa; pada mode pilih register ST, baris master bawaan tidak otomatis diaktifkan.

### Perlakuan terhadap data baru

1. **Tambah sumber:** memasukkan data tambahan tanpa menganggap seluruh dataset lama sudah diganti.
2. **Ganti seluruh dataset:** pengguna memilih dataset lama dan menyatakan bahwa file baru adalah snapshot lengkap. Data yang tidak muncul lagi dapat berhenti aktif dalam scope tersebut.
3. **Pilih register ST:** pengguna memilih register baru dan, bila diperlukan, register lama yang diganti. Register lain tidak ikut dinonaktifkan.

Sebelum konfirmasi, tersedia diff catatan **tambah, berubah, keluar dari scope, ambigu, duplikat, dan tetap**, beserta field/referensi yang berubah. Preview juga menunjukkan dampak terhadap status harian, hari UM, nominal, dan isu bila dapat dihitung.

Alasan impor dan konfirmasi pemeriksaan diperlukan. Bila pilihan atau revisi data berubah, preview lama harus dihitung ulang. Penggantian tidak lagi ditentukan hanya karena nama file sama.

### Penelusuran dan penarikan sumber

- Detail sumber menampilkan bukti/penugasan, nama, tanggal, nomor ST atau jam, serta referensi sheet/baris.
- Catatan dapat dicari dan dibuka untuk review individual.
- Status catatan membedakan aktif, dikeluarkan, diganti revisi register, dan tidak dipilih saat impor.
- Sumber dapat ditarik dari kalkulasi; arsip tetap dipertahankan.
- Kantor asal sumber tertentu dapat dikoreksi sesuai kewenangan.

**Batas:** upload masih manual. Dukungan parser mengikuti format yang dikenali; belum ada pembacaan universal semua Excel, sinkronisasi mesin/aplikasi otomatis, atau editor bebas untuk mengubah jam/tanggal asli. Koreksi nilai sumber dilakukan melalui file revisi dan pemeriksaan dampak.

## 5. Pencocokan identitas dan merge pegawai

### Yang tersedia

- Penyatuan bukti memakai NIP, NIKA/ID aplikasi, dan nomor mesin dalam konteks kantor bila identifier tersebut sudah dikenali.
- Kandidat nama dengan skor kemiripan token, inisial, dan variasi penulisan untuk membantu pemilihan manusia.
- Mapping manual identitas absensi dan peserta ST ke profil pegawai.
- Merge profil yang memang duplikat, pilihan mempertahankan orang berbeda, dan konfirmasi sebagai pegawai tersendiri.
- Pilihan mengabaikan nama ST yang bukan pegawai relevan.
- Antrean peserta ST belum tertaut, identitas absensi tanpa NIP, serta tautan/keputusan yang sudah terbentuk.
- Konflik nama sama atau NIP berbeda yang membutuhkan pemeriksaan.
- Alias NIP, NIKA, ID aplikasi, nomor mesin, dan variasi nama beserta asalnya pada profil.

### Perubahan penting pada makna merge

**Menggabungkan sumber tidak sama dengan menggabungkan orang.** Bukti dari beberapa file boleh dikumpulkan, tetapi kemiripan nama saja tidak lagi cukup untuk menautkan identitas secara otomatis. NIP berbeda tidak otomatis dianggap orang yang sama.

Nama peserta ST tanpa identifier kuat perlu keputusan eksplisit. Rekap ST sendiri tidak membuat profil pegawai baru hanya dari nama peserta. NIP kosong pada peserta lanjutan juga tidak boleh mengambil NIP peserta sebelumnya.

Identifier panjang yang disimpan sebagai angka dan berisiko kehilangan digit diberi penanda untuk diverifikasi; sistem tidak menebak kembali digit yang sudah hilang. Risiko identitas yang belum selesai dapat menahan UM. Peserta ST belum tertaut juga dapat menahan hari UM pada kantor/tanggal terkait agar dinas yang belum terpetakan tidak terlewat.

**Batas:** pemilihan manusia masih diperlukan untuk nama singkatan, identifier salah, dan sumber tanpa identitas kuat. Roster dapat memuat profil terpisah sampai pemetaan diselesaikan; jumlah profil sebelum itu bukan angka pegawai final.

## 6. Rekonsiliasi kehadiran

### Antrean kasus dan matriks

- Antrean isu per pegawai, dengan pengelompokan tanggal/kasus, tingkat keparahan, status terbuka/selesai, filter kantor/jenis, dan pencarian.
- Matriks pegawai × tanggal dengan kode status, legenda, penanda isu, dan akses detail hari.
- Status yang dibedakan: hadir kantor, hadir WFA, dinas lokal, dinas luar, diklat/konsinyering, cuti, sakit, izin, tidak lengkap, tanpa keterangan, belum ada data, libur, dan belum berlangsung.
- Detail hari memuat dasar status, pasangan jam terpilih, keterlambatan, pulang cepat, lembur tercatat, bukti presensi, ST, sumber, dan alasan kelayakan UM.

### Isu yang dideteksi

| Isu | Tujuan pemeriksaan |
| --- | --- |
| Pasangan scan berbeda antarsumber | Memastikan pasangan jam yang sah sebelum menetapkan kelayakan. |
| Dinas tetapi scan kantor | Memeriksa benturan penugasan dan kehadiran; hari berangkat/pulang diberi konteks. |
| Cuti/sakit tetapi ada jam hadir | Memeriksa pembatalan atau kesalahan keterangan. |
| ST tumpang tindih | Meninjau rentang dan dasar penugasan yang beririsan. |
| PD tanpa ST yang mencakup tanggal | Meminta klarifikasi ketika register tersedia tetapi belum cocok. |
| ST tanpa nomor | Memeriksa dasar penugasan. |
| Presensi daring ditolak | Memperlihatkan bukti yang tidak diterima. |
| Scan tidak lengkap | Meminta bukti masuk/pulang yang belum tersedia. |
| WFO jauh dari titik perkiraan kantor | Menyediakan indikasi lokasi untuk ditinjau. |
| Jam identik dengan hari sebelumnya | Menandai indikasi yang perlu diperiksa, bukan langsung membuktikan pelanggaran. |
| Jam manual / absen error | Meminta dasar pendukung. |
| Jadwal puasa di luar rentang | Menandai ketidaksesuaian jadwal sumber. |
| Hadir pada hari libur | Bahan pemeriksaan lembur/SPKL. |
| WFA saat perjalanan dinas | Memperlihatkan benturan presensi dan penugasan. |

Tidak semua isu memblokir UM. Dampak mengikuti jenis isu dan status harian. Namun, pengajuan snapshot memerlukan penyelesaian isu terbuka pada cakupan pegawai yang diajukan.

### Keputusan isu dan koreksi catatan adalah dua tindakan berbeda

**Keputusan isu** menjelaskan hasil klarifikasi: misalnya akui dinas, akui hadir bila kondisinya memungkinkan, tidak hadir, atau sudah ditinjau. Ada catatan, aktor, waktu, serta keterkaitan dengan bukti. Perubahan fakta yang relevan dapat membuat keputusan lama tidak berlaku untuk hasil terbaru.

**Koreksi catatan sumber** mengeluarkan atau mengaktifkan kembali satu bukti presensi/peserta ST. Sebelum menyimpan, pengguna melihat status, jam, kelayakan, nominal, dan isu sebelum–sesudah, mengisi alasan, lalu mengonfirmasi. Catatan asli dan riwayat keputusan tetap tersedia; peserta/bukti lain tidak otomatis ikut dikeluarkan.

Keputusan “akui hadir” bukan jalan pintas untuk membayar hari dinas yang masih memiliki dasar ST/PD/DL aktif. Dasar sumber yang salah perlu direvisi atau ditangani melalui koreksi catatan yang sesuai.

### Aturan menjaga kekuatan bukti

- Jam masuk dari baris A tidak dirakit dengan jam pulang dari baris B agar seolah-olah menjadi satu bukti lengkap.
- Pasangan jam berbeda antarsumber menimbulkan isu yang memblokir.
- Sumber status tanpa jam tidak otomatis membuktikan kehadiran tepat waktu.
- Hari setelah tanggal analisis dibedakan sebagai belum berlangsung.
- Hari tanpa sumber tidak langsung dianggap TK; ekspor parsial memiliki penanganan tersendiri.

**Batas:** geolokasi memakai titik perkiraan dari kumpulan koordinat WFO, bukan master titik kantor resmi. Modul ini belum menetapkan sanksi disiplin, menerbitkan SPKL, atau membuktikan pembayaran uang harian.

## 7. Ringkasan Kehadiran

Fitur yang dipertahankan:

- Pemilihan periode global dan filter kantor.
- KPI pegawai terpantau, hadir/bertugas, hari dinas, TK, bukti tidak lengkap, dan isu perlu ditinjau.
- Grafik batang bertumpuk atau tabel komposisi status per hari kerja.
- Rekap per unit: jumlah pegawai, proporsi hadir/bertugas, keterlambatan, TK dan dinas.
- Pantauan pegawai dengan TK/keterlambatan pada bulan terpilih dan tautan ke profil.
- Jam lembur tercatat per kantor sebagai bahan pemeriksaan.
- Insight ekspor belum lengkap, WFA Jumat, kantor hanya dari HP dan keterlambatan.

Angka menggambarkan roster dan cakupan bukti yang tersedia. Persentase kehadiran bukan otomatis tingkat kehadiran seluruh pegawai KPPU; pantauan disiplin bulanan belum menjadi akumulasi tahunan atau keputusan hukuman.

## 8. Uang makan: kelayakan, nominal, dan ekspor

### 8.1 Hasil per hari dibedakan

| Hasil | Arti |
| --- | --- |
| Hari memenuhi syarat, nominal siap | Bukti dan aturan kelayakan terpenuhi; dasar nominal tersedia. |
| Hari memenuhi syarat, nominal pending | Hari dapat dihitung, tetapi dasar golongan/tarif atau pengesahan parameter belum siap. |
| Ditahan | Bukti, identitas, waktu analisis, atau klarifikasi tertentu belum selesai. |
| Tidak memenuhi syarat | Status atau aturan yang berlaku menggugurkan hari tersebut. |

Status “memenuhi syarat” dan angka netto terhitung **belum merupakan bukti sudah dibayar**.

### 8.2 Rule yang ditemukan saat ini

| Kondisi | Perlakuan dalam implementasi |
| --- | --- |
| WFO dengan bukti lengkap dan memenuhi syarat | Dapat dihitung sebagai hari UM. |
| WFA dengan bukti yang memenuhi syarat | **Dihitung secara default** melalui `countWfa: true`. Sesuai keterangan pengguna pada 20 Oktober 2026 bahwa WFA di KPPU tetap berhak UM. |
| Kode WFA/WFO tanpa pasangan jam | Tidak cukup untuk membuktikan ketepatan waktu; belum otomatis eligible. |
| Masuk setelah 08:00 | Gugur tanpa toleransi; lembur tidak menghapus keterlambatan tersebut. |
| Tepat 08:00:00 | Ditahan bila operator batas belum dipilih; lolos syarat kedatangan jika dipilih `≤ 08:00`, gugur jika dipilih `< 08:00`. |
| Pulang sebelum jadwal | Menggugurkan jika parameter pulang cepat aktif; default aktif. |
| Dinas lokal maupun luar | Tidak dihitung sebagai hari UM dalam aturan yang ditegakkan saat ini. |
| Cuti, sakit, izin, diklat/konsinyering, TK | Tidak dihitung sebagai hari UM. |
| Tugas belajar / diperbantukan | Menggugurkan pada rentang status kerja efektif yang dicatat. |
| Pegawai nonaktif | Tidak dihitung. |
| Hari libur | Tidak dihitung sebagai UM hari kerja. |
| Bukti belum lengkap, ekspor parsial, identitas berisiko, atau isu pemblokir | Ditahan sesuai alasan. |
| Non-ASN | Ditahan secara default sampai dasar penyertaan dipastikan melalui parameter terkait. |
| Golongan tidak diketahui dan tidak ada tarif efektif pegawai yang berlaku | Nominal pending, bukan langsung dibayar memakai golongan asumsi. |
| Tarif efektif pegawai sudah digunakan tetapi tanggal di luar rentangnya | Nominal hari tersebut pending. |
| Parameter belum disahkan | Nominal belum dinyatakan siap. |

WFA tidak dikeluarkan hanya karena bekerja dari luar kantor. **Pengaturan “WFA dihitung hadir” masih bisa dimatikan**, sehingga default kode perlu dibedakan dari nilai aturan yang tersimpan pada workspace tertentu. Klarifikasi pengguna mengenai WFA tidak otomatis menghapus syarat jam, review, atau dasar nominal lainnya.

Scan masuk/pulang lengkap, tepat waktu tanpa toleransi, penolakan UM untuk dinas, dan penahanan isu pemblokir ditegakkan oleh engine. Pilihan lama yang melonggarkan kewajiban tersebut tidak lagi menjadi alternatif perhitungan.

### 8.3 Parameter dan data tarif

- Admin/Keuangan dapat memilih operator batas 08:00, mengesahkan parameter, mengatur tarif/PPh, hari libur, WFA, pulang cepat, dan penyertaan Non-ASN sesuai kontrol yang tersedia.
- Pilihan menonaktifkan penahanan isu pemblokir tidak melonggarkan engine karena aturan tersebut tetap ditegakkan.
- Jadwal fallback normal adalah Senin–Kamis 08:00–16:00 dan Jumat 08:00–16:30; jadwal sumber yang dikenali juga berperan dalam evaluasi jam pulang. Ini belum menjadi pengelolaan lengkap riwayat jadwal tiap pegawai/kantor.
- Tarif efektif pegawai dan persentase pajak dapat dicatat per rentang tanggal beserta dasar dokumennya.
- Tarif/pajak harian dipakai dalam akumulasi bulanan; pembulatan PPh dihitung pada rekap pegawai/bulan.

Nilai awal kode, **bukan penetapan tarif resmi**:

| Kelompok | Tarif awal per hari | PPh awal |
| --- | ---: | ---: |
| I | Rp35.000 | 0% |
| II | Rp35.000 | 0% |
| III | Rp37.000 | 5% |
| IV | Rp41.000 | 15% |

Ada pemetaan kelompok golongan PNS/PPPK. Tarif, pemetaan, kalender, serta perlakuan selain klarifikasi WFA yang telah diberikan tetap perlu dicocokkan dengan kebijakan yang digunakan SDM/Keuangan.

### 8.4 Tinjauan nominatif dan ekspor

- Pencarian nama/NIP/unit, filter kantor, dan urutan nama, hari UM, hari ditahan atau netto.
- Rekap hari kerja/hadir/UM/ditahan, tarif, bruto, PPh, netto, serta peringatan NIP/golongan kosong.
- Detail harian dengan jam, status, alasan, nominal, dan bukti.
- Ekspor hasil berjalan mengikuti filter daftar, dengan sheet **Nominatif**, **Rincian Harian**, **Ditahan**, **Review Sumber**, dan **Parameter**.
- Nominal pending dibedakan dalam ekspor agar tidak terbaca sebagai tarif final yang sudah disahkan.

## 9. Pengajuan, snapshot, penguncian dan koreksi versi

### Alur yang tersedia

1. SDM/admin memilih periode dan cakupan kantor untuk pengajuan.
2. Hasil dihitung dari revisi data saat pengajuan; identitas, isu, hari ditahan, nominal pending, parameter dan kelengkapan ST diperiksa.
3. Akun Keuangan/admin yang berbeda dari pengaju dapat menyetujui, kemudian mengunci.
4. Pengajuan yang belum terkunci dapat dibatalkan sesuai kewenangan dan disertai alasan.
5. Pengajuan terkunci tetap menjadi snapshot; perubahan data berjalan tidak diam-diam menulis ulang isinya.

Kelengkapan register ST perlu dikonfirmasi sampai akhir bulan untuk kantor terkait. Jika benar-benar tidak ada ST, tersedia **pernyataan nihil ST** dengan kantor, bulan, aktor dan dasar konfirmasi. File kosong tidak otomatis dianggap pernyataan nihil.

Hari pegawai yang masuk pengajuan dilindungi dari klaim ganda. Perubahan data setelah pengajuan juga diperiksa sebelum persetujuan/penguncian. Ini adalah pengendalian usulan, bukan integrasi pencairan.

### Koreksi setelah penguncian

- Membuat versi pengganti dari snapshot terkunci, dengan alasan dan rujukan versi induk.
- Menampilkan perubahan hari serta bruto/PPh/netto per pegawai–tanggal.
- Memerlukan persetujuan dan penguncian ulang; satu versi tidak memiliki beberapa usulan koreksi aktif bersamaan.
- Versi lama tetap tersimpan dan ditandai sebagai arsip yang digantikan setelah versi pengganti dikunci.
- Dapat menangani pengurangan seluruh hak menjadi nol maupun rantai koreksi berikutnya.
- Ekspor snapshot mencakup nominatif, rincian, parameter, referensi sumber dan review sumber bila ada; koreksi menambah sheet selisih.

**Batas:** selisih koreksi adalah bahan pemeriksaan. Website belum menjalankan transfer, menandai transaksi bank, menerbitkan bukti pencairan, atau otomatis menagih pengembalian. File Excel yang pernah diunduh tetap salinan pada waktu unduh.

## 10. Kepegawaian: dashboard, direktori dan master

### People Dashboard

- Komposisi PNS/PPPK/Non-ASN/status belum diketahui.
- Sebaran unit dan kantor, kelompok usia, rata-rata usia, serta rasio jenis kelamin dari field yang tersedia.
- Kelengkapan NIP, golongan, jabatan, WhatsApp, agama, email dan tanggal lahir.
- Ulang tahun dalam 30 hari, dengan akses ke profil dan pratinjau komunikasi.

Dashboard memakai roster, bukan data pegawai contoh yang harus dianggap lengkap. Field turunan NIP membantu pengisian awal, tetapi tidak menggantikan pemeriksaan master.

### Direktori dan profil

- Pencarian nama, NIP, NIKA, unit dan alias; filter kantor/status.
- Identitas utama, sumber pembentuk profil, variasi nama, field turunan dan profil tambahan.
- Ringkasan kehadiran/isu/UM pada periode aktif serta ST terkait.
- Edit terbatas untuk NIP, golongan, jabatan, WhatsApp, email dan agama oleh peran yang berwenang.
- **Status kerja bertanggal:** tugas belajar dan diperbantukan, dengan rentang efektif dan dasar dokumen.
- **Tarif efektif bertanggal:** tarif dan PPh per pegawai yang dikelola Keuangan/admin.
- Pemeriksaan rentang terbalik atau tumpang tindih dan pencabutan periode terkait sesuai kewenangan.

**Batas:** belum ada pengelolaan lengkap berkas personal, workflow mutasi, history kantor/jadwal yang menyeluruh, atau editor profil penuh untuk seluruh field.

### Tambah data dan bulk master

- Download template master beserta petunjuk.
- Baca `.xlsx`, `.xls`, dan `.csv`; seluruh sheet master yang dikenali diperiksa.
- Preview semua baris melalui paginasi, referensi sheet/baris, target pegawai, serta perubahan field sebelum–sesudah.
- Pencocokan pembaruan memakai NIP/NIKA; nama tidak digunakan untuk otomatis menggabungkan master.
- Baris satu identifier yang kompatibel dapat digabung dalam satu batch; konflik, identifier berisiko, atau field tidak valid menahan seluruh batch.
- Field kosong tidak menghapus nilai lama.
- Konfirmasi pemeriksaan sebelum simpan; input manual menggunakan pemeriksaan identitas/field yang terkait.

Kolom template: NIP, NIKA, nama, kantor, unit, status, golongan, jabatan, tanggal/tempat lahir, jenis kelamin, agama, WhatsApp, email, pendidikan, disiplin ilmu, pelatihan, tanggal mulai kerja, alamat, nama/nomor kontak darurat dan status perkawinan. Form manual menyediakan subset identitas dan kepegawaian.

Workbook contoh sintetis tetap harus dibedakan dari sumber master resmi. Dokumen ini tidak menyatakan bahwa seluruh dataset aktif telah diperiksa bebas data sintetis.

## 11. Automation Center dan WhatsApp

### Penautan akun

- Admin dapat meminta QR untuk penautan perangkat WhatsApp melalui sesi Baileys.
- Ada status belum terkonfigurasi, menghubungkan, QR, terhubung, menyambung ulang, keluar dan error.
- Bila tersedia, ditampilkan nomor serta waktu koneksi.
- Tersedia putus perangkat/reset sesi dan mekanisme pemulihan sesi tersimpan secara terenkripsi.
- Pengelolaan QR/status koneksi dibatasi kepada admin.

Ini perubahan dari QR/koneksi simulasi pada FE demo. Keberadaan implementasi ini tidak membuktikan bahwa nomor tertentu sedang terhubung saat dokumen dibaca.

### Kesiapan data dan pratinjau pesan

- Indikator pegawai dengan tanggal lahir, kelengkapan WhatsApp/agama, serta hari dengan masuk tanpa pulang.
- Antrean ulang tahun 30 hari.
- Filter pesan publik, tersegmentasi dan personal; pilihan template, placeholder, pratinjau isi serta penanda privasi.
- Lima belas template: lupa scan pulang, presensi ditolak, ulang tahun, hari raya, masa kerja, pelatihan, konfirmasi data, perubahan jabatan, perubahan hari/jam kerja, keselamatan, e-Kinerja/SPT, kelahiran anak, belasungkawa, slip gaji tersedia dan pembaruan klaim kesehatan.

**Pengiriman pesan masih nonaktif.** Toggle template dan pratinjau belum menjadi aturan operasional yang tersimpan/dijalankan; state aturan kembali mengikuti state komponen saat halaman dimuat ulang. Belum ada penjadwalan, pemilihan penerima operasional, antrean kirim, retry, atau status delivery. Template payroll/klaim/pelatihan/kinerja tidak berarti modul-modul tersebut sudah tersedia.

## 12. Ruang kerja, akses dan jejak perubahan

### Fungsi pengguna

- Masuk/keluar akun dan menampilkan identitas pengguna sebagai aktor keputusan.
- Ganti password sendiri dengan pencabutan sesi lain.
- Admin membuat akun dengan peran dan cakupan kantor; UI pembuatan mendukung satu kantor atau semua kantor.
- Penanda revisi dan status penyimpanan; bila gagal tersimpan, pengguna dapat membuat backup, mencoba simpan kembali, atau memuat data tersimpan.
- Pemutakhiran data pengguna lain saat tidak ada perubahan lokal tertunda; benturan revisi tidak ditimpa diam-diam.
- Backup JSON ruang kerja; admin dapat memeriksa preview dan memulihkan backup dengan konfirmasi.
- Pembacaan data prototype lokal secara eksplisit sebagai jalur migrasi; data lokal lama tidak langsung dihapus.
- Restore point sebelum pemulihan dan riwayat perubahan material yang dapat dimuat sesuai kewenangan.
- Pernyataan nihil ST untuk kantor/bulan yang telah dikonfirmasi.

### Pembagian kewenangan utama

| Peran | Fokus tindakan |
| --- | --- |
| Admin | Mengelola akun, sumber/profil/keputusan, parameter, pemulihan dan koneksi WA; tetap tidak boleh menyetujui pengajuan sendiri. |
| SDM (`hr`) | Sumber, identitas, master/profil dan status kerja, koreksi catatan, rekonsiliasi, nihil ST, serta pengajuan. |
| Reviewer | Keputusan rekonsiliasi; bukan pengubah tarif atau importir master. |
| Keuangan (`finance`) | Parameter UM, tarif efektif, serta persetujuan/penguncian pengajuan dari akun lain. |
| Viewer | Membaca data/hasil dalam cakupan aksesnya. |

Hak kantor membatasi data dan tindakan akun. Riwayat perubahan global pada halaman pengaturan tersedia untuk admin/reviewer/Keuangan dengan akses semua kantor. Beberapa kontrol lama masih dapat terlihat pada halaman bersama; kewenangan menyimpan tetap diperiksa, sehingga visibilitas tombol belum selalu sama dengan hak edit.

**Batas backup:** JSON ruang kerja tidak memuat byte workbook asli atau seluruh data aplikasi seperti akun, sesi WA dan semua snapshot pengajuan. Backup JSON bukan salinan lengkap seluruh arsip aplikasi. UI belum menyediakan pengelolaan akun lengkap atau penjelajah seluruh restore point meskipun ada dukungan tindakan tertentu di API.

## 13. KEEP / ADJUST / CUT dari progres FE demo

Pada tabel ini, KEEP berarti fungsi inti dipertahankan, ADJUST berarti fungsi tetap ada dengan perubahan perilaku/data, dan CUT berarti perilaku/asumsi lama ditinggalkan pada implementasi terkait. Ini bukan daftar penghapusan menu.

| Keputusan | Progres FE demo sebelumnya | Kondisi sekarang dan alasannya |
| --- | --- | --- |
| **KEEP** | Alur impor → identitas → rekonsiliasi → UM. | Tetap menjadi alur utama karena sesuai masalah pengolahan data lintas sumber. |
| **KEEP** | Upload manual dan parser sesuai variasi sumber. | Tetap dibutuhkan; dukungan diperluas ke matriks online dan variasi workbook/master. |
| **KEEP** | Bukti per hari dan referensi file/sheet/baris. | Dipertahankan sebagai dasar pemeriksaan dan koreksi. |
| **KEEP** | Antrean isu, matriks, dashboard dan profil. | Tetap memberi ringkasan dan akses ke bukti; bukan pengganti review. |
| **KEEP** | Ekspor nominatif Excel. | Tetap tersedia, dengan review sumber dan informasi pending; snapshot pengajuan memiliki ekspor tersendiri. |
| **KEEP** | WFA mendapat UM pada default aturan. | Tetap berlaku dengan syarat bukti/aturan lainnya; sesuai klarifikasi pengguna tentang KPPU. |
| **ADJUST** | Nama file sama langsung menggantikan sumber. | Kini ada pilihan tambah/ganti dataset/pilih register, preview diff, scope, alasan dan konfirmasi. |
| **ADJUST** | Penghapusan sumber sebagai aksi langsung. | Menjadi penarikan dari kalkulasi dengan arsip; koreksi dapat dilakukan per catatan. |
| **ADJUST** | Pencocokan nama dapat menghasilkan tautan otomatis. | Nama kini kandidat untuk review; identifier kuat dan keputusan eksplisit menjadi dasar penyatuan. |
| **ADJUST** | Preview master hanya contoh beberapa baris dan sheet pertama. | Seluruh sheet yang dikenali dan seluruh perubahan dapat ditinjau; satu masalah menahan batch. |
| **ADJUST** | Semua hasil eligible mudah dibaca sebagai “dibayar”. | Dipisah menjadi hari memenuhi syarat, nominal pending, pengajuan, persetujuan dan snapshot terkunci; pembayaran belum dicatat. |
| **ADJUST** | Rule UM berupa beberapa preset fleksibel. | Kewajiban scan lengkap/tepat waktu dan pengecualian dinas ditegakkan; batas tepat 08:00 perlu pilihan eksplisit. |
| **ADJUST** | Data golongan dan status diperlakukan tanpa rentang efektif yang memadai. | Ditambah tarif/pajak serta tugas belajar/diperbantukan bertanggal. History kantor/jadwal belum lengkap. |
| **ADJUST** | Nama reviewer diketik bebas. | Aktor tindakan baru mengikuti akun masuk; label lama dari backup tidak disamakan dengan audit tindakan baru. |
| **ADJUST** | Workspace hanya mengikuti browser demo. | Ada revisi bersama, pemeriksaan benturan, status simpan, backup/restore dan migrasi eksplisit data lokal lama. |
| **ADJUST** | UM berakhir pada hasil hitung dan download. | Ditambah pengajuan, persetujuan akun lain, snapshot, penguncian dan versi koreksi. |
| **ADJUST** | Seluruh Automation Center dianggap simulasi koneksi. | Penautan QR memiliki implementasi sesi; aturan pesan dan pengiriman tetap pratinjau/nonaktif. |
| **CUT** | Preset “tanpa syarat tepat waktu” dan toleransi 15 menit sebagai alternatif UM. | Tidak lagi menjadi jalur untuk meloloskan keterlambatan. |
| **CUT** | Dinas lokal dapat diloloskan lewat toggle lama. | Semua dinas dikecualikan oleh aturan yang ditegakkan saat ini. |
| **CUT** | Golongan kosong menghasilkan nominal dengan fallback kelompok III. | Golongan/tarif belum jelas menghasilkan nominal pending. |
| **CUT** | Status hadir tanpa jam dapat lolos hanya dengan catatan. | Pasangan jam dan ketepatan waktu tetap perlu dibuktikan. |
| **CUT** | Hapus massal seluruh data demo sebagai cara kerja rutin. | Jalur tersebut dinonaktifkan; penarikan sumber dan pemulihan dilakukan dengan jejak perubahan. |
| **ADJUST** | Data hilang dan ekspor parsial sudah dibedakan dari TK pada demo. | Prinsip dipertahankan dan diperluas dengan status belum berlangsung serta konfirmasi kelengkapan sumber; kosong bukan otomatis TK. |

### Rekomendasi ADJUST/CUT yang belum otomatis dikerjakan oleh dokumen ini

| Keputusan | Bagian yang perlu ditindaklanjuti | Alasan |
| --- | --- | --- |
| **ADJUST** | Narasi People Dashboard yang masih bertuliskan “tersimpan lokal”. | Label tersebut tidak menggambarkan jalur ruang kerja saat ini. |
| **ADJUST** | Peta Fitur & Data yang masih memakai jumlah sampel, alur presentasi dan status usulan lama. | Persetujuan/audit kini memiliki implementasi; pilihan demo aturan lama juga sudah berubah. Halaman ini belum menjadi inventaris progres otomatis. |
| **ADJUST** | Teks geofence dan pemeriksaan jadwal. | Titik perkiraan lokasi belum sama dengan geofence resmi; kemampuan koreksi/evaluasi jadwal tidak boleh dilebihkan. |
| **ADJUST** | Pengaturan WFA yang masih bisa dimatikan. | Bila kebijakan KPPU harus selalu menghitung WFA, kontrol tersebut perlu diselaraskan agar tidak menyalahi aturan organisasi. Belum dikunci permanen dalam kode saat ini. |
| **ADJUST** | Kontrol edit pada halaman bersama. | Sebaiknya selaras dengan hak peran agar pengguna tidak baru mengetahui penolakan saat simpan. |
| **CUT dari narasi progres** | Menyamakan template WA dengan modul payroll, klaim, LMS atau e-Kinerja. | Yang tersedia baru contoh pemberitahuan, bukan data/transaksi modul tersebut. |
| **CUT dari dasar operasional** | Data sintetis sebagai master resmi atau dasar nominatif. | Contoh/template boleh dipakai untuk belajar format; penggunaan data aktif harus diverifikasi terpisah. Ini bukan pernyataan bahwa pembersihan dataset dilakukan pada sesi dokumentasi ini. |

## 14. Yang belum menjadi fitur operasional lengkap

| Area | Fondasi yang ada | Yang masih diperlukan |
| --- | --- | --- |
| Kelengkapan data bulanan | Cakupan sumber, tanda ekspor parsial, lengkap sampai tanggal, nihil ST. | Konfirmasi sumber yang benar-benar lengkap per kantor/periode; status tanpa jam tetap memerlukan bukti lain. |
| Data pegawai lintas waktu | Master, alias, status kerja dan tarif efektif. | History kantor/unit/jadwal dan alur mutasi yang menyeluruh. |
| Aturan resmi UM | Engine, parameter dan pemisahan nominal pending. | Penetapan kalender, jadwal, kamus kode, tarif/pajak, pemetaan golongan dan operator 08:00 yang benar untuk penggunaan terkait. WFA telah diklarifikasi pengguna tetap berhak. |
| Pembayaran | Nominatif, approval dan snapshot/koreksi. | Integrasi pencairan, status bayar, bukti transfer dan penyelesaian kelebihan/kekurangan bayar. |
| ST digital | Impor register dan mapping/review peserta. | Form penerbitan, penomoran, persetujuan dan distribusi ST. |
| Uang lembur | Jam lembur/hadir hari libur sebagai indikasi. | Validasi SPKL, perhitungan tarif, pengajuan serta pembayaran lembur. |
| SPD / uang harian | Penugasan dan isu benturan dengan absensi. | Data transaksi SPD/uang harian dan rekonsiliasi pembayarannya. |
| Disiplin | Pantauan bulanan TK/terlambat. | Akumulasi tahunan, validasi dan alur pembinaan formal. |
| Sinkronisasi | Upload file manual. | Pengambilan mesin/aplikasi terjadwal dan log sinkronisasi. |
| Geofence / kalender | Koordinat sumber, titik perkiraan dan parameter hari kerja. | Master lokasi resmi serta pengelolaan kalender/jadwal efektif yang lengkap. |
| WhatsApp | Penautan sesi, template dan kesiapan data. | Penyimpanan aturan operasional, penerima, scheduler, antrean, pengiriman, retry dan delivery log. |
| Layanan HR lanjutan | Field profil dan template notifikasi. | Modul transaksi payroll, klaim, pengembangan kompetensi, kinerja dan portal mandiri pegawai. |

## 15. Skenario pemeriksaan fitur dan data

Gunakan data nyata yang berhak diproses, dengan hasil pembanding yang ditinjau SDM/Keuangan. Daftar ini adalah kriteria pemeriksaan, **bukan laporan bahwa pengujian berikut dijalankan pada sesi dokumentasi ini**.

1. **Gabungan tiga sumber:** offline, online dan ST pada bulan yang sama; periksa bahwa periode/kantor benar serta WFA tanpa jam tidak disamakan dengan bukti lengkap.
2. **Identitas:** NIP sama lintas sumber tertaut; nama mirip dengan NIP berbeda tidak langsung digabung; peserta ST tanpa identifier meminta keputusan.
3. **Revisi upload:** isi identik tidak menggandakan hak; nama file sama tidak menimpa otomatis; penggantian satu register tidak menghapus register lain.
4. **Konflik bukti:** pasangan jam berbeda menahan hasil; masuk dari satu baris dan pulang dari baris lain tidak dirakit menjadi eligible.
5. **WFA:** hari WFA yang memenuhi syarat dihitung ketika `countWfa` aktif; keterlambatan, jam belum lengkap, atau ST aktif tetap memiliki dampak tersendiri.
6. **Batas waktu:** uji sebelum 08:00, tepat 08:00, dan satu detik setelahnya; periksa hasil sesuai operator batas yang dipilih.
7. **Nominal:** golongan tanpa tarif efektif atau parameter belum siap menghasilkan pending; tarif berubah di tengah bulan mengikuti tanggal efektif.
8. **Koreksi catatan:** keluarkan satu peserta ST, periksa preview dampak, pastikan peserta lain tetap aktif dan catatan asli tetap tersedia.
9. **Pengajuan:** kelengkapan/review belum selesai menahan pengajuan; pengaju tidak menyetujui diri sendiri; hari pegawai tidak masuk pengajuan ganda.
10. **Snapshot:** perubahan sumber tidak menulis ulang snapshot terkunci; koreksi menghasilkan versi dan selisih yang dapat dibandingkan.
11. **Akses/backup:** peran dan kantor membatasi tindakan/data; restore memakai preview dan konfirmasi; JSON tidak dianggap backup workbook lengkap.
12. **WA:** bedakan berhasil menautkan nomor dari berhasil mengirim; tombol pratinjau tidak mengirim pesan.

## 16. Rujukan implementasi untuk melanjutkan pengembangan

| Bagian | Rujukan kode |
| --- | --- |
| Halaman dan navigasi | [App.tsx](../src/App.tsx), [pages](../src/pages/) |
| Workspace, periode dan hitung ulang | [HrData.tsx](../src/state/HrData.tsx) |
| Bentuk bukti, sumber, profil dan keputusan | [types.ts](../src/engine/types.ts), [workspace.ts](../shared/workspace.ts) |
| Pengenalan sumber dan variasi parser | [parse.ts](../src/engine/parse.ts), [parsers](../src/engine/parsers/) |
| Diff dan perlakuan revisi impor | [ImportPage.tsx](../src/pages/ImportPage.tsx), [imports.ts](../shared/imports.ts), [server/imports.ts](../server/imports.ts) |
| Roster dan pencocokan identitas | [roster.ts](../src/engine/roster.ts), [IdentityPage.tsx](../src/pages/IdentityPage.tsx) |
| Rekonsiliasi dan aturan UM | [reconcile.ts](../src/engine/reconcile.ts), [policy.ts](../src/engine/policy.ts) |
| Review satu catatan dan bukti harian | [RecordReview.tsx](../src/components/RecordReview.tsx), [DayDetail.tsx](../src/components/DayDetail.tsx) |
| Master dan profil bertanggal | [masterImport.ts](../src/lib/masterImport.ts), [EmploymentPeriods.tsx](../src/components/EmploymentPeriods.tsx) |
| Nominatif, pengajuan dan koreksi | [MealPage.tsx](../src/pages/MealPage.tsx), [SubmissionPanel.tsx](../src/components/SubmissionPanel.tsx), [server/submissions.ts](../server/submissions.ts) |
| Akses, backup, nihil ST dan audit | [WorkspaceSettings.tsx](../src/pages/WorkspaceSettings.tsx), [server/app.ts](../server/app.ts), [scope.ts](../server/scope.ts) |
| Penautan WhatsApp dan pratinjau | [AutomationCenter.tsx](../src/pages/AutomationCenter.tsx), [whatsapp.ts](../server/whatsapp.ts) |
| Pembanding historis | [Progres FE demo](PROGRES-FITUR-FRONTEND.md) |

Saat menggunakan dokumen ini sebagai konteks AI, bedakan selalu sumber asli, bukti aktif, master, field turunan, keputusan, kalkulasi berjalan dan snapshot. Rencana pada Peta Fitur atau template komunikasi tidak menaikkan status kemampuan yang belum mempunyai alur data/tindakan terkait.
