# Konsep UI — Setoran mingguan → Rekonsiliasi → Uang Makan

Versi 1 · 12 November 2026

## Prinsip

1. **Satu pertanyaan per layar.** Setoran: "file apa yang belum masuk?" Rekonsiliasi: "clash mana yang harus saya putuskan?" Uang Makan: "berapa yang dibayar dan kenapa ada yang tidak?"
2. **Awareness lewat satu langkah berikutnya.** Setiap halaman menampilkan satu banner "Langkah berikutnya" dengan satu tombol. Warnanya mengikuti urgensi.
3. **Warna punya arti, selalu bersama teks/ikon.** Token ada di `src/theme.css` (`--ok`, `--warn`, `--danger`, `--info`, `--duty`, `--leave`, `--idle`, `--src-offline`, `--src-online`, `--src-st`) dan kelas `.tone-chip .tone-*`. Jangan membuat hex baru di luar token kecuali tint turunan.
4. **Bulan adalah konteks, pekan adalah pekerjaan.** Pengumpulan bulanan = kumpulan setoran mingguan. Papan bulan menunjukkan pekan mana yang masih bolong.
5. **Hari tanpa clash tidak perlu disentuh.** UI tidak meminta admin mengonfirmasi hari yang mulus. Ia hanya menonjolkan clash dan setoran yang kurang.

## Arti warna

| Token | Dipakai untuk |
|---|---|
| `ok` hijau | Sumber sudah disetor, pekan selesai, hari dapat UM, nominal final |
| `warn` amber | Perlu tindakan: clash menunggu keputusan, data ada tapi belum dinyatakan disetor, UM perkiraan |
| `danger` merah | Pekan yang sudah lewat tapi sumber belum disetor, terlambat, pulang cepat |
| `info` biru | Pekan berjalan, sudah diputuskan admin, informasi |
| `duty` ungu | Dinas / ST |
| `leave` biru-abu | Cuti, sakit, izin |
| `idle` abu | Belum dimulai, tidak ada data |
| `src-offline` biru / `src-online` teal / `src-st` oranye | Identitas sumber pada kartu, chip, dan kolom pembanding |

## Aturan UM yang ditampilkan ke pengguna (kartu "Aturan aktif")

- Scan masuk paling lambat 08:00 (pengaturan batas: ≤ 08:00 / < 08:00)
- Scan masuk dan pulang lengkap
- Tidak pulang sebelum jadwal: Sen–Kam 16:00, Jumat 16:30
- Tidak sedang dinas: ada ST, atau mesin mencatat Perjalanan Dinas / Dinas Dalam Kota
- WFA yang disetujui (Approved) dihitung hadir
- Tarif: PNS I–II / PPPK I–VIII Rp35.000 · PNS III / PPPK IX–XII Rp37.000 · PNS IV / PPPK XIII–XVII Rp41.000

## Halaman 1 — Setoran & Review (`AttendanceOverview.tsx`, `ImportPage.tsx`, `setoran.css`)

1. **Hero bulan**: judul bulan. Ubin berwarna yang bisa diklik:
   - Pekan lengkap `x/y` (bar progres)
   - Clash menunggu (amber → Rekonsiliasi)
   - UM final (hijau → Uang Makan)
   - UM perkiraan menunggu setoran (amber)
2. **Banner Langkah berikutnya** (satu saja, urutan prioritas):
   1. merah: pekan yang sudah lewat dengan sumber belum disetor, beserta tombol unggah sumber itu
   2. amber: clash menunggu keputusan pada pekan terpilih → Rekonsiliasi
   3. biru: pekan berjalan, setor setelah pekan selesai
   4. hijau: semua lengkap → Lihat Uang Makan
