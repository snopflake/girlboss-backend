
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const TEST_USER_ID = "8321d5a4-cfab-4946-993c-99f6b8e7eb8e";
const EXPECTED_EMAIL = "test.girlboss01@gmail.com";

async function main() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Script hanya boleh berjalan pada mode development.");
  }

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("Konfigurasi Supabase pada .env belum lengkap.");
  }

  const supabase = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.admin.getUserById(TEST_USER_ID);

  if (error || !data.user) {
    throw new Error(`Gagal membaca pengguna: ${error?.message}`);
  }

  if (data.user.email !== EXPECTED_EMAIL) {
    throw new Error("Identitas akun tidak cocok. Proses dibatalkan.");
  }

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log("Akun pengujian ditemukan:", data.user.email);

    const newEmail = (
      await rl.question("Masukkan email testing milikmu: ")
    ).trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      throw new Error("Format email tidak valid.");
    }

    console.log(`Email baru: ${newEmail}`);

    const confirm = await rl.question(
      "Ubah email dan konfirmasi akun? Ketik YA: "
    );

    if (confirm !== "YA") {
      console.log("Dibatalkan.");
      return;
    }

    const { data: updated, error: updateError } =
      await supabase.auth.admin.updateUserById(TEST_USER_ID, {
        email: newEmail,
        email_confirm: true,
      });

    if (updateError) {
      throw new Error(updateError.message);
    }

    console.log("[OK] Akun berhasil diperbarui.");
    console.log("Email:", updated.user.email);
    console.log("Confirmed:", updated.user.email_confirmed_at);
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[ERROR]",
    error instanceof Error ? error.message : "Terjadi kesalahan."
  );
  process.exitCode = 1;
});
