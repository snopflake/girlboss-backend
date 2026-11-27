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
- `npm test` menjalankan integration test health, authentication, Jobs, Profile, CV, Job Applications, Saved Jobs, dan Events API dengan test runner bawaan Node.js.

## Authentication

- `POST /api/auth/register` menerima pendaftaran APPLICANT atau COMPANY. Supabase Auth mengirim email verifikasi sesuai konfigurasi project; respons selalu generik untuk menghindari account enumeration.
- `POST /api/auth/login` mengembalikan access/refresh token setelah token session didapat dan profil aplikasi dinyatakan `ACTIVE`.
- `GET /api/auth/me` memverifikasi Bearer token dengan Supabase Auth dan mengembalikan data pengguna serta profil miliknya.
- `/api/applicant/test`, `/api/company/test`, dan `/api/admin/test` hanya dipasang pada `NODE_ENV=development`.

Auth request membuat Supabase client tersendiri, jadi session tidak berbagi state antar-request. `public.users` dan relasi `roles` menjadi sumber role aplikasi; metadata user tidak dipakai untuk otorisasi. Frontend sebaiknya memilih satu pengelola session yang konsisten dengan Supabase Auth SDK dan tidak mencatat token.

### Integrasi Login dan Register

Semua request dan response menggunakan JSON. Register menerima salah satu bentuk berikut:

```json
{
  "fullName": "Applicant Test",
  "email": "applicant@example.com",
  "password": "password-minimal-8-karakter",
  "accountType": "APPLICANT"
}
```

```json
{
  "fullName": "Company Test",
  "email": "company@example.com",
  "password": "password-minimal-8-karakter",
  "accountType": "COMPANY",
  "companyName": "Example Company"
}
```

Register mengembalikan HTTP 202 dengan response generik; frontend tidak boleh menganggap akun sudah dapat login sebelum email terkonfirmasi. Field tambahan seperti role, `user_id`, atau status akun ditolak.

Login menerima:

```json
{
  "email": "applicant@example.com",
  "password": "password-yang-digunakan"
}
```

Respons sukses HTTP 200 berisi `data.user` (`id`, `email`, `fullName`, `role`, `accountStatus`) serta `accessToken`, `refreshToken`, dan `expiresIn`. Simpan token hanya melalui mekanisme session yang dipilih frontend; jangan mencetaknya ke log. Kirim access token untuk endpoint terproteksi:

```http
Authorization: Bearer <accessToken>
```

Panggil `GET /api/auth/me` setelah login atau saat memulihkan session untuk memverifikasi pengguna dan memuat profil. Login dapat mengembalikan 403 jika email belum diverifikasi atau akun tidak aktif, 401 untuk kredensial salah, dan 429 saat rate limit tercapai. Validasi request yang gagal mengembalikan 400.

Rate limiting in-memory diterapkan pada endpoint register dan login. Untuk deployment multi-instance, gunakan store rate-limit bersama.

Migration trigger dan RLS di `supabase/migrations/` **tidak dijalankan otomatis**. Periksa trigger `auth.users` dan policies pada tabel target terlebih dahulu; migration memiliki preflight yang berhenti jika menemukan trigger/policy lain. Jalankan SQL secara manual di Supabase SQL Editor dengan urutan timestamp. Setelah migration diterapkan, `supabase/tests/auth_rls.sql` menguji akses positif dan isolasi negatif; ganti placeholder UUID dengan akun tes APPLICANT dan COMPANY yang sudah ada.

## Struktur dan layer

- `src/routes/` memetakan URL ke controller.
- `src/controllers/` menangani request dan response HTTP.
- `src/services/` menangani logika aplikasi termasuk aturan status lowongan.
- `src/repositories/` menangani akses data Supabase.
- `src/middlewares/` menangani route yang tidak ditemukan dan error global.
- `src/config/` memvalidasi environment dengan Zod dan menyediakan Supabase JS.
- `src/app.ts` menginisialisasi Express tanpa membuka port agar mudah diuji.
- `src/server.ts` memuat environment dan menjalankan HTTP server.

Authentication dan Jobs API menggunakan struktur routes → middleware → controllers → services → repositories. `validators/` dan `types/` berisi kontrak request serta model yang digunakan kedua modul. Migration yang tersedia tetap perlu ditinjau dan dijalankan secara manual; server tidak menjalankan migration atau seed otomatis.

