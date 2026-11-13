import { createServerClient } from '@supabase/ssr';
import { NextResponse,type NextRequest } from 'next/server';
import { supabaseUrl,supabaseKey } from './lib/supabase-config';
export async function proxy(request:NextRequest){
 let response=NextResponse.next({request});
 const sb=createServerClient(supabaseUrl,supabaseKey,{cookies:{getAll:()=>request.cookies.getAll(),setAll(values,headers){values.forEach(({name,value})=>request.cookies.set(name,value));response=NextResponse.next({request});values.forEach(({name,value,options})=>response.cookies.set(name,value,options));Object.entries(headers||{}).forEach(([name,value])=>response.headers.set(name,value));}}});
 await sb.auth.getClaims();response.headers.set('Cache-Control','private, no-store');return response;
}
export const config={matcher:['/portal/:path*']};
