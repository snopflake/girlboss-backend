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
- `npm test` menjalankan integration test health, authentication, Jobs, Profile, CV, Job Applications, Saved Jobs, Events, CV Analyzer, dan Interview Preparation API dengan test runner bawaan Node.js.

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

Semua endpoint berada di bawah prefix `/api`. Kecuali upload CV, body request menggunakan JSON. Semua response sukses memakai envelope `{ "success": true, "message": "...", "data": ... }`. Error memakai `{ "success": false, "message": "...", "errors": ... }`; `errors` berisi detail validasi atau `null`. Request terproteksi mengirim `Authorization: Bearer <accessToken>`.

| Method | Path | Akses | Request penting | Bentuk `data` sukses |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | Publik | — | Status health |
| POST | `/api/auth/register` | Publik | JSON: `fullName`, `email`, `password`, `accountType`; `companyName` wajib untuk COMPANY | `null` (HTTP 202) |
| POST | `/api/auth/login` | Publik | JSON: `email`, `password` | `user`, `accessToken`, `refreshToken`, `expiresIn` |
| GET | `/api/auth/me` | JWT, semua role | Bearer token | Pengguna dan profil saat ini |
| GET | `/api/jobs` | Publik | Query: `page`, `pageSize`, `search`, `employmentType`, `location` | `jobs[]`, `pagination` |
| GET | `/api/jobs/:id` | Publik | UUID `id` | Objek lowongan |
| POST | `/api/company/jobs` | COMPANY | JSON: `title`; opsional `employmentType`, `location`, `deadline` | Objek lowongan DRAFT (HTTP 201) |
| GET | `/api/company/jobs` | COMPANY | Query: `page`, `pageSize` | `jobs[]`, `pagination` |
| PATCH | `/api/company/jobs/:id` | COMPANY pemilik lowongan | JSON: field yang diubah dari `title`, `employmentType`, `location`, `deadline` | Objek lowongan |
| PATCH | `/api/company/jobs/:id/status` | COMPANY pemilik lowongan | JSON: `{ "status": "ACTIVE" }` atau status transisi valid lainnya | Objek lowongan |
| GET | `/api/applicant/profile` | APPLICANT | Bearer token | Profil termasuk `fullName` |
| PATCH | `/api/applicant/profile` | APPLICANT | JSON: `headline`, `phoneNumber`, `professionalSummary` | Profil terbaru |
| GET | `/api/company/profile` | COMPANY | Bearer token | Profil termasuk `fullName` |
| PATCH | `/api/company/profile` | COMPANY | JSON: `companyName`, `industry` | Profil terbaru |
| GET | `/api/applicant/cvs` | APPLICANT | Bearer token | `cvs[]` metadata (`id`, `fileName`, `fileSize`, `mimeType`) |
| POST | `/api/applicant/cvs` | APPLICANT | `multipart/form-data`, satu file pada field `file`; PDF/DOCX | Metadata CV (HTTP 201) |
| GET | `/api/applicant/cvs/:id` | APPLICANT, pemilik CV | UUID `id` | Metadata CV |
| GET | `/api/applicant/cvs/:id/download` | APPLICANT, pemilik CV | UUID `id` | `signedUrl`, `expiresIn` (60 detik) |
| DELETE | `/api/applicant/cvs/:id` | APPLICANT, pemilik CV | UUID `id` | `{ "id": "..." }` |
| GET | `/api/applicant/saved-jobs` | APPLICANT | Query: `page`, `pageSize` | `savedJobs[]`, `pagination` |
| POST | `/api/applicant/saved-jobs` | APPLICANT | JSON: `{ "jobId": "<uuid>" }` | `{ "jobId": "..." }` (HTTP 201) |
| DELETE | `/api/applicant/saved-jobs/:jobId` | APPLICANT, pemilik simpanan | UUID `jobId` | `{ "jobId": "..." }` |
| GET | `/api/events` | Publik | Query: `page`, `pageSize`, `category`, `eventType`, `search` | `events[]`, `pagination` |
| GET | `/api/events/:id` | Publik | UUID `id` | Objek event berstatus `PUBLISHED` |
| POST | `/api/cv-analyses` | APPLICANT | JSON: `{ "cvId": "<uuid>" }` | Analisis dengan `score`, `summary`, `strengths`, `weaknesses`, `recommendations` (HTTP 201) |
| GET | `/api/cv-analyses` | APPLICANT | Query: `page`, `pageSize` | `analyses[]`, `pagination` |
| GET | `/api/cv-analyses/:id` | APPLICANT, pemilik analisis | UUID `id` | Detail analisis; hasil `null` jika `PROCESSING`/`FAILED` |
| POST | `/api/interview-sessions` | APPLICANT | JSON: `{ "jobTitle": "Backend Engineer" }` | Sesi `IN_PROGRESS` dengan lima pertanyaan (HTTP 201) |
| GET | `/api/interview-sessions` | APPLICANT | Query: `page`, `pageSize` | `sessions[]`, `pagination` |
| GET | `/api/interview-sessions/:id` | APPLICANT, pemilik sesi | UUID `id` | Detail pertanyaan, jawaban, evaluasi, dan ringkasan jika selesai |
| POST | `/api/interview-sessions/:id/answers` | APPLICANT, pemilik sesi | JSON: `{ "questionId": "<uuid>", "answerText": "..." }` | Jawaban dan evaluasi terstruktur |
| POST | `/api/interview-sessions/:id/complete` | APPLICANT, pemilik sesi | UUID `id`; semua lima jawaban harus sudah dievaluasi | Sesi `COMPLETED` dan ringkasan skor |
| POST | `/api/applications` | APPLICANT | JSON: `jobId`, `cvId`, opsional `coverLetter` | `id`, `jobId`, `cvId`, `status`, `submittedAt` (HTTP 201) |
| GET | `/api/applications` | APPLICANT | Query: `page`, `pageSize`, `status` | `applications[]`, `pagination` |
| GET | `/api/applications/:id` | APPLICANT, pemilik lamaran | UUID `id` | Detail lamaran dan lowongan |
| GET | `/api/company/applications` | COMPANY | Query: `page`, `pageSize`, `status` | `applications[]`, `pagination` |
| GET | `/api/company/applications/:id` | COMPANY pemilik lowongan | UUID `id` | Detail lamaran, ringkasan applicant, dan metadata CV |
| PATCH | `/api/company/applications/:id/status` | COMPANY pemilik lowongan | JSON: `{ "status": "<status/transisi valid>" }` | Detail lamaran terbaru |
| GET | `/api/applicant/test` | APPLICANT; development saja | Bearer token | `null` |
| GET | `/api/company/test` | COMPANY; development saja | Bearer token | `null` |
| GET | `/api/admin/test` | ADMIN; development saja | Bearer token | `null` |