## Endpoint

| Method | Path | Keterangan |
| --- | --- | --- |
| GET | `/api/health` | Status aplikasi (tidak menguji koneksi database) |
| GET | `/api/jobs` | Lowongan publik ACTIVE dan belum melewati deadline; query: `page`, `pageSize`, `search`, `employmentType`, `location` |
| GET | `/api/jobs/:id` | Detail lowongan publik ACTIVE dan belum melewati deadline |
| POST | `/api/company/jobs` | COMPANY terautentikasi membuat lowongan DRAFT |
| GET | `/api/company/jobs` | COMPANY terautentikasi melihat lowongan sendiri; query: `page`, `pageSize` |
| PATCH | `/api/company/jobs/:id` | COMPANY pemilik memperbarui `title`, `employmentType`, `location`, atau `deadline` |
| PATCH | `/api/company/jobs/:id/status` | COMPANY pemilik mengubah status dengan aturan transisi |
| GET | `/api/applicant/profile` | APPLICANT terautentikasi membaca profilnya |
| PATCH | `/api/applicant/profile` | APPLICANT memperbarui `headline`, `phoneNumber`, dan/atau `professionalSummary` |
| GET | `/api/company/profile` | COMPANY terautentikasi membaca profilnya |
| PATCH | `/api/company/profile` | COMPANY memperbarui `companyName` dan/atau `industry` |
| GET | `/api/applicant/cvs` | APPLICANT melihat metadata CV miliknya |
| POST | `/api/applicant/cvs` | APPLICANT mengunggah satu file CV melalui multipart field `file` |
| GET | `/api/applicant/cvs/:id` | APPLICANT melihat metadata CV miliknya |
| GET | `/api/applicant/cvs/:id/download` | APPLICANT memperoleh signed URL privat dengan masa berlaku 60 detik |
| DELETE | `/api/applicant/cvs/:id` | Menghapus CV milik sendiri jika belum direferensikan lamaran atau analisis CV |
| GET | `/api/applicant/saved-jobs` | APPLICANT melihat lowongan tersimpan sendiri; query: `page`, `pageSize` |
| POST | `/api/applicant/saved-jobs` | APPLICANT menyimpan lowongan ACTIVE dengan `jobId` |
| DELETE | `/api/applicant/saved-jobs/:jobId` | APPLICANT menghapus lowongan tersimpan miliknya |
| GET | `/api/events` | Daftar event berstatus `PUBLISHED`; query: `page`, `pageSize`, `category`, `eventType`, `search` |
| GET | `/api/events/:id` | Detail event berstatus `PUBLISHED`; event dengan status lain tidak tersedia untuk publik |
| POST | `/api/applications` | APPLICANT mengirim lamaran dengan `jobId`, `cvId`, dan optional `coverLetter` |
| GET | `/api/applications` | APPLICANT melihat riwayat lamaran sendiri; query: `page`, `pageSize`, `status` |
| GET | `/api/applications/:id` | APPLICANT melihat detail lamaran miliknya |
| GET | `/api/company/applications` | COMPANY melihat lamaran pada lowongan miliknya; query: `page`, `pageSize`, `status` |
| GET | `/api/company/applications/:id` | COMPANY pemilik lowongan melihat detail lamaran |
| PATCH | `/api/company/applications/:id/status` | COMPANY pemilik lowongan memperbarui status lamaran dengan transisi yang diizinkan |

Profile endpoints memakai identitas pengguna dari JWT terverifikasi. Respons memuat `fullName` dari identitas akun, tetapi endpoint PATCH tidak mengubah `users.full_name`. Field PATCH divalidasi secara ketat; field kepemilikan, role, status akun, dan status verifikasi tidak dapat diubah. PATCH menggunakan Admin Client dengan filter `user_id` pemilik dari JWT karena grant/RLS database untuk `authenticated` hanya mengizinkan SELECT.

