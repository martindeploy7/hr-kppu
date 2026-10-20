# KPPU HR

Aplikasi HR KPPU dengan React/TypeScript/Vite, API Hono, Drizzle dan PostgreSQL. Alur frontend existing dipertahankan: impor sumber, pencocokan identitas, rekonsiliasi, ringkasan kehadiran, uang makan, master dan People Dashboard. Automation Center dapat menautkan WhatsApp melalui QR nyata; pengiriman pesan dan scheduler masih simulasi.

Backend menyimpan ruang kerja bersama, sumber Excel asli, revisi, akun, sesi dan riwayat perubahan. Login memakai Argon2 dan cookie HttpOnly. Server memeriksa role serta expected revision; perubahan dua admin tidak saling menimpa secara diam-diam.

## Jalankan

Gunakan Node 24. Siapkan `.env` dari `.env.example`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`, password admin unik minimal 14 karakter dan `APP_ORIGIN` yang sama persis dengan origin browser. Jangan commit environment atau workbook pegawai.

```
npm ci
npm run db:local
# Terminal lain:
npm run dev
```

Local PostgreSQL memakai port 5544, API 8788, frontend 5173. `npm run build` memeriksa FE/BE lalu menghasilkan `dist` dan `dist-server`. `npm start` menjalankan bundle server sekaligus FE; jalankan dengan environment terisi. Migrasi dijalankan saat startup. Akun awal hanya dibuat bila tabel akun kosong.

## Perilaku data

- Upload membaca format dari isi workbook; hash identik dilewati meski nama berbeda. Preview tidak memengaruhi kalkulasi. Penggantian seluruh dataset dipilih eksplisit, sementara tambahan tidak menghapus file lama.
- Parser membaca matriks online Oktober, master + ST DPH, format mesin/rekap lama, dan register Kanwil. Identifier numerik panjang dipertahankan dari XML jika tersedia, disertai risiko presisi yang perlu diperiksa. Identifier rusak tidak direkonstruksi dengan tebakan.
- NIP teks dan mapping eksplisit menjadi dasar identitas. Fuzzy/nama hanya kandidat. Unknown dan peserta ST belum terpetakan dapat menahan UM.
- Terlambat, semua dinas, tugas belajar dan diperbantukan pada rentang efektif tidak mendapat UM. Scan masuk/pulang harus satu pasangan dari bukti yang sama. Status hadir tanpa jam tidak eligible; tanggal masa depan/missing tidak otomatis TK.
- Hari eligible terpisah dari nominal. Golongan/tarif/parameter belum disahkan menghasilkan nominal pending, tanpa fallback III siap bayar. Tarif harian mendukung rentang efektif.
- Bukti material berubah membuat review terkait stale. Aktor review baru ditetapkan server dari sesi. Backup/migrasi lokal tidak menghapus IndexedDB lama.
- Backup JSON berisi state, bukan workbook bytes. Restore hanya admin, setelah preview dan konfirmasi; state server sebelumnya disimpan sebagai restore point.

## Verifikasi

```
npm test
npm run build
npx e2e run tests/workspace.e2e.ts
```

Tes integrasi memakai database lokal `kppu_test`, terpisah dari data aplikasi; suite menolak host eksternal. E2E membutuhkan app lokal hidup dan akun admin `.env`. Audit data riil lokal: `npx tsx scripts/parser-audit.ts`; hasil berada di `artifacts/` dan tidak dikirim ke GitHub.

Lihat [DEPLOYMENT.md](DEPLOYMENT.md) untuk Render Free + Supabase. [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) mencatat bukti dan pekerjaan tersisa. Build dan tes lokal tidak merupakan bukti deployment live atau validitas pembayaran aktual. Jadwal, kalender, tarif/pajak, kamus kode dan approval operasional memerlukan pengesahan SDM/Keuangan.
