# Render Free + Supabase

Satu layanan Node menyajikan FE Vite dan API Hono dari origin yang sama. PostgreSQL harus eksternal karena filesystem Render tidak persisten. Konfigurasi menggunakan paket gratis, tanpa disk, worker berbayar atau Render Postgres sementara.

## Database Supabase

1. Buat project khusus HR KPPU dalam organisasi Free, region Singapore bila tersedia. Jangan gunakan database Cozzy.
2. Salin PostgreSQL connection string **transaction pooler** dari Connect, dengan password database, ke `DATABASE_URL` di Render. Driver memakai `prepare: false`, maksimum tiga koneksi dan TLS. URL/password tidak pernah memakai prefix `VITE_`.
3. Backend menjalankan migrasi Drizzle saat startup. Objek berada di schema privat `hr_internal`, bukan `public`. Jangan tambahkan schema ini ke exposed schemas Data API; akses aplikasi lewat API Hono.
4. Akun aplikasi berbeda dari akun Supabase. Set `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME`, dan `INITIAL_ADMIN_PASSWORD` unik minimal 14 karakter. Bootstrap hanya berjalan jika belum ada akun. Hapus password bootstrap dari environment setelah akun berhasil dibuat.

## Render

Import repository privat sebagai Blueprint menggunakan `render.yaml`. Isi `DATABASE_URL`, `APP_ORIGIN=https://<service>.onrender.com` tanpa trailing slash, dan konfigurasi admin. Paket harus tetap **Free**. Build `npm ci --include=dev && npm run build && npm prune --omit=dev`; start `npm start`. Port mengikuti environment Render.

`APP_ORIGIN` harus tepat sama dengan origin web: mutasi dengan origin lain ditolak. Cookie production memakai Secure/HttpOnly/SameSite dan prefix `__Host-`. FE dan API tidak membutuhkan CORS lintas domain.

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

Render Free tidur setelah 15 menit tanpa trafik dan berbagi 750 jam gratis per workspace per bulan. Supabase Free dapat pause saat aktivitas rendah. Cold start dan pause perlu dipahami pengguna; konfigurasi ini tidak menjamin layanan selalu aktif. Lihat [Render Free](https://render.com/docs/free) dan [Supabase pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

Backup JSON ruang kerja mengandung data personal; simpan privat. Backup JSON tidak menyertakan byte workbook asli. Arsip file server berada di database dan perlu backup database tersendiri untuk pemulihan penuh. Jangan menaruh workbook pegawai, dump DB, password, screenshot berdata nyata atau `.env` ke GitHub/public assets.

Gerbang fitur yang belum selesai tercatat di `docs/IMPLEMENTATION.md`; konfigurasi ini belum merupakan bukti deployment live atau persetujuan nominal pembayaran.

Autentikasi alat: `render login` dan `npx supabase login`. Jangan menyalin access token atau password ke chat. Source terpisah di repository privat `martindeploy7/hr-kppu`; workbook dan hasil audit lokal tidak diikutkan.
