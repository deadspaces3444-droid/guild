import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 🔑 Вставь свои значения из Supabase: Project Settings → API
const SUPABASE_URL = https://lyycxgrxeparakkhreqb.supabase.co;
const SUPABASE_ANON_KEY = sb_publishable_VtEOIWuEWYDgnHJx80iZ9A_fcisN8M-;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);