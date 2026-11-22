# GirlBoss — Database Schema Reference

## 1. Overview

Dokumen ini merupakan referensi struktur database PostgreSQL untuk aplikasi **GirlBoss — Job Portal Khusus Perempuan**.

**Sumber:** Hasil introspeksi langsung dari database Supabase proyek GirlBoss pada 22 November 2026.

**Penting:**
- Dokumen ini menggambarkan schema yang sudah tersedia di Supabase.
- Dokumen ini bukan SQL migration dan tidak boleh dieksekusi.
- Jangan membuat ulang tabel yang sudah tersedia.
- Jangan menambahkan kolom, enum, constraint, atau relasi berdasarkan asumsi.
- Jika terdapat kebutuhan perubahan schema, buat migration SQL terpisah untuk ditinjau sebelum dijalankan.

Database menggunakan PostgreSQL dengan Supabase Authentication.

Autentikasi pengguna dikelola melalui `auth.users`, sedangkan identitas aplikasi, role, profil perusahaan, dan lowongan kerja disimpan pada schema `public`.

### Tabel yang didokumentasikan

| Table | Fungsi |
|---|---|
| `public.roles` | Daftar role aplikasi |
| `public.users` | Identitas dan role pengguna |
| `public.companies` | Profil perusahaan |
| `public.jobs` | Data lowongan kerja |

---

## 2. Table: public.roles

Menyimpan role pengguna dalam sistem GirlBoss.

### Columns

| Column | Data type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `role_name` | `varchar(30)` | NO | NULL |
| `description` | `text` | YES | NULL |

### Constraints

**Primary key**

`roles_pkey`: `PRIMARY KEY (id)`

**Unique constraint**

`roles_role_name_key`: `UNIQUE (role_name)`

**Check constraint**

`roles_name_check`:

```sql
CHECK (
    role_name::text = ANY (
        ARRAY[
            'APPLICANT',
            'COMPANY',
            'ADMIN'
        ]::text[]
    )
)
```

Nilai role yang diperbolehkan adalah `APPLICANT`, `COMPANY`, dan `ADMIN`.

Kolom `role_name` menggunakan `varchar(30)` dengan CHECK constraint, bukan PostgreSQL ENUM.

### Indexes

| Index | Definition |
|---|---|
| `roles_pkey` | UNIQUE BTREE (`id`) |
| `roles_role_name_key` | UNIQUE BTREE (`role_name`) |

### Row Level Security

RLS enabled: **true**

Policy: `girlboss_roles_authenticated_select`

| Property | Value |
|---|---|
| Command | SELECT |
| Roles | `authenticated` |
| USING | `true` |
| WITH CHECK | NULL |

Policy mengizinkan pengguna yang terautentikasi membaca daftar role.

### Table grants

| Database role | Privileges |
|---|---|
| `anon` | None |
| `authenticated` | SELECT |

---

## 3. Table: public.users

Menyimpan data identitas pengguna dan role aplikasi.

### Columns

| Column | Data type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | NULL |
| `role_id` | `uuid` | NO | NULL |
| `full_name` | `text` | NO | NULL |
| `account_status` | `varchar(30)` | NO | `'ACTIVE'` |
| `created_at` | `timestamptz` | NO | `now()` |

### Constraints

**Primary key**

`users_pkey`: `PRIMARY KEY (id)`

**Foreign keys**

`users_id_fkey`:

```sql
FOREIGN KEY (id)
REFERENCES auth.users(id)
ON DELETE CASCADE
```

`users_role_id_fkey`:

```sql
FOREIGN KEY (role_id)
REFERENCES public.roles(id)
ON DELETE RESTRICT
```

### Indexes

| Index | Definition |
|---|---|
| `users_pkey` | UNIQUE BTREE (`id`) |
| `idx_users_role` | BTREE (`role_id`) |

### Row Level Security

RLS enabled: **true**

Policy: `girlboss_users_owner_select`

| Property | Value |
|---|---|
| Command | SELECT |
| Roles | `authenticated` |
| USING | `id = (SELECT auth.uid())` |
| WITH CHECK | NULL |

Pengguna yang terautentikasi hanya dapat membaca record `public.users` miliknya sendiri melalui policy tersebut.

### Table grants

| Database role | Privileges |
|---|---|
| `anon` | None |
| `authenticated` | SELECT |

### Notes