Query pagination menggunakan `page` (default 1) dan `pageSize` (default 20, maksimum 100). Request PATCH profil/job harus memuat setidaknya satu field yang diizinkan. Validasi gagal menghasilkan HTTP 400; error umum mencakup 401 (belum login), 403 (role tidak sesuai), 404 (resource tidak tersedia/tidak dimiliki), 409 (konflik), dan 503 (layanan database/storage).

Profile endpoints memakai identitas pengguna dari JWT terverifikasi. Respons memuat `fullName` dari identitas akun, tetapi endpoint PATCH tidak mengubah `users.full_name`. Field PATCH divalidasi secara ketat; field kepemilikan, role, status akun, dan status verifikasi tidak dapat diubah. PATCH menggunakan Admin Client dengan filter `user_id` pemilik dari JWT karena grant/RLS database untuk `authenticated` hanya mengizinkan SELECT.

CV disimpan pada bucket privat `applicant-documents` di prefix `{applicant_profile_id}/cvs/`; response API hanya mengembalikan metadata, bukan `storage_key`. Prefix tersebut membedakan CV yang dikelola API ini dari dokumen applicant lain pada tabel generik yang sama. File PDF dan DOCX diverifikasi berdasarkan MIME, ekstensi, dan signature/container; batas ukuran default 10 MiB dan batas jumlah default 5 file per applicant. Konfigurasi dapat diubah melalui `CV_MAX_FILE_SIZE_BYTES` (maksimum 10 MiB, sesuai bucket) dan `CV_MAX_PER_APPLICANT`. Unduhan memakai signed URL berdurasi pendek. Metadata disimpan pada `public.application_documents` dengan `applicant_id` yang berasal dari profil applicant milik JWT.

