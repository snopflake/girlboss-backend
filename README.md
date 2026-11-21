# GirlBoss Backend

Backend foundation GirlBoss menggunakan Node.js, Express, dan TypeScript dengan layered monolithic architecture.

## Menjalankan aplikasi

1. Salin `.env.example` menjadi `.env`.
2. Isi konfigurasi lokal yang diperlukan (lihat bagian Environment).
3. Jalankan `npm run dev`.

Skrip yang tersedia:

- `npm run dev` menjalankan server dengan `tsx watch`.
- `npm run build` membuat JavaScript Node.js di `dist/`.
- `npm start` menjalankan hasil build.
- `npm run lint` menjalankan ESLint.
- `npm run typecheck` memeriksa tipe TypeScript, termasuk test.
- `npm run check:supabase` memeriksa konektivitas Supabase dan membaca roles secara read-only. Memerlukan seluruh variabel Supabase pada `.env`; skrip ini bukan endpoint API.
- `npm test` menjalankan integration test health endpoint dengan test runner bawaan Node.js.

## Authentication

- `POST /api/auth/register` menerima pendaftaran APPLICANT atau COMPANY. Supabase Auth mengirim email verifikasi sesuai konfigurasi project; respons selalu generik untuk menghindari account enumeration.
- `POST /api/auth/login` mengembalikan access/refresh token setelah token session didapat dan profil aplikasi dinyatakan `ACTIVE`.
- `GET /api/auth/me` memverifikasi Bearer token dengan Supabase Auth dan mengembalikan data pengguna serta profil miliknya.
- `/api/applicant/test`, `/api/company/test`, dan `/api/admin/test` hanya dipasang pada `NODE_ENV=development`.

Auth request membuat Supabase client tersendiri, jadi session tidak berbagi state antar-request. `public.users` dan relasi `roles` menjadi sumber role aplikasi; metadata user tidak dipakai untuk otorisasi. Frontend sebaiknya memilih satu pengelola session yang konsisten dengan Supabase Auth SDK dan tidak mencatat token.

Rate limiting in-memory diterapkan pada endpoint register dan login. Untuk deployment multi-instance, gunakan store rate-limit bersama.

Migration trigger dan RLS di `supabase/migrations/` **tidak dijalankan otomatis**. Periksa trigger `auth.users` dan policies pada tabel target terlebih dahulu; migration memiliki preflight yang berhenti jika menemukan trigger/policy lain. Jalankan SQL secara manual di Supabase SQL Editor dengan urutan timestamp. Setelah migration diterapkan, `supabase/tests/auth_rls.sql` menguji akses positif dan isolasi negatif; ganti placeholder UUID dengan akun tes APPLICANT dan COMPANY yang sudah ada.

## Struktur dan layer

- `src/routes/` memetakan URL ke controller.
- `src/controllers/` menangani request dan response HTTP.
- `src/services/` menangani logika aplikasi; health service menyediakan status service.
- `src/repositories/` disiapkan untuk akses data pada tahap berikutnya.
- `src/middlewares/` menangani route yang tidak ditemukan dan error global.
- `src/config/` memvalidasi environment dengan Zod dan menyediakan Supabase JS.
- `src/app.ts` menginisialisasi Express tanpa membuka port agar mudah diuji.
- `src/server.ts` memuat environment dan menjalankan HTTP server.

Folder `validators/`, `types/`, `utils/`, serta `supabase/migrations/` disiapkan untuk pengembangan berikutnya. Belum ada repository/database operation, migration, seed, atau autentikasi pada foundation ini.

## Endpoint

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/health` | Status aplikasi (tidak menguji koneksi database) |

## Environment

Salin `.env.example` ke `.env`, lalu isi:

- `NODE_ENV`, `PORT`, dan `CORS_ORIGIN` untuk server lokal dan konfigurasi CORS.
- `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, dan `SUPABASE_PUBLISHABLE_KEY` untuk koneksi project Supabase. Variabel Supabase opsional untuk health check.
- `SUPABASE_SECRET_KEY` hanya server-side. `npm run check:supabase` memerlukannya untuk query read-only roles menggunakan Admin Client.

Publishable key harus berprefix `sb_publishable_` dan secret key harus berprefix `sb_secret_`. Jika Supabase belum dikonfigurasi lalu kode meminta client database, konfigurasi akan menghasilkan error yang jelas. Tidak ada koneksi atau data palsu. Admin Client hanya digunakan oleh trusted backend code dan tidak diekspos melalui API.

Jangan commit `.env` atau credential. Backend ini belum melakukan otorisasi request; Supabase secret key tidak digunakan untuk operasi data.
