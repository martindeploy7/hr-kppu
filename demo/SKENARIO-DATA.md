# Skenario data demo KPPU HR

Periode September 2026, 8 pegawai sintetis di Pusat dan Kanwil I sampai VII, 22 hari kerja. Paket memuat 8 file Mesin Offline, 1 file Mesin Online gabungan, dan 8 register ST.

Seluruh 15 jenis isu yang dikenali mesin rekonsiliasi muncul pada 14 hari contoh. Satu hari dapat memiliki beberapa isu terkait; satu contoh berada pada Sabtu, di luar 176 target hari-orang. Sebagian besar hari memiliki bukti yang konsisten.

## Urutan presentasi

1. Jalankan panduan hingga ketiga sumber dan seluruh register ST lengkap.
2. Klik **Tetapkan hari dengan bukti konsisten**. Ini mensimulasikan pilihan admin; sumber tetap berkedudukan setara. Hari yang telat dapat valid sebagai hadir dan tetap gugur UM.
3. Klik **Pilih Offline untuk Aditya · 2 Sep** untuk menyelesaikan satu contoh konflik. Kasus lainnya tetap tersedia.
4. Pada Rekonsiliasi, gunakan **Detail isu** untuk memilih jenis masalah, atau klik nama pegawai/tanggal pada matriks. Gunakan filter **Semua** bila ingin melihat pegawai yang sudah selesai.
5. Buka **Uang Makan**. Hasil hari yang telah sah tampil sementara kasus lain masih menunggu pemeriksaan.

## Daftar contoh

| Pegawai | Kantor | Tanggal September | Contoh | Hasil/pemeriksaan |
| --- | --- | --- | --- | --- |
| Aditya Pratama | Pusat | 2 | Jam masuk berbeda antar sumber | Offline 07:50 dan online 08:10; admin memilih bukti yang berlaku. |
| Nadia Siregar | Kanwil I | 3 | Terlambat check-in | Kedua sumber 08:20; hari dapat disahkan, UM gugur karena terlambat 20 menit. |
| Bagas Saputra | Kanwil II | 4 | Ada check-in, tidak ada check-out | Kedua sumber hanya mencatat masuk 07:50; UM ditahan sampai bukti lengkap. |
| Citra Lestari | Kanwil III | 7 | Ada check-out, tidak ada check-in | Kedua sumber hanya mencatat pulang; admin tidak bisa mengesahkan hadir dengan bukti ini. |
| Dimas Wibowo | Kanwil IV | 8 | Cuti bertentangan dengan hadir | Offline mencatat cuti, online memiliki scan lengkap; pilih bukti dan status yang sah. |
| Eka Maharani | Kanwil V | 9 | Tiga sumber pada hari yang sama | Offline dan online mencatat WFO, ST mencatat dinas luar; ketiganya menunggu keputusan admin. |
| Farhan Ramadhan | Kanwil VI | 10 | Dua ST tumpang tindih, satu tanpa nomor | Dua tujuan dinas berbeda pada tanggal yang sama; admin perlu memeriksa register ST. |
| Gita Anggraini | Kanwil VII | 11 | Kode dinas tanpa ST pada tanggal itu | Offline berkode PD, register ST tidak mencakup tanggal ini; perlu verifikasi dokumen. |
| Aditya Pratama | Pusat | 14 | Presensi online ditolak | Hanya ada online berstatus Reject; tidak cukup untuk mengesahkan hadir. |
| Nadia Siregar | Kanwil I | 15 | Koordinat WFO jauh dari kantor | Koordinat online menyimpang dari median kantor; indikasi lokasi perlu diperiksa. |
| Bagas Saputra | Kanwil II | 16 | Jam identik dengan hari sebelumnya | Catatan offline ditandai memiliki jam yang sama; online tetap terlihat sebagai alternatif. |
| Citra Lestari | Kanwil III | 17 | Jam manual karena absen error | Hanya bukti offline dengan catatan Absen Eror; admin perlu bukti pendukung. |
| Dimas Wibowo | Kanwil IV | 18 | Jadwal Ramadan di luar periode | Offline memakai jadwal puasa; online memakai jadwal normal untuk hari tersebut. |
| Eka Maharani | Kanwil V | 19 | Hadir pada Sabtu | Ada scan pada akhir pekan; hari ini tidak masuk target hari kerja atau UM. |
| Farhan Ramadhan | Kanwil VI | 21 | WFA bersamaan dengan ST dinas luar | Online mencatat WFA dan ST mencatat dinas luar; admin menentukan aktivitas yang berlaku. |
| Aditya Pratama | Pusat | 23 | Tidak ditemukan di ketiga sumber | Matriks menampilkan tidak ditemukan; UM ditahan dan tidak otomatis dianggap TK. |
| Nadia Siregar | Kanwil I | 24 | Check-in tepat pukul 08:00 | Demo memakai batas sebelum 08:00; hari dapat valid tetapi UM gugur pada aturan contoh. |
| Bagas Saputra | Kanwil II | 25 | Pulang satu jam lebih awal | Kedua sumber pulang 15:30 pada Jumat; UM gugur sesuai aturan demo. |
| Eka Maharani | Kanwil V | 3 | WFA lengkap dan tepat waktu | Online mencatat WFA 07:55 sampai jadwal pulang; UM masuk setelah admin mengesahkan. |
| Citra Lestari | Kanwil III | 28 | Sakit dengan kode yang konsisten | Kedua sumber berkode S; dapat disahkan sakit dan tidak mendapat UM. |
| Dimas Wibowo | Kanwil IV | 29 | Izin dengan kode yang konsisten | Kedua sumber berkode I; dapat disahkan izin dan tidak mendapat UM. |
| Gita Anggraini | Kanwil VII | 30 | Absen eksplisit tanpa keterangan | Kedua sumber berkode X; admin dapat menetapkan TK berdasarkan bukti tersebut. |
| Farhan Ramadhan | Kanwil VI | 28 | Diklat dengan kode yang konsisten | Kedua sumber berkode DIKLAT; hari sah sebagai diklat dan tidak mendapat UM. |
| Gita Anggraini | Kanwil VII | 29 | ST dinas lokal | ST dalam kota menjadi bukti dinas lokal; tidak mendapat UM pada aturan aktif. |

