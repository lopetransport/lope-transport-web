import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseUrl, supabaseKey } from './supabase-config';
import type { Profile,Role } from './portal-types';
export async function serverSupabase(){
 const jar=await cookies();
 return createServerClient(supabaseUrl,supabaseKey,{cookies:{getAll:()=>jar.getAll(),setAll(values){try{values.forEach(({name,value,options})=>jar.set(name,value,options));}catch{/* Proxy refreshes server-rendered sessions. */}}}});
}
export async function requireProfile(role?:Role){
 const sb=await serverSupabase();const {data:{user},error}=await sb.auth.getUser();
 if(error||!user)redirect('/portal/login');
 const {data,error:profileError}=await sb.from('profiles').select('*').eq('id',user.id).single();
 if(profileError||!data)throw new Error('Your portal profile could not be loaded. Please retry.');
 const profile=data as Profile;
 if(role&&profile.role!==role)redirect('/portal/'+profile.role);
 return profile;
}
