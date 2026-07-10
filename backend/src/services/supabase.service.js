/**
 * Cliente Supabase com service_role (ignora RLS).
 * Use APENAS no backend — nunca exponha essa chave ao frontend.
 */
import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);
