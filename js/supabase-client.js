import { getDeviceFingerprint } from "./device-identity.js";

const config = window.ZAKAT_CONFIG || {};
export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey && !config.demoMode);

let client = null;
if (isSupabaseConfigured) {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.2/+esm");
  client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "zakat-auth"
      },
      global: {
        headers: {
          "x-client-info": "zakat-management-static/11.2",
          "x-device-fingerprint": getDeviceFingerprint()
        }
      }
    });
}
export const supabase = client;

export async function getCurrentSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentProfile(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}
