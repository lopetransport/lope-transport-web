'use client';
import {useCallback,useEffect,useState} from 'react';import {useRouter} from 'next/navigation';import {getSupabase} from '../../lib/supabaseClient';import type {Membership,ClientAsset,Profile,Quote,Job,Vehicle,Document,Invoice,Enquiry,Dispatch} from '../../lib/portal-types';
export type PortalData={memberships:Membership[];clientAssets:ClientAsset[];quotes:Quote[];jobs:Job[];vehicles:Vehicle[];documents:Document[];invoices:Invoice[];profiles:Profile[];enquiries:Enquiry[];dispatch:Dispatch[]};
const empty:PortalData={memberships:[],clientAssets:[],quotes:[],jobs:[],vehicles:[],documents:[],invoices:[],profiles:[],enquiries:[],dispatch:[]};
export function usePortalData(profile:Profile){
 const router=useRouter(),[data,setData]=useState<PortalData>(empty),[loading,setLoading]=useState(true),[error,setError]=useState(''),[connected,setConnected]=useState(false),[refreshing,setRefreshing]=useState(false);
 const refresh=useCallback(async()=>{setRefreshing(true);try{
  const sb=getSupabase();const requests:Record<string,PromiseLike<{data:unknown;error:unknown}>>={};
  const add=(key:string,table:string)=>{requests[key]=sb.from(table).select('*').order(table==='client_jobs'?'updated_at':'created_at',{ascending:false}).limit(500)};
  add('profiles','profiles');if(profile.role!=='hauler'){add('memberships','client_memberships');add('clientAssets','client_fleet_assets')}if(profile.role!=='hauler'){add('quotes','quotes');add('invoices','invoices')}add('jobs','client_jobs');if(profile.role!=='client'){add('vehicles','fleet_vehicles');add('documents','compliance_documents')}if(profile.role==='admin'){add('enquiries','freight_enquiries');add('dispatch','dispatch_enquiries')}
  const entries=Object.entries(requests),results=await Promise.all(entries.map(([,request])=>request));let next={...empty};
  results.forEach((result,index)=>{if(result.error)throw new Error('Some portal information could not be loaded. Please retry.');next={...next,[entries[index][0]]:result.data||[]}});
  setData(next);setError('');const own=next.profiles.find(p=>p.id===profile.id);if(own&&(own.role!==profile.role||own.account_status!==profile.account_status))router.refresh();
 }catch(e){setError(e instanceof Error?e.message:'Connection unavailable.')}finally{setLoading(false);setRefreshing(false)}},[profile.id,profile.role,profile.account_status,router]);
 useEffect(()=>{void refresh();const sb=getSupabase(),channel=sb.channel('portal-'+profile.id);let timer:ReturnType<typeof setTimeout>;const reload=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),250)};
  for(const table of ['client_memberships','client_fleet_assets','profiles','quotes','client_jobs','fleet_vehicles','compliance_documents','invoices'])channel.on('postgres_changes',{event:'*',schema:'public',table},reload);
  channel.subscribe(status=>setConnected(status==='SUBSCRIBED'));const poll=setInterval(()=>void refresh(),60000);return()=>{clearTimeout(timer);clearInterval(poll);void sb.removeChannel(channel)};
 },[profile.id,refresh]);return {data,loading,error,refresh,connected,refreshing};
}
