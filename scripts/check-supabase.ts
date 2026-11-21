import { loadEnv } from "../src/config/env.js";
import { getSupabaseAdminClient } from "../src/config/supabaseAdmin.js";

const requiredVariables = [
  "SUPABASE_PROJECT_ID",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;
const expectedRoles = ["APPLICANT", "COMPANY", "ADMIN"];
const timeoutMs = 10_000;

function fail(message: string): never {
  console.error(`[ERROR] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function classifyNetworkError(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "Network timeout";
  }
  if (error instanceof Error && error.name === "AbortError") {
    return "Request dibatalkan";
  }
  return "Network error";
}

async function checkAuthConnectivity(url: string, publishableKey: string): Promise<void> {
  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        fail(`Supabase Auth menolak akses (HTTP ${response.status}).`);
      }
      fail(`Supabase Auth mengembalikan HTTP ${response.status}.`);
    }

    console.info("[OK] Supabase Auth dapat diakses.");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase Auth ")) {
      throw error;
    }
    fail(`Supabase Auth tidak dapat diakses: ${classifyNetworkError(error)}.`);
  }
}

function reportDatabaseError(error: { code?: string; message: string }): never {
  if (error.code === "42P01") {
    fail("Tabel roles tidak ditemukan (table not found).");
  }
  if (error.code === "42501" || /permission denied|not allowed/i.test(error.message)) {
    fail("Akses database ditolak (permission denied).");
  }
  fail("Query database gagal (database query error).");
}

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    fail(error instanceof Error ? error.message : "Konfigurasi environment tidak valid.");
  }

  const missingVariables = requiredVariables.filter((name) => !env[name]);
  if (missingVariables.length > 0) {
    fail(`Environment belum lengkap: ${missingVariables.join(", ")}.`);
  }

  const projectUrl = new URL(env.SUPABASE_URL!);
  if (
    projectUrl.protocol !== "https:" ||
    projectUrl.hostname !== `${env.SUPABASE_PROJECT_ID}.supabase.co`
  ) {
    fail("SUPABASE_URL tidak sesuai dengan SUPABASE_PROJECT_ID atau bukan URL HTTPS Supabase.");
  }

  console.info("[OK] Konfigurasi Supabase valid.");
  await checkAuthConnectivity(env.SUPABASE_URL!, env.SUPABASE_PUBLISHABLE_KEY!);

  let result;
  try {
    result = await getSupabaseAdminClient().from("roles").select("role_name");
  } catch {
    fail("Koneksi atau query database gagal (network/database error).");
  }

  if (result.error) {
    reportDatabaseError(result.error);
  }

  if (
    !Array.isArray(result.data) ||
    result.data.length === 0 ||
    !result.data.every(
      (row: unknown) =>
        typeof row === "object" &&
        row !== null &&
        "role_name" in row &&
        typeof row.role_name === "string",
    )
  ) {
    fail("Query roles tidak mengembalikan array record role yang valid.");
  }

  console.info("[OK] Supabase PostgreSQL dapat diakses.");
  console.info("[OK] Tabel roles berhasil dibaca.");

  const availableRoles = new Set(
    result.data.map((row: { role_name: string }) => row.role_name),
  );
  const missingRoles = expectedRoles.filter((role) => !availableRoles.has(role));
  if (missingRoles.length > 0) {
    fail(`Role berikut belum tersedia: ${missingRoles.join(", ")}.`);
  }

  console.info("[OK] Ketiga role GirlBoss tersedia.");
}

main().catch(() => {
  process.exitCode = 1;
});