## Cakupan jenis isu

| Jenis isu | Contoh |
| --- | --- |
| Pasangan scan berbeda antar sumber | Aditya Pratama, 2 Sep |
| Dinas luar tapi scan di kantor | Eka Maharani, 9 Sep |
| Cuti/sakit tapi ada absen hadir | Dimas Wibowo, 8 Sep |
| Surat tugas tumpang tindih | Farhan Ramadhan, 10 Sep |
| Dinas di mesin, ST tidak ditemukan | Gita Anggraini, 11 Sep |
| Presensi daring ditolak | Aditya Pratama, 14 Sep |
| Scan tidak lengkap | Bagas Saputra, 4 Sep; Citra Lestari, 7 Sep |
| WFO dengan koordinat di luar kantor | Nadia Siregar, 15 Sep |
| Jam identik dengan hari sebelumnya | Bagas Saputra, 16 Sep |
| Jam diisi manual (absen error) | Citra Lestari, 17 Sep |
| Jadwal kerja mesin tidak sesuai | Dimas Wibowo, 18 Sep |
| Absen di hari libur | Eka Maharani, 19 Sep |
| Presensi WFA saat dinas | Farhan Ramadhan, 21 Sep |
| Penugasan tanpa nomor ST | Farhan Ramadhan, 10 Sep |
| Status harian berbeda antar sumber | Dimas Wibowo, 8 Sep; Eka Maharani, 9 Sep; Farhan Ramadhan, 21 Sep |

## Batas data contoh

Kasus scan tidak lengkap sengaja belum memiliki pasangan masuk/pulang yang utuh. Admin harus melengkapi bukti sebelum mengesahkan hadir; demo tidak otomatis mengarang jam yang hilang. Hari tanpa bukti tetap tampil sebagai tidak ditemukan dan tidak otomatis berubah menjadi TK.

Koordinat yang menyimpang adalah indikasi berdasarkan median lokasi contoh, bukan geofence resmi. Catatan jam duplikat dan jam manual mewakili penanda dari parser pada data yang telah diparsing. Versi Netlify memakai data terstruktur sintetis; simulasi upload tidak membaca isi workbook sungguhan.

Aturan contoh memakai batas check-in sebelum pukul 08:00, WFA dihitung, dan pulang awal menggugurkan UM. PPh/netto belum disahkan. Contoh ini menjelaskan perilaku aturan demo, bukan penetapan peraturan baru.

PDF manual yang ada tetap menjelaskan alur fitur. Angka dan nama pada screenshot PDF berasal dari set dummy sebelumnya; tabel ini adalah acuan kasus untuk versi demo v2.

## Pemeriksaan otomatis

`npm test -- tests/demo-scenarios.test.ts tests/monthly-flow.test.ts` memeriksa cakupan 15 jenis isu, kelengkapan paket delapan kantor, perbedaan validasi hari dengan kelayakan UM, penahanan scan tidak lengkap, dan keputusan satu konflik yang tidak menyelesaikan kasus lainnya.
