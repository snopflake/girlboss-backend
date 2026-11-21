import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./env.js";

let supabaseAdminClient: SupabaseClient | undefined;

export function getSupabaseAdminClient(): SupabaseClient {
  if (supabaseAdminClient) {
    return supabaseAdminClient;
  }

  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new Error(
      "Supabase Admin belum dikonfigurasi. Isi SUPABASE_URL dan SUPABASE_SECRET_KEY untuk operasi backend tepercaya.",
    );
  }

  supabaseAdminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return supabaseAdminClient;
}