Job Applications memakai profil applicant/perusahaan yang di-resolve dari JWT. Pengiriman lamaran menggunakan RPC `submit_job_application` agar pemeriksaan lowongan ACTIVE/deadline, kepemilikan CV, insert lamaran, dan tautan CV berlangsung atomik; database juga membatasi satu lamaran per applicant dan lowongan. Daftar memakai pagination. Respons company hanya menyertakan nama dan headline applicant serta metadata CV yang diperlukan; `storage_key` tidak pernah dikembalikan. Transisi status: `TERKIRIM -> DITINJAU/DITOLAK`, `DITINJAU -> WAWANCARA/DITERIMA/DITOLAK`, dan `WAWANCARA -> DITERIMA/DITOLAK`; `DITERIMA` serta `DITOLAK` terminal. Update status menggunakan conditional update sehingga perubahan bersamaan yang memakai status lama ditolak sebagai konflik.

Saved Jobs memakai identitas APPLICANT dari JWT dan menyimpan relasi pada `public.saved_jobs`. Unique constraint `(applicant_id, job_id)` mencegah duplikasi; hanya lowongan berstatus `ACTIVE` yang bisa ditambahkan. Daftar tetap menampilkan status lowongan terbaru, termasuk `CLOSED`, dan dipaginasi.

CV Analyzer memakai CV privat milik pemohon dari CV Management. `POST /api/cv-analyses` membuat analisis sinkron; PDF teks dan DOCX diproses tanpa menjalankan kode/macro. PDF scan tanpa selectable text ditolak (OCR belum tersedia); ekstraksi dibatasi 50 halaman dan 25.000 karakter. Maksimum tiga permintaan per applicant dalam rolling 24 jam. Gemini timeout setelah 30 detik; kegagalan AI disimpan sebagai `FAILED` dan tidak menghasilkan hasil fallback.

Tabel `cv_analyses` menyimpan owner, CV, status, waktu, ringkasan, dan recommendations. Karena tabel belum memiliki kolom score/strengths/weaknesses, nilai tersebut disimpan sebagai JSON terstruktur di kolom teks `summary`, sedangkan `recommendations` tetap memakai array database. Tidak ada migration baru. Hasil dibaca melalui API sebagai field terstruktur.

Interview Preparation menyimpan posisi, status sesi, lima pertanyaan, jawaban teks, skor 0-100, dan evaluasi terstruktur pada tabel `interview_sessions`, `questions`, `answers`, dan `evaluations`. Empat aspek jawaban (relevansi, kejelasan, kelengkapan, kualitas penyampaian isi) disimpan sebagai JSON pada kolom teks `evaluations.recommendations`; skor numerik diringkas ke `evaluations.score`. Ringkasan akhir dihitung dari evaluasi tersimpan karena schema tidak memiliki kolom ringkasan/completed-at. Batas penggunaan adalah dua sesi baru per applicant dalam rolling 24 jam; setiap sesi membutuhkan satu panggilan untuk pertanyaan dan satu panggilan untuk tiap jawaban. Evaluasi berbasis teks saja dan tidak menilai suara/intonasi.

Pemeriksaan duplikasi jawaban dilakukan sebelum dan sesudah pemanggilan Gemini. Spesifikasi REST Supabase tidak mengonfirmasi unique constraint pada `answers.question_id`, sehingga request serentak untuk pertanyaan yang sama masih memerlukan constraint database untuk jaminan atomik. Penghitungan kuota sesi juga bukan operasi atomik antar-request.

