# DESIGN.md — Sistem desain KPPU HR

Aplikasi kerja internal yang padat data (mode "Operate"): keterbacaan, konsistensi, dan kecepatan kerja lebih penting daripada ekspresi visual. Dokumen ini menjadi acuan untuk perbaikan UI/UX bertahap. **Perbaikan bukan perombakan**: struktur halaman, alur, dan warna merek tetap.

Sumber aturan (dipilih, tidak semua dipakai): `ux-heuristics` (Nielsen + Krug, wajib), `antislop` + `antislop-ui` + `antislop-human` + `antislop-layoutmobile`, `emil-design-eng` + `animate` + `choreograph` + `remove-animations`, `impeccable` (audit/polish/harden/clarify). Tidak dipakai: `taste-skill` (khusus situs marketing), preset GSAP `ui-ux-pro-max`.

## 1. Token

Semua warna, radius, bayangan, ukuran huruf, dan durasi diambil dari token di `src/theme.css`. Warna hex baru di luar `theme.css` tidak boleh ditambahkan.

### Warna
Token warna yang ada (`--brand-navy`, `--brand-red`, `--ink`, `--ink-soft`, `--line`, `--surface`, `--surface-warm`, semantik `--ok/--warn/--danger/--info/--duty/--leave/--idle` + `-bg`/`-line`, sumber `--src-*`, `--money*`) tetap. Tambahan:

| Token | Nilai | Pakai untuk |
|---|---|---|
| `--ink-muted` | `#5a6672` | teks keterangan kecil (≥4.5:1 di atas putih dan `--surface-warm`) |
| `--line-strong` | `#d6d1c8` | batas input, pemisah tabel kepala |
| `--surface-sunken` | `#f1eee9` | latar sel/area tenggelam (sama dengan `--idle-bg`) |
| `--focus` | `#156c78` | cincin fokus (≥3:1 terhadap latar) |
| `--navy-ink` | `#13283d` | teks judul gelap di atas putih |

Kontras sudah dicek (`antislop-human/contrast-check.py`): `--ink-muted` 5.9:1 di putih, 5.1:1 di `--surface-sunken`; `--focus` 6.1:1. **`--idle` di atas `--idle-bg` hanya 3.95:1 (gagal untuk teks kecil)** → teks `.tone-idle` memakai `--ink-muted`.

`--line` hanya didefinisikan sekali (di `theme.css`, `#e7e3dc`).

### Tipografi (skala tetap, 7 langkah)
`--fs-2xs: 10.5px` (label tabel huruf kapital) · `--fs-xs: 11.5px` (chip, catatan) · `--fs-sm: 12.5px` (isi tabel, tombol) · `--fs-md: 13.5px` (teks badan) · `--fs-lg: 15px` (judul panel h3) · `--fs-xl: 22px` (judul halaman h2) · `--fs-2xl: 26px` (angka KPI).
Ukuran di bawah 10.5px tidak dipakai untuk teks yang harus dibaca. Huruf: DM Sans (badan), Manrope (judul, angka).

### Radius dan bayangan
`--radius-sm: 6px` (chip kecil, sel) · `--radius-md: 9px` (tombol, input) · `--radius-card: 12px` (panel, kartu, drawer) · `--radius-pill: 999px` (hanya chip status dan segmented control).
Bayangan: `--shadow-card` untuk kartu, `--shadow-pop: 0 8px 28px rgba(7,44,82,.14)` untuk drawer/dialog/menu. Tidak ada bayangan lain.

### Motion
```
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);      /* masuk/keluar */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);  /* gerak di layar */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);   /* drawer */
--dur-press: 140ms; --dur-fast: 160ms; --dur-base: 220ms; --dur-drawer: 380ms;
```

## 2. Komponen

