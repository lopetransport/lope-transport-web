import {serverSupabase} from '../../../../lib/supabase-server';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const headers={'Cache-Control':'private, no-store'};
 const {id}=await params;
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))return Response.json({error:'Document unavailable.'},{status:404,headers});
 const sb=await serverSupabase(),{data:{user},error}=await sb.auth.getUser();
 if(error||!user)return Response.json({error:'Sign in to open this document.'},{status:401,headers});
 const {data:document,error:lookupError}=await sb.from('compliance_documents').select('storage_path').eq('id',id).single();
 if(lookupError||!document)return Response.json({error:'Document unavailable.'},{status:404,headers});
 const {data,error:linkError}=await sb.storage.from('portal-compliance').createSignedUrl(document.storage_path,60);
 if(linkError||!data)return Response.json({error:'Document could not be opened. Please retry.'},{status:503,headers});
 return new Response(null,{status:302,headers:{...headers,Location:data.signedUrl}});
}
