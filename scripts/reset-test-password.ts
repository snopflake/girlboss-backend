
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const userId = "8321d5a4-cfab-4946-993c-99f6b8e7eb8e";
const expectedEmail = "testingnofa@gmail.com";

async function main() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Hanya boleh dijalankan saat development.");
  }

  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const newPassword = process.env.TEST_RESET_PASSWORD;

  if (!url || !secret || !newPassword) {
    throw new Error("Konfigurasi .env belum lengkap.");
  }

  if (newPassword.length < 8) {
    throw new Error("Password minimal 8 karakter.");
  }

  const supabase = createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } =
    await supabase.auth.admin.getUserById(userId);

  if (error || !data.user) {
    throw new Error("Akun pengujian tidak ditemukan.");
  }

  if (data.user.email !== expectedEmail) {
    throw new Error("Email akun tidak sesuai. Dibatalkan.");
  }

  const result = await supabase.auth.admin.updateUserById(
    userId,
    { password: newPassword }
  );

  if (result.error) {
    throw new Error(result.error.message);
  }

  console.log("[OK] Password akun pengujian berhasil direset.");
  console.log("Email:", result.data.user.email);
}

main().catch((error: unknown) => {
  console.error(
    "[ERROR]",
    error instanceof Error ? error.message : "Kesalahan tidak diketahui"
  );
  process.exitCode = 1;
});
