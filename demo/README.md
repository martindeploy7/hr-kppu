# Demo KPPU HR untuk Netlify

## Menjalankan lokal

```sh
npm run dev:demo
```

Buka alamat Vite yang ditampilkan. Demo mengarahkan dirinya ke mode `?demo=1` dan menggunakan shell, navigasi, komponen, serta halaman yang sama dengan aplikasi utama.

## Deploy Netlify

`netlify.toml` di root repositori sudah mengatur:

- Build command: `npm run typecheck && npm run build:demo`
- Publish directory: `dist-demo`
- SPA fallback ke `index.html`

Hubungkan repositori ini di Netlify dengan base directory kosong (root repositori). Tidak perlu mengisi environment variable backend.

## Skenario demo

Panduan interaktif menuntun pengunjung melewati pemilihan periode September 2026, sumber Mesin Offline dan Mesin Online, register ST delapan kantor, pencocokan identitas, contoh keputusan konflik jam, hitung uang makan progresif, dan halaman kepegawaian/komunikasi/administrasi.

Data tetap berisi 8 pegawai dan 22 hari kerja. Seluruh 15 jenis isu rekonsiliasi tersedia pada 14 hari contoh, termasuk satu scan pada Sabtu. Ada pula contoh telat, pulang awal, tepat pukul 08:00, WFA, sakit, izin, diklat, dinas lokal, TK eksplisit, dan hari tanpa bukti. Lihat daftar pegawai, tanggal, dan hasil yang diharapkan di [SKENARIO-DATA.md](SKENARIO-DATA.md).

Tombol pengesahan hari konsisten mensimulasikan keputusan admin, termasuk hari hadir yang telat. Status hari valid tidak selalu berarti berhak UM. Tombol penyelesaian flag hanya memilih Mesin Offline untuk Aditya pada 2 September; contoh isu lain tetap terbuka agar dapat diperiksa melalui matriks atau Detail isu.

Semua data dibuat sintetis. Mode Netlify mengganti permintaan `/api` dengan penyimpanan lokal browser (`localStorage`); tidak ada permintaan ke Render atau Supabase. Tombol **Reset demo** mengembalikan skenario awal. Kebijakan sampel mengaktifkan tarif bruto dan WFA untuk demonstrasi; PPh/netto tetap belum disahkan.

Impor manual di halaman impor hanya menerima contoh yang dikenali untuk simulasi. Gunakan tombol contoh pada panduan untuk alur demo yang konsisten.

Versi data dan progres tur menggunakan kunci browser v2 agar pengunjung yang pernah memakai versi sebelumnya mendapatkan skenario baru setelah deploy. Reset demo mengulang skenario v2 dari awal.