Jobs hanya memakai kolom yang terdokumentasi pada [docs/database-schema.md](./docs/database-schema.md). Transisi status yang diizinkan adalah `DRAFT -> ACTIVE`, `DRAFT -> CLOSED`, dan `ACTIVE -> CLOSED`; `CLOSED` terminal. Publikasi memerlukan `verification_status = VERIFIED` serta deadline yang tidak lewat. Lowongan dengan deadline sebelum tanggal UTC saat ini tidak ditampilkan publik.

Jobs API memakai Supabase Admin Client hanya di backend. Karena client administratif melewati RLS, setiap query publik membatasi status/deadline dan setiap query perusahaan membatasi kepemilikan dari user ID pada JWT terverifikasi. Tidak ada migration atau RLS policy baru pada implementasi ini. Jangan memakai secret key di frontend.

## Keterbatasan integrasi

- Events bersifat read-only; belum ada endpoint pendaftaran event. Hanya status `PUBLISHED` yang dipublikasikan. Pemeriksaan terakhir tidak menemukan baris event, sehingga daftar dapat kosong sampai data tersedia.
- Profile PATCH tidak mengubah `users.full_name`; `fullName` hanya dibaca dari identitas pengguna.
- Saved Jobs memeriksa status `ACTIVE` sebelum insert dalam dua operasi terpisah. Perubahan status lowongan yang berbarengan dapat menimbulkan race window; jaminan atomik memerlukan mekanisme database tambahan.
- Login mengembalikan `refreshToken`, tetapi backend belum menyediakan endpoint refresh. Jika frontend mengelola refresh melalui Supabase SDK, konsistenkan satu pengelola session dan jangan mengirim token ke log.
- Belum ada endpoint Notifications maupun pendaftaran event; keduanya tidak termasuk API yang tersedia.

## Technical debt

- Perubahan status Jobs saat ini membaca status dan verifikasi lalu memperbarui row dalam operasi terpisah. Tambahkan compare-and-set/transaksi agar request bersamaan tidak melewati aturan transisi atau status verifikasi.
- Endpoint publik `GET /api/jobs` belum memiliki rate limit khusus dan menghitung total secara exact. Evaluasi rate limit/cache serta strategi pagination/count sebelum beban produksi meningkat.

## Environment

Salin `.env.example` ke `.env`, lalu isi:

- `NODE_ENV`, `PORT`, dan `CORS_ORIGIN` untuk server lokal dan konfigurasi CORS.
- `SUPABASE_PROJECT_ID`, `SUPABASE_URL`, dan `SUPABASE_PUBLISHABLE_KEY` untuk koneksi project Supabase. Variabel Supabase opsional untuk health check.
- `SUPABASE_SECRET_KEY` hanya server-side dan digunakan Admin Client untuk operasi Jobs serta pemeriksaan read-only oleh `npm run check:supabase`.
- `CV_MAX_FILE_SIZE_BYTES` dan `CV_MAX_PER_APPLICANT` untuk mengatur batas upload CV (default masing-masing 10 MiB dan 5 file).
- `GEMINI_API_KEY` untuk key Gemini, dan `GEMINI_MODEL` untuk nama model Flash yang tersedia pada key tersebut (tanpa prefix `models/`). Keduanya opsional saat startup, tetapi wajib dikonfigurasi untuk menjalankan analisis CV.
- Konfigurasi `GEMINI_API_KEY` dan `GEMINI_MODEL` yang sama juga digunakan AI Interview Preparation; tidak ada environment tambahan.

Publishable key harus berprefix `sb_publishable_` dan secret key harus berprefix `sb_secret_`. Jika Supabase belum dikonfigurasi lalu kode meminta client database, konfigurasi akan menghasilkan error yang jelas. Tidak ada koneksi atau data palsu. Admin Client hanya digunakan oleh trusted backend code dan tidak diekspos melalui API.

Jangan commit `.env` atau credential. Endpoint COMPANY memverifikasi JWT dan role melalui middleware yang sudah tersedia. Jangan kirim atau log isi CV maupun API key Gemini.