3. **Papan bulan** (inti awareness pengumpulan bulanan).
   - Baris = pekan (Pekan n + rentang tanggal; tandai "lintas bulan").
   - Kolom = Offline · Online · ST · Clash · UM.
   - Sel sumber berupa chip berwarna: Disetor (n file) hijau; Data ada, belum dinyatakan amber; Belum disetor merah (pekan lewat) atau abu (belum berjalan); Tidak ada data / Nihil biru.
   - Klik sel memilih pekan dan membuka unggah sumber itu.
   - Pill status pekan di kiri: Perlu setoran / Perlu keputusan / Selesai / Berjalan / Belum dimulai.
   - Pekan terpilih disorot.
4. **Tiga kartu unggah pekan terpilih**.
   - Garis aksen warna sumber, ikon, dan status chip.
   - Bisa **drag & drop** file ke kartu, atau klik "Pilih file".
   - Ringkasan setoran terakhir (nama file, baris dipakai, waktu).
   - Tautan "Tidak ada data pekan ini" untuk ketiga sumber; pada ST teksnya "Tidak ada ST pekan ini". Dasar/alasan wajib.
   - Setelah unggah: pesan hasil + CTA "Lanjut ke rekonsiliasi (N clash)".
5. Daftar file sumber, pengaturan format tanggal, dan format yang dikenali tetap ada di bawah dalam `<details>`.
6. **Sidebar**: badge merah pada "Setoran & Review" = jumlah pekan yang sudah lewat di bulan aktif dan belum lengkap.

## Halaman 2 — Rekonsiliasi (`ReconcilePage.tsx`, `DayDetail.tsx`, `DayReviewEditor.tsx`, `reconcile.css`)

1. **Ubin ringkas**: Valid otomatis (hijau) · Clash menunggu (amber/merah) · Sudah diputuskan (biru) · Tanpa data (abu). Bar progres "x dari y clash diputuskan".
2. **Antrean clash berupa kartu**.
   - Isi kartu: nama, kantor, tanggal, dan chip jenis clash.
   - **Pembanding sumber berdampingan**: kolom berwarna per sumber, berisi apa kata Offline / Online / ST pada hari itu (jam, mode WFA/WFO, status Approved, kode pengecualian, nomor & tujuan ST).
   - **Tombol keputusan menampilkan dampaknya ke UM**. Contoh: "ST valid → tanpa UM" dan "Absensi valid → UM Rp37.000 bila tepat waktu".
   - Catatan audit wajib (≥ 3 karakter), terisi otomatis dengan teks default sesuai pilihan dan masih bisa diubah.
3. Filter chip jenis clash berwarna dengan jumlah, filter kantor, dan pencarian.
4. Setelah memutuskan, kartu berpindah ke "Sudah diputuskan" dan bisa dibatalkan.
5. Saat semua clash selesai: empty state hijau + CTA "Lihat Uang Makan".
6. Matriks harian tetap tersedia; sel diberi warna sesuai status dan dilengkapi legenda.

## Halaman 3 — Uang Makan (`MealPage.tsx`, `meal.css`)

1. **Hero**: UM final (besar, hijau) · UM perkiraan menunggu setoran (amber, `estimateBruto`) · Hari UM · Pegawai penerima. Toggle Pekan / Akumulasi bulan tetap.
2. **"Kenapa tidak dapat UM"**: bar bertumpuk horizontal berisi hari-orang per hasil:
   - Dapat UM
   - Terlambat
   - Pulang cepat
   - Dinas/ST
   - Cuti/Sakit/Izin
   - Scan tidak lengkap
   - Tidak ada data
   - Menunggu keputusan
   - Menunggu setoran

   Setiap segmen bisa diklik untuk memfilter tabel.
3. **Kartu Aturan aktif**: chip aturan di atas, ditambah tautan "Ubah aturan & tarif".
4. **Tabel pegawai**:
   - Kolom: nama, kantor, golongan → tarif, **strip hari** (titik berwarna per hari kerja, tooltip alasan), hari UM, nominal.
   - Klik baris membuka rincian harian (pakai drawer yang ada).
5. Ekspor daftar nominatif tetap ada.

## Batas

Konsep ini tidak mengubah engine, server, atau aturan bisnis. Semua angka diambil dari `useHr()` dan helper engine yang sudah ada.