CV disimpan pada bucket privat `applicant-documents` di prefix `{applicant_profile_id}/cvs/`; response API hanya mengembalikan metadata, bukan `storage_key`. Prefix tersebut membedakan CV yang dikelola API ini dari dokumen applicant lain pada tabel generik yang sama. File PDF dan DOCX diverifikasi berdasarkan MIME, ekstensi, dan signature/container; batas ukuran default 10 MiB dan batas jumlah default 5 file per applicant. Konfigurasi dapat diubah melalui `CV_MAX_FILE_SIZE_BYTES` (maksimum 10 MiB, sesuai bucket) dan `CV_MAX_PER_APPLICANT`. Unduhan memakai signed URL berdurasi pendek. Metadata disimpan pada `public.application_documents` dengan `applicant_id` yang berasal dari profil applicant milik JWT.

Job Applications memakai profil applicant/perusahaan yang di-resolve dari JWT. Pengiriman lamaran menggunakan RPC `submit_job_application` agar pemeriksaan lowongan ACTIVE/deadline, kepemilikan CV, insert lamaran, dan tautan CV berlangsung atomik; database juga membatasi satu lamaran per applicant dan lowongan. Daftar memakai pagination. Respons company hanya menyertakan nama dan headline applicant serta metadata CV yang diperlukan; `storage_key` tidak pernah dikembalikan. Transisi status: `TERKIRIM -> DITINJAU/DITOLAK`, `DITINJAU -> WAWANCARA/DITERIMA/DITOLAK`, dan `WAWANCARA -> DITERIMA/DITOLAK`; `DITERIMA` serta `DITOLAK` terminal. Update status menggunakan conditional update sehingga perubahan bersamaan yang memakai status lama ditolak sebagai konflik.

Saved Jobs memakai identitas APPLICANT dari JWT dan menyimpan relasi pada `public.saved_jobs`. Unique constraint `(applicant_id, job_id)` mencegah duplikasi; hanya lowongan berstatus `ACTIVE` yang bisa ditambahkan. Daftar tetap menampilkan status lowongan terbaru, termasuk `CLOSED`, dan dipaginasi.

Jobs hanya memakai kolom yang terdokumentasi pada [docs/database-schema.md](./docs/database-schema.md). Transisi status yang diizinkan adalah `DRAFT -> ACTIVE`, `DRAFT -> CLOSED`, dan `ACTIVE -> CLOSED`; `CLOSED` terminal. Publikasi memerlukan `verification_status = VERIFIED` serta deadline yang tidak lewat. Lowongan dengan deadline sebelum tanggal UTC saat ini tidak ditampilkan publik.

Jobs API memakai Supabase Admin Client hanya di backend. Karena client administratif melewati RLS, setiap query publik membatasi status/deadline dan setiap query perusahaan membatasi kepemilikan dari user ID pada JWT terverifikasi. Tidak ada migration atau RLS policy baru pada implementasi ini. Jangan memakai secret key di frontend.

## Technical debt

- Perubahan status Jobs saat ini membaca status dan verifikasi lalu memperbarui row dalam operasi terpisah. Tambahkan compare-and-set/transaksi agar request bersamaan tidak melewati aturan transisi atau status verifikasi.
- Endpoint publik `GET /api/jobs` belum memiliki rate limit khusus dan menghitung total secara exact. Evaluasi rate limit/cache serta strategi pagination/count sebelum beban produksi meningkat.

## Environment

Salin `.env.example` ke `.env`, lalu isi:

- `NODE_ENV`, `PORT`, dan `CORS_ORIGIN` untuk server lokal dan konfigurasi CORS.
- `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, dan `SUPABASE_PUBLISHABLE_KEY` untuk koneksi project Supabase. Variabel Supabase opsional untuk health check.
- `SUPABASE_SECRET_KEY` hanya server-side dan digunakan Admin Client untuk operasi Jobs serta pemeriksaan read-only oleh `npm run check:supabase`.
- `CV_MAX_FILE_SIZE_BYTES` dan `CV_MAX_PER_APPLICANT` untuk mengatur batas upload CV (default masing-masing 10 MiB dan 5 file).

Publishable key harus berprefix `sb_publishable_` dan secret key harus berprefix `sb_secret_`. Jika Supabase belum dikonfigurasi lalu kode meminta client database, konfigurasi akan menghasilkan error yang jelas. Tidak ada koneksi atau data palsu. Admin Client hanya digunakan oleh trusted backend code dan tidak diekspos melalui API.

Jangan commit `.env` atau credential. Endpoint COMPANY memverifikasi JWT dan role melalui middleware yang sudah tersedia.