- `public.users.id` menggunakan UUID yang sama dengan `auth.users.id`.
- Role aplikasi ditentukan melalui relasi `role_id` ke `public.roles`.
- Password tidak disimpan pada `public.users`.
- Nilai default `account_status` adalah `ACTIVE`.
- Hasil introspeksi tidak menunjukkan CHECK constraint untuk `account_status`. Jangan mengasumsikan daftar nilai lain tanpa spesifikasi tambahan.
- Pembuatan identitas pengguna dilakukan melalui proses autentikasi dan trigger database yang sudah tersedia.

---

## 4. Table: public.companies

Menyimpan profil perusahaan yang terhubung dengan akun pengguna ber-role `COMPANY`.

### Columns

| Column | Data type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `user_id` | `uuid` | NO | NULL |
| `company_name` | `text` | NO | NULL |
| `industry` | `text` | YES | NULL |
| `verification_status` | `text` | NO | `'PENDING'` |

### Constraints

**Primary key**

`companies_pkey`: `PRIMARY KEY (id)`

**Unique constraint**

`companies_user_id_key`: `UNIQUE (user_id)`

**Foreign key**

`companies_user_id_fkey`:

```sql
FOREIGN KEY (user_id)
REFERENCES public.users(id)
ON DELETE CASCADE
```

### Indexes

| Index | Definition |
|---|---|
| `companies_pkey` | UNIQUE BTREE (`id`) |
| `companies_user_id_key` | UNIQUE BTREE (`user_id`) |

### Row Level Security

RLS enabled: **true**

Policy: `girlboss_companies_owner_select`

Command: `SELECT`

Roles: `authenticated`

USING expression:

```sql
(
    user_id = (SELECT auth.uid())
    AND EXISTS (
        SELECT 1
        FROM public.users owner_user
        JOIN public.roles owner_role
            ON owner_role.id = owner_user.role_id
        WHERE owner_user.id = (SELECT auth.uid())
          AND owner_role.role_name = 'COMPANY'
    )
)
```

WITH CHECK: `NULL`

Policy tersebut membatasi pembacaan profil perusahaan kepada akun pemiliknya yang memiliki role `COMPANY`.

### Table grants

| Database role | Privileges |
|---|---|
| `anon` | None |
| `authenticated` | SELECT |

### Notes

- Satu record `public.users` dapat memiliki maksimal satu record `public.companies` karena UNIQUE constraint pada `user_id`.
- Setiap record perusahaan memiliki UUID tersendiri pada `companies.id`.
- `companies.id` berbeda dari `companies.user_id`.
- Nilai default `verification_status` adalah `PENDING`.
- Hasil introspeksi tidak menunjukkan CHECK constraint atau ENUM untuk `verification_status`. Status lain tidak boleh diasumsikan sebagai nilai database yang sudah dibatasi secara formal.
- Untuk kebutuhan Jobs API, perusahaan dengan status `PENDING` diperbolehkan membuat draft, tetapi tidak diperbolehkan memublikasikan lowongan. Ini merupakan aturan bisnis aplikasi, bukan constraint yang ditemukan pada tabel.

---

## 5. Table: public.jobs

Menyimpan data lowongan kerja milik perusahaan yang terdaftar di GirlBoss.

### Columns

