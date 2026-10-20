# Render Free + Supabase

Satu layanan Node menyajikan FE Vite dan API Hono dari origin yang sama. PostgreSQL harus eksternal karena filesystem Render tidak persisten. Konfigurasi menggunakan paket gratis, tanpa disk, worker berbayar atau Render Postgres sementara.

## Database Supabase

1. Buat project khusus HR KPPU dalam organisasi Free, region Singapore bila tersedia. Jangan gunakan database Cozzy.
2. Salin PostgreSQL connection string **shared Session pooler** dari Connect (port 5432, IPv4), dengan password database, ke `DATABASE_URL` di Render. Render menjalankan backend persisten; Session pooler cocok untuk koneksi jangka panjang dari jaringan IPv4. Jangan gunakan Transaction pooler untuk Postgres.js: walau `prepare: false` sudah disetel, pipelining bawaan Postgres.js dapat menggantung query atau mengembalikan hasil yang tidak cocok. Driver membatasi pool lokal ke tiga koneksi dan memakai TLS. URL/password tidak pernah memakai prefix `VITE_`. Lihat [panduan mode koneksi Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres) dan [catatan Postgres.js](https://supabase.com/docs/guides/database/postgres-js).
3. Backend menjalankan migrasi Drizzle saat startup. Objek berada di schema privat `hr_internal`, bukan `public`. Jangan tambahkan schema ini ke exposed schemas Data API; akses aplikasi lewat API Hono.
4. Akun aplikasi berbeda dari akun Supabase. Set `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`, dan `INITIAL_ADMIN_PASSWORD` unik minimal 14 karakter. Bootstrap hanya berjalan jika belum ada akun. Hapus password bootstrap dari environment setelah akun berhasil dibuat.

## Render

Import repository privat sebagai Blueprint menggunakan `render.yaml`. Isi `DATABASE_URL`, `APP_ORIGIN=https://<service>.onrender.com` tanpa trailing slash, dan konfigurasi admin. Paket harus tetap **Free**. Build `npm ci --include=dev && npm run build && npm prune --omit=dev`; start `npm start`. Port mengikuti environment Render.

`APP_ORIGIN` harus tepat sama dengan origin web: mutasi dengan origin lain ditolak. Cookie production memakai Secure/HttpOnly/SameSite dan prefix `__Host-`. FE dan API tidak membutuhkan CORS lintas domain.

## Login WhatsApp

WhatsApp dapat ditautkan dari Automation Center menggunakan QR WhatsApp Web. Tambahkan environment variable `WHATSAPP_SESSION_ENCRYPTION_KEY` di Render dan buat nilainya secara privat dengan `openssl rand -base64 32`. Jangan kirim atau commit nilainya. Kunci ini mengenkripsi kredensial perangkat sebelum disimpan dalam schema privat `hr_internal`; pertahankan nilainya untuk memulihkan sesi setelah restart. Jika kunci hilang atau diganti, hapus sesi lama dari halaman koneksi lalu tautkan ulang. Migrasi tabel sesi berjalan otomatis saat server mulai.

Setelah deploy, masuk sebagai administrator, buka Automation Center, pilih **Mulai tautkan WhatsApp**, lalu pindai QR melalui WhatsApp → Perangkat tertaut → Tautkan perangkat. Status akan berubah setelah koneksi berhasil. Render Free dapat menghentikan service saat idle; sesi yang tersimpan akan dipulihkan saat service aktif lagi, tetapi koneksi tidak dapat dijamin selalu hidup. QR login memakai Baileys, klien komunitas WhatsApp Web; gunakan nomor kerja khusus yang tidak kritis. Pengiriman pesan dan scheduler di Automation Center tetap belum diaktifkan.

Periksa `/api/health` menunjukkan `ok: true` dan revision commit setelah deploy. Verifikasi login, impor fixture sintetis, reload, role yang ditolak dan dua sesi admin. Jangan menyatakan production siap hanya berdasarkan build lokal.

## Lokal

```
npm ci
cp .env.example .env
# Isi password admin unik di .env (jangan commit)
npm run db:local
# Terminal lain:
npm run dev
```

`APP_ORIGIN` lokal harus sama dengan URL browser. Tes integrasi hanya memakai `127.0.0.1:5544/kppu_test`; suite menolak nama/host lain. `npm test` memerlukan PostgreSQL lokal hidup. `npm run build` memeriksa FE dan BE.

## Batas free tier dan operasional

Render Free tidur setelah 15 menit tanpa trafik, memakai filesystem sementara dan memberi 750 jam instance per workspace per bulan. Render menyatakan free instance ditujukan untuk pengujian/proyek hobi, bukan aplikasi produksi; cold start dapat memakan sekitar satu menit. Supabase Free dapat pause ketika aktivitas database rendah selama periode tujuh hari. Karena itu kombinasi ini hanya target biaya nol untuk demo/pilot dengan ketersediaan terbatas, bukan jaminan hosting operasional uang makan yang selalu aktif. Untuk penggunaan produksi, pindah ke paket hosting yang memberi ketersediaan sesuai kebutuhan. Lihat [batas Render Free](https://render.com/docs/free) dan [kebijakan pause Supabase](https://supabase.com/docs/guides/platform/free-project-pausing).

Backup JSON ruang kerja mengandung data personal; simpan privat. Backup JSON tidak menyertakan byte workbook asli. Arsip file server berada di database dan perlu backup database tersendiri untuk pemulihan penuh. Jangan menaruh workbook pegawai, dump DB, password, screenshot berdata nyata atau `.env` ke GitHub/public assets.

Gerbang fitur yang belum selesai tercatat di `docs/IMPLEMENTATION.md`; konfigurasi ini belum merupakan bukti deployment live atau persetujuan nominal pembayaran.

Autentikasi alat: `render login` dan `npx supabase login`. Jangan menyalin access token atau password ke chat. Source terpisah di repository privat `martindeploy7/hr-kppu`; workbook dan hasil audit lokal tidak diikutkan.
