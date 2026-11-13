import { createBrowserClient } from '@supabase/ssr';
import { supabaseUrl, supabaseKey } from './supabase-config';
export function getSupabase(){return createBrowserClient(supabaseUrl,supabaseKey);}
