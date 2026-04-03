import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

export type { Database } from "@/lib/supabase/database.types";

export type SupabaseAppClient = SupabaseClient<Database>;
export type SupabaseAdminClient = SupabaseClient<Database>;

let cachedPublicClient: SupabaseAppClient | null = null;
let cachedAdminClient: SupabaseAdminClient | null = null;

function requirePublicConfig() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase の接続設定が不足しています。");
  }

  return {
    url: getSupabaseUrl(),
    anonKey: getSupabaseAnonKey(),
  };
}

export { isSupabaseConfigured };

export async function createSupabaseServerClient() {
  const { url, anonKey } = requirePublicConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookieValues) {
        try {
          for (const { name, value, options } of cookieValues) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes them instead.
        }
      },
    },
  });
}

export function createSupabasePublicClient() {
  const { url, anonKey } = requirePublicConfig();

  if (!cachedPublicClient) {
    cachedPublicClient = createClient<Database>(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return cachedPublicClient;
}

export function getSupabaseAdminClient() {
  if (!isSupabaseAdminConfigured()) {
    return null;
  }

  if (!cachedAdminClient) {
    cachedAdminClient = createClient<Database>(
      getSupabaseUrl(),
      getSupabaseServiceRoleKey(),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return cachedAdminClient;
}