| Column | Data type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` |
| `company_id` | `uuid` | NO | NULL |
| `title` | `text` | NO | NULL |
| `employment_type` | `text` | YES | NULL |
| `location` | `text` | YES | NULL |
| `status` | `text` | NO | `'DRAFT'` |
| `deadline` | `date` | YES | NULL |

### Constraints

**Primary key**

`jobs_pkey`: `PRIMARY KEY (id)`

**Foreign key**

`jobs_company_id_fkey`:

```sql
FOREIGN KEY (company_id)
REFERENCES public.companies(id)
ON DELETE RESTRICT
```

**Check constraint**

`jobs_status_check`:

```sql
CHECK (
    status = ANY (
        ARRAY[
            'DRAFT'::text,
            'ACTIVE'::text,
            'CLOSED'::text
        ]
    )
)
```

### Supported job statuses

| Status | Meaning |
|---|---|
| `DRAFT` | Lowongan masih berupa draft |
| `ACTIVE` | Lowongan aktif atau dipublikasikan |
| `CLOSED` | Lowongan telah ditutup |

Nilai `status` disimpan sebagai `text` dengan CHECK constraint, bukan PostgreSQL ENUM.

### Indexes

| Index | Definition |
|---|---|
| `jobs_pkey` | UNIQUE BTREE (`id`) |
| `idx_jobs_company` | BTREE (`company_id`) |
| `idx_jobs_status_deadline` | BTREE (`status`, `deadline`) |

### Row Level Security

RLS enabled: **true**

**Existing RLS policies: None**

Hasil introspeksi menunjukkan bahwa belum terdapat RLS policy pada `public.jobs`.

### Table grants

| Database role | Privileges |
|---|---|
| `anon` | None |
| `authenticated` | None |

### Notes

- Tabel `jobs` telah tersedia secara fisik di Supabase.
- Setiap lowongan wajib memiliki `company_id` yang merujuk ke `public.companies.id`.
- Default status lowongan adalah `DRAFT`.
- `title` wajib diisi.
- `employment_type`, `location`, dan `deadline` bersifat opsional pada tingkat database.
- Kolom `deadline` menggunakan tipe PostgreSQL `date`, bukan `timestamp`.
- Hasil introspeksi tidak menunjukkan CHECK constraint atau ENUM untuk `employment_type`.
- Tabel tidak memiliki kolom `created_at`, `updated_at`, `description`, `salary`, `requirements`, `benefits`, atau `user_id`.
- Jangan menggunakan kolom tambahan tersebut dalam query INSERT, SELECT, UPDATE, filtering, atau sorting tanpa migration schema yang disetujui.
- Karena RLS aktif dan tidak terdapat GRANT maupun policy untuk `anon` dan `authenticated`, akses langsung melalui Supabase REST API dengan kedua role tersebut belum diizinkan.

---

## 6. Database Relationships

Relasi yang sudah terkonfirmasi berdasarkan foreign key:

```text
auth.users
    |
    | 1 : 1
    v
public.users
    |
    | many : 1
    v
public.roles

public.users
    |
    | 1 : 0..1
    v
public.companies
    |
    | 1 : many
    v