**Tombol** — satu hierarki:
- `.btn.primary` = navy solid (aksi utama, maksimal satu per area). Hover lebih gelap.
- `.btn.secondary` = putih + garis. `.btn.ghost`/`.link` = tanpa bingkai.
- `.btn.danger` = merah, **hanya** untuk tindakan merusak/membatalkan. Merah merek tidak dipakai untuk aksi biasa.
- Semua tombol: `:active { transform: scale(.97) }` 140ms `--ease-out`; hover di dalam `@media (hover:hover) and (pointer:fine)`; `:disabled` → `cursor: not-allowed`, opacity .5 (bukan `cursor: wait`); transisi menyebut properti (`background-color, border-color, color, transform`), **tidak pernah `transition: all`**.
- Tinggi minimum 36px desktop, 44px area sentuh di ≤760px.

**Fokus** — satu aturan global `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` untuk button, a, input, select, textarea, [tabindex]. Tidak ada `outline: none` tanpa pengganti.

**Drawer** — Escape menutup; fokus pindah ke drawer saat terbuka dan kembali ke pemicu saat tertutup; `aria-modal="true"`; panel masuk dari kanan `--dur-drawer` `--ease-drawer`, keluar lebih cepat (240ms); scrim opacity saja.

**Status** — warna selalu disertai teks/ikon. Chip status memakai `.tone-chip` + `.tone-*`.

**State data** — setiap tampilan data punya state memuat (skeleton yang menyerupai isi), kosong (sebab + tindakan berikut), dan galat (apa yang gagal, sebab, cara memulihkan). Tidak ada "Tidak ada data" tanpa keterangan.

## 3. Motion — aturan

1. Aksi keyboard dan aksi >100×/hari (navigasi antar halaman, filter, tab, klik sel matriks) **tidak dianimasikan** atau hanya opacity ≤150ms.
2. Setiap animasi punya satu tujuan: umpan balik, kesinambungan ruang, penanda state, atau mencegah perubahan mendadak. Angka dan tabel tidak dianimasikan untuk gaya.
3. Hanya `transform` dan `opacity` (pengecualian: `width` batang progres ketika nilainya benar-benar berubah).
4. Masuk mulai dari `opacity:0` + `scale(.97)`/geser 4–8px; tidak pernah `scale(0)`; tidak pernah `ease-in`.
5. Keluar lebih singkat dari masuk dan searah asal masuk.
6. Stagger hanya untuk kelompok yang muncul sekali (mis. batang grafik saat halaman dibuka), 30–50ms per item, total <300ms.
7. `prefers-reduced-motion: reduce` → gerak/skala hilang, opacity tetap (bukan mematikan semua ke 0.01ms). Framer-motion dibungkus `<MotionConfig reducedMotion="user">`.
8. Loop tak berujung hanya untuk indikator proses yang sedang berjalan (spinner), bukan dekorasi.

## 4. Teks (Krug: buang separuh kata)

- Bahasa Indonesia konsisten. Hindari campuran: "Bulk import" → "Impor massal", "Input manual" → "Isi manual", "Download template" → "Unduh templat". Istilah domain (ST, UM, NIP, NI PPPK, WFA) tetap.
- Judul halaman = label menu (huruf kapital sama).
- Paragraf bantuan maksimal 2 kalimat di atas lipatan; detail dipindah ke `<details>` "Cara kerja" atau tooltip.
- Tombol = kata kerja + objek ("Simpan rekap ST", bukan "OK").
- Tanpa tanda pisah panjang (em dash) di teks UI.

## 5. Tata letak & mobile

- Tidak ada scroll horizontal halaman pada 375px. Tabel lebar di dalam wadah scroll sendiri (`.table-wrap`).
- Elemen form/select memakai `max-width: 100%` dan `min-width: 0` di dalam grid/flex.
- Daftar panjang yang berulang di dalam baris (mis. daftar file sumber) diringkas: tampilkan 3 + "+N lainnya" yang bisa dibuka.

## 6. Audit heuristik (16 Nov 2026)

Skala keparahan Nielsen: 4 katastrofik · 3 mayor · 2 minor · 1 kosmetik.

