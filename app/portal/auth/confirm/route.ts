import {NextResponse} from 'next/server';
import {serverSupabase} from '../../../../lib/supabase-server';
export async function GET(request:Request){
 const url=new URL(request.url),token_hash=url.searchParams.get('token_hash'),type=url.searchParams.get('type');
 const redirect=(path:string)=>{const response=NextResponse.redirect(new URL(path,url.origin));response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return response};
 if(!token_hash||token_hash.length>1024||(type!=='email'&&type!=='recovery'))return redirect('/portal/login?verification=retry');
 const sb=await serverSupabase();const {error}=await sb.auth.verifyOtp({token_hash,type});
 if(error)return redirect('/portal/login?verification=retry');
 return redirect(type==='recovery'?'/portal/reset-password':'/portal');
}
