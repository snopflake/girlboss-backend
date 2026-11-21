import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.js";

let supabaseClient: SupabaseClient | undefined;

export function createSupabaseUserClient(accessToken?: string): SupabaseClient {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Supabase belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY sebelum menggunakan database.",
    );
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(accessToken
      ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      : {}),
  });
}

export function getSupabaseClient(): SupabaseClient {
  const client = supabaseClient ?? createSupabaseUserClient();
  supabaseClient = client;
  return client;
}