| # | Temuan | Heuristik | Sev |
|---|---|---|---|
| A1 | Saat pindah halaman, isi halaman lama tetap tampil redup ±2 dtk tanpa indikator (lazy load + `AnimatePresence mode="wait"`); pernah tampil isi Setoran di bawah judul Rekap ST | 1 Status sistem | 3 |
| A2 | Scroll horizontal di 375px: Pencocokan (533px), Rekonsiliasi & Uang Makan (490px) karena label pilihan pekan yang panjang dan segmented control | Konsistensi/standar, mobile | 3 |
| A3 | Escape tidak menutup drawer; fokus tidak dipindah ke drawer | 3 Kontrol pengguna, aksesibilitas | 3 |
| A4 | Merah merek dipakai untuk aksi biasa ("Lihat Uang Makan", "Simpan pegawai", "Ganti password") sehingga tidak bisa dibedakan dari aksi berbahaya; gaya tombol berbeda-beda (merah solid, garis merah, kuning, pill) | 4 Konsistensi | 2 |
| A5 | Tidak ada state tekan (`:active`); `transition: .2s` untuk semua properti; disabled memakai `cursor: wait` | 1 Status sistem | 2 |
| A6 | Kolom "Sumber" di Data Pegawai dan kartu konflik di Pencocokan berisi 10–20 nama file, baris jadi sangat tinggi | 8 Minimalis | 2 |
| A7 | Paragraf bantuan panjang di Setoran, Pencocokan, Uang Makan, Peta Fitur, Automation | 8 Minimalis (Krug) | 2 |
| A8 | Campuran bahasa: "Bulk import", "Input manual", "Download template", tag "Celebration/Personal"; judul "Setoran & review" vs menu "Setoran & Review" | 4 Konsistensi, 2 Bahasa pengguna | 2 |
| A9 | Label pekan sangat panjang ("Pekan 1 · 30 Mar 2026–5 Apr 2026 · bagian 1 Apr–5 Apr") di setiap halaman | 8 Minimalis | 2 |
| A10 | 24 ukuran huruf berbeda (9–26px), 16 radius, ±44 bayangan, 517 warna hardcoded | 4 Konsistensi | 2 |
| A11 | Animasi framer-motion tidak mengikuti reduced-motion; CSS reduced-motion mematikan semua ke 0.01ms | Aksesibilitas | 2 |
| A12 | Kotak QR WhatsApp menampilkan instruksi pengembang (nama env var, perintah openssl) kepada pengguna | 2 Bahasa pengguna | 1 |
| A13 | Peta Fitur: tabel 3 kolom berisi prosa panjang, sempit di mobile | 8 Minimalis | 1 |

Bukan masalah UI (data uji E2E): "UJI-999/", "Superadmin E2E April", "Unit uji lokal".

## 7. Pembagian kerja perbaikan

| Paket | File | Temuan |
|---|---|---|
| Fondasi | `src/theme.css`, `src/styles.css`, `src/app.css`, `src/components/ui.tsx`, `src/components/Skeleton.tsx`, `src/components/skeleton.css`, `src/components/WeekPicker.tsx`, `src/App.tsx`, `src/main.tsx` | A1, A3, A4 (sistem tombol), A5, A9, A10 (global), A11 |
| Alur absensi & UM | `src/pages/AttendanceOverview.tsx`, `ImportPage.tsx`, `setoran.css`, `ReconcilePage.tsx`, `reconcile.css`, `IdentityPage.tsx`, `MealPage.tsx`, `meal.css`, `src/components/{DayDetail,DayReviewEditor,RecordReview,SourceRecords,SubmissionPanel,EmploymentPeriods}.tsx` | A2, A4 (pemakaian), A6 (Pencocokan), A7, A10 (lokal) |
| Kepegawaian & lainnya | `EmployeesPage.tsx`, `AddDataPage.tsx`, `RekapSTPage.tsx`, `rekapst/*`, `WorkspaceSettings.tsx`, `AutomationCenter.tsx`, `automation/*`, `automation.css`, `FeatureMap.tsx`, `PeopleDashboard.tsx`, `people/*`, `people.css` | A4 (pemakaian), A6 (Data Pegawai), A7, A8, A10 (lokal), A12, A13 |