public.jobs
```

### Foreign key mapping

| Source column | Target column | On delete |
|---|---|---|
| `users.id` | `auth.users.id` | CASCADE |
| `users.role_id` | `roles.id` | RESTRICT |
| `companies.user_id` | `users.id` | CASCADE |
| `jobs.company_id` | `companies.id` | RESTRICT |

### Important ownership mapping

Pada operasi Jobs API, identitas akun diperoleh dari JWT yang telah diverifikasi.

Urutan penentuan perusahaan pemilik:

1. Identifikasi pengguna dari JWT melalui `auth.users.id`.
2. Temukan `public.users` dengan `id` yang sesuai.
3. Pastikan role pengguna adalah `COMPANY`.
4. Temukan `public.companies` dengan `companies.user_id = users.id`.
5. Gunakan `companies.id` sebagai `jobs.company_id`.
6. Untuk update atau perubahan status, pastikan `jobs.company_id` sama dengan `companies.id` milik pengguna yang sedang login.

Jangan menggunakan `user_id` atau `company_id` dari request body sebagai identitas pemilik yang dipercaya.

---

## 7. Security and Access Rules for Jobs API

Backend GirlBoss menggunakan arsitektur:

**Routes → Middleware → Controllers → Services → Repositories → Supabase**

REST API Jobs harus mengikuti arsitektur tersebut.

### Public access

Endpoint publik:

| Method | Endpoint | Rule |
|---|---|---|
| GET | `/api/jobs` | Hanya menampilkan lowongan ACTIVE |
| GET | `/api/jobs/:id` | Hanya menampilkan detail lowongan ACTIVE |

Endpoint publik tidak boleh mengekspos draft maupun lowongan yang telah ditutup.

### Company access

Endpoint Perusahaan:

| Method | Endpoint | Rule |
|---|---|---|
| POST | `/api/company/jobs` | Membuat lowongan DRAFT |
| GET | `/api/company/jobs` | Melihat lowongan milik sendiri |
| PATCH | `/api/company/jobs/:id` | Memperbarui lowongan milik sendiri |
| PATCH | `/api/company/jobs/:id/status` | Memperbarui status lowongan milik sendiri |

Semua endpoint COMPANY wajib menggunakan autentikasi JWT dan RBAC yang sudah tersedia.

### Business rules

- Hanya akun dengan role `COMPANY` yang dapat mengelola lowongan.
- Akun `APPLICANT` tidak dapat membuat atau mengubah lowongan.
- Perusahaan hanya dapat mengakses lowongan miliknya sendiri melalui endpoint pengelolaan.
- Perusahaan dengan `verification_status = PENDING` dapat membuat draft, tetapi tidak dapat memublikasikan lowongan menjadi `ACTIVE`.
- Perubahan status lowongan wajib mematuhi nilai `DRAFT`, `ACTIVE`, dan `CLOSED`.
- Transisi status yang diizinkan harus didefinisikan secara eksplisit pada service layer.
- Kebijakan mengenai lowongan kedaluwarsa dan validasi tanggal `deadline` harus ditetapkan pada business logic karena database hanya mendefinisikan tipe `date` dan nullable.

### Supabase access considerations

Untuk implementasi tahap awal, Jobs API dapat diakses melalui backend Express.

Jika repository menggunakan Supabase Admin Client dengan hak administratif, query dapat melewati RLS. Oleh karena itu:

- JWT dan role wajib diverifikasi.
- Ownership check wajib diterapkan pada setiap operasi COMPANY.
- Filter `company_id` harus berasal dari profil perusahaan pengguna yang terautentikasi.
- Field kepemilikan tidak boleh bisa diubah melalui request.
- Secret key Supabase tidak boleh dikirim ke frontend.
- Jangan menonaktifkan RLS.
- Jangan menambahkan GRANT atau policy terbuka tanpa review.
- Jika dibutuhkan perubahan akses database, siapkan migration SQL terpisah.

---

## 8. Implementation Constraints

Copilot atau developer yang menggunakan dokumen ini harus mengikuti ketentuan berikut:

**Schema fidelity**

Implementasi harus menggunakan kolom, tipe, constraint, dan hubungan yang benar-benar terdaftar pada dokumen ini.

**Validation**

Gunakan Zod untuk memvalidasi request body, route parameter, query parameter, pagination, serta status lowongan.

**Authorization**

Gunakan middleware authentication dan authorization yang sudah tersedia. Jangan membuat mekanisme autentikasi paralel yang tidak diperlukan.

**Pagination and sorting**

Gunakan kolom yang tersedia. Jangan melakukan sorting berdasarkan `created_at` karena kolom tersebut tidak terdapat pada tabel `jobs`. Tetapkan urutan yang deterministik, misalnya dengan `id`, bila diperlukan.

**Data modifications**

Jangan melakukan perubahan schema, menambahkan kolom, membuat ulang tabel, atau menerapkan migration secara otomatis.

**Testing**

Tambahkan automated tests untuk akses publik, autentikasi, RBAC, kepemilikan lowongan, validasi input, status perusahaan, dan perubahan status lowongan.

**Compatibility**

Pertahankan endpoint Authentication, struktur respons API, middleware error, dan konfigurasi Supabase yang sudah berjalan.

---

## 9. Known Limitations and Future Schema Considerations

Hasil introspeksi menunjukkan bahwa schema `jobs` masih minimal untuk kebutuhan portal lowongan kerja.

Belum terdapat kolom untuk deskripsi pekerjaan, kualifikasi, gaji, benefit, tanggal pembuatan, maupun tanggal pembaruan.

Kebutuhan field tambahan harus dievaluasi berdasarkan requirement sistem dan desain frontend sebelum dibuatkan migration.

Hal lain yang perlu ditentukan sebelum implementasi fitur lanjutan:

- Daftar status verifikasi perusahaan yang didukung aplikasi.
- Aturan perubahan status lowongan.
- Kebijakan publikasi setelah `deadline`.
- Aturan pencarian dan filter yang relevan dengan field yang tersedia.
- Mekanisme audit dan pencatatan waktu perubahan data.
- Kebijakan akses database untuk modul Jobs jika kelak frontend membutuhkan akses langsung.

**Dokumen ini merupakan referensi schema aktual dan tidak menyatakan bahwa seluruh aturan bisnis di atas telah diterapkan sebagai constraint atau RLS policy di database.**

---

## 10. Source and Verification

Dokumen disusun berdasarkan hasil query introspeksi PostgreSQL terhadap:

- `pg_class`
- `pg_namespace`
- `pg_attribute`
- `pg_attrdef`
- `pg_constraint`
- `pg_indexes`
- `pg_policies`
- `information_schema.role_table_grants`

Tabel yang diverifikasi:

`public.roles`, `public.users`, `public.companies`, dan `public.jobs`.

**Last documented:** 22 November 2026.

Dokumen perlu diperbarui apabila terdapat migration baru yang mengubah schema, constraint, index, GRANT, atau RLS policy.