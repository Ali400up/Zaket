import { getDeviceFingerprint } from "./device-identity.js";

const config = window.ZAKAT_CONFIG || {};
export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey && !config.demoMode);

export let supabase = null;

function buildClient(createClient) {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "zakat-auth"
      },
      global: {
        headers: {
          "x-client-info": "zakat-management-static/12.5.0",
          "x-device-fingerprint": getDeviceFingerprint()
        }
      }
    });
}

export async function ensureSupabaseClient(timeoutMs = 1200) {
  if (!isSupabaseConfigured || supabase) return supabase;
  const createClient = window.supabase?.createClient;
  if (typeof createClient !== "function") return null;
  supabase = buildClient(createClient);
  window.dispatchEvent(new CustomEvent("zakat:supabase-ready"));
  return supabase;
}

if (isSupabaseConfigured && navigator.onLine !== false) await ensureSupabaseClient(1200);
window.addEventListener("online", () => { ensureSupabaseClient(5000); });
window.addEventListener("zakat:connection-change", event => { if (event.detail?.online) ensureSupabaseClient(5000); });

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
