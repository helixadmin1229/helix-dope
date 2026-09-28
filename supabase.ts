// ============================================================
// lib/supabase.ts
// Supabase client factory.
// Browser client: uses anon key (safe to expose)
// Server client: uses service role key (never expose)
// ============================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Browser client (singleton) ────────────────────────────────
// Use in React components and hooks.

let _browser: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (!_browser) {
    _browser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _browser;
}

// ── Server client ─────────────────────────────────────────────
// Use in API routes and server components.
// Bypasses RLS — only use server-side.

export function getServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },   // no cookie auth on server
  });
}

// ── Session ID helper ─────────────────────────────────────────
// Simple browser-persisted session ID (no auth required).
// Replace with real auth if you add user accounts.

export function getSessionId(): string {
  if (typeof window === "undefined") return "server";

  let id = localStorage.getItem("dope_session_id");
  if (!id) {
    id = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("dope_session_id", id);
  }
  return id;
}
