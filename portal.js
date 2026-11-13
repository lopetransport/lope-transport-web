import { importDpd, listDpd, readDpdUpload, reviewDpd } from './dpd-reconciliation.js';
import { fuelEstimateMonths } from './historical-operations.js';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {InputError} from './normalize.js';
import {latest,zones,history,historyParams} from './portal-store.js';
import {publicTracking} from './public-tracking.js';
import {estimateQuote} from './quote.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const equal=(a,b)=>{if(!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const json=(res,status,body,headers={})=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...headers});res.end(JSON.stringify(body));};
async function body(req){let n=0,parts=[];if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new InputError('Content-Type must be application/json',415);for await(const c of req){n+=c.length;if(n>65536)throw new InputError('Body too large',413);parts.push(c);}let value;try{value=JSON.parse(Buffer.concat(parts).toString());}catch{throw new InputError('Malformed JSON');}if(!value||typeof value!=='object'||Array.isArray(value))throw new InputError('Expected JSON object');return value;}
const text=(v,name,max=160)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new InputError('Invalid '+name);return v.trim();};
const date=(v)=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new InputError('Invalid expiry date');return v;};
export function createPortal({pool,adminToken}){
 const sessions=new Map(),launches=new Map(),attempts=new Map();
 const cookie=(req,value,clear=false)=>`lope_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:28800}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`;
 function session(req){const m=/(?:^|;\s*)lope_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'');if(!m)return false;const key=hash(m[1]),expires=sessions.get(key);if(!expires||expires<Date.now()){sessions.delete(key);return false;}return true;}
 function signIn(req,res){for(const [k,v]of sessions)if(v<Date.now())sessions.delete(k);if(sessions.size>=1000)throw new InputError('Session limit reached',503);const id=randomBytes(32).toString('hex');sessions.set(hash(id),Date.now()+8*3600000);return cookie(req,id);}
 function admin(req){return session(req)||(!!adminToken&&equal(req.headers.authorization,`Bearer ${adminToken}`));}
 return async(req,res,path)=>{
  const url=new URL(req.url,'http://localhost');
  // Only same-origin browser writes; bearer-authenticated non-browser tools omit Origin.
  if(!['GET','HEAD'].includes(req.method)&&req.headers.origin){
   let origin;try{origin=new URL(req.headers.origin).host;}catch{throw new InputError('Invalid origin',403);}
   if(origin!==req.headers.host)throw new InputError('Cross-origin request rejected',403);
  }
  if(path==='/api/v1/session'&&req.method==='GET'){json(res,200,{authenticated:session(req),publicTracking:process.env.PUBLIC_TRACKING_ENABLED==='true'});return true;}
  if(path==='/api/v1/session'&&req.method==='POST'){
   const ip=req.socket?.remoteAddress??'local';const now=Date.now();for(const [k,v]of attempts)if(now-v.start>600000)attempts.delete(k);
   let a=attempts.get(ip)??{start:now,count:0};attempts.set(ip,a);
   if(++a.count>10)throw new InputError('Too many login attempts; retry in 10 minutes',429);
   const b=await body(req);if(!equal(b.token,adminToken))throw new InputError('Incorrect access key',401);
   attempts.delete(ip);json(res,200,{authenticated:true,publicTracking:process.env.PUBLIC_TRACKING_ENABLED==='true'},{'set-cookie':signIn(req,res)});return true;
  }
  if(path==='/api/v1/session'&&req.method==='DELETE'){
   const m=/(?:^|;\s*)lope_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'');if(m)sessions.delete(hash(m[1]));
   json(res,200,{authenticated:false},{'set-cookie':cookie(req,'',true)});return true;
  }
  if(path==='/api/v1/auth/launch'&&req.method==='POST'){
   if(!equal(req.headers.authorization,`Bearer ${adminToken}`))throw new InputError('Unauthorized',401);
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress))throw new InputError('Local launch only',403);
   for(const [k,v]of launches)if(v<Date.now())launches.delete(k);
   const code=randomBytes(32).toString('hex');launches.set(hash(code),Date.now()+60000);json(res,200,{path:'/auth/local/'+code});return true;
  }
  if(path.startsWith('/auth/local/')&&req.method==='GET'){
   const key=hash(path.slice('/auth/local/'.length)),expires=launches.get(key);launches.delete(key);
   if(!expires||expires<Date.now())throw new InputError('Launch link expired; use your access key',401);
   res.writeHead(302,{location:'/', 'set-cookie':signIn(req,res),'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();return true;
  }
  const tracking = /^\/api\/v1\/public-tracking\/([1-9]\d{0,18})$/.exec(path);
  if (tracking && req.method === 'POST') {
   if (BigInt(tracking[1]) > 9223372036854775807n) throw new InputError('Tracking link unavailable',404);
   const snapshot = await publicTracking(pool, tracking[1], req.headers.authorization);
   if (!snapshot) throw new InputError('Tracking link unavailable',404);
   json(res,200,snapshot);return true;
  }
  const client=/^\/api\/v1\/client\/([a-f0-9]{64})$/.exec(path);
  if(client&&req.method==='GET'){
   const r=await pool.query(`SELECT d.id,d.client_name AS "clientName",d.reference,d.destination,d.status,d.expires_at AS "expiresAt",v.name AS "vehicleName",v.registration,v.last_device_time AS timestamp,ST_X(v.last_point) longitude,ST_Y(v.last_point) latitude,v.last_speed_kmh AS speed FROM tms.deliveries d JOIN tms.vehicles v ON v.id=d.vehicle_id WHERE d.token_hash=$1 AND d.expires_at>now() AND d.status='IN_TRANSIT'`,[hash(client[1])]);
   if(!r.rowCount)throw new InputError('Tracking link expired or unavailable',404);json(res,200,r.rows[0]);return true;
  }
  const dpdPath='/api/reconciliations/dpd';
  const reviewPath=/^\/api\/reconciliations\/dpd\/(\d{1,18})$/.exec(path);
  if(path===dpdPath||path===dpdPath+'/import'||reviewPath){
   if(!admin(req))throw new InputError('Sign in to access DPD reconciliations',401);
   if(path===dpdPath&&req.method==='GET'){json(res,200,await listDpd(pool,url.searchParams));return true;}
   if(path===dpdPath+'/import'&&req.method==='POST'){
    const upload=await readDpdUpload(req);
    json(res,200,await importDpd(pool,upload.bytes,upload.name));return true;
   }
   if(reviewPath&&req.method==='PATCH'){json(res,200,await reviewDpd(pool,reviewPath[1],await body(req)));return true;}
   throw new InputError('Method not allowed',405);
  }
  const protectedPath=path==='/api/v1/fuel-estimates'||path==='/api/v1/telemetry/latest'||path.startsWith('/api/v1/telemetry/history/')||path==='/api/v1/geofences'&&req.method==='GET'||path==='/api/v1/quotes/estimate'||path==='/api/v1/onboarding'||path.startsWith('/api/v1/onboarding/')||path==='/api/v1/deliveries'||path.startsWith('/api/v1/deliveries/');
  if(protectedPath){
   if(!admin(req))throw new InputError('Sign in to access fleet operations',401);
   if(req.method==='GET'&&path==='/api/v1/telemetry/latest'){json(res,200,await latest(pool));return true;}
   if(req.method==='GET'&&path==='/api/v1/geofences'){json(res,200,await zones(pool));return true;}
   const h=/^\/api\/v1\/telemetry\/history\/([A-Za-z0-9_.:-]{1,128})$/.exec(path);
   if(req.method==='GET'&&h){json(res,200,await history(pool,h[1],historyParams(url)));return true;}
   if(path==='/api/v1/fuel-estimates'&&req.method==='GET'){json(res,200,await fuelEstimateMonths(pool));return true;}
   if(path==='/api/v1/quotes/estimate'&&req.method==='POST'){json(res,200,estimateQuote(await body(req)));return true;}
   if(path==='/api/v1/onboarding'&&req.method==='GET'){json(res,200,(await pool.query('SELECT * FROM tms.driver_applications ORDER BY created_at DESC LIMIT 1000')).rows);return true;}
   if(path==='/api/v1/onboarding'&&req.method==='POST'){
    const b=await body(req),capacity=Number(b.capacity_tons);if(![1,4,8,14,24,34].includes(capacity))throw new InputError('Invalid capacity');
    const email=text(b.email,'email',254);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new InputError('Invalid email');
    const r=await pool.query(`INSERT INTO tms.driver_applications(company,contact_name,email,phone,registration,capacity_tons,license_expiry,disk_expiry,roadworthy_expiry) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[text(b.company,'company'),text(b.contact_name,'contact'),email,text(b.phone,'phone',40),text(b.registration,'registration',30),capacity,date(b.license_expiry),date(b.disk_expiry),date(b.roadworthy_expiry)]);json(res,201,r.rows[0]);return true;
   }
   const o=/^\/api\/v1\/onboarding\/(\d+)$/.exec(path);
   if(o&&req.method==='PATCH'){
    const b=await body(req);if(!['APPLIED','REVIEW','APPROVED','HOLD'].includes(b.stage))throw new InputError('Invalid stage');
    const r=await pool.query(`UPDATE tms.driver_applications SET stage=$1,
 license_expiry=coalesce($3::date,license_expiry),disk_expiry=coalesce($4::date,disk_expiry),roadworthy_expiry=coalesce($5::date,roadworthy_expiry),updated_at=now() WHERE id=$2 RETURNING *`,[b.stage,o[1],b.license_expiry==null?null:date(b.license_expiry),b.disk_expiry==null?null:date(b.disk_expiry),b.roadworthy_expiry==null?null:date(b.roadworthy_expiry)]);
    if(!r.rowCount)throw new InputError('Application not found',404);json(res,200,r.rows[0]);return true;
   }
   if(path==='/api/v1/deliveries'&&req.method==='GET'){
    json(res,200,(await pool.query(`SELECT d.id,d.client_name,d.reference,d.destination,d.status,d.expires_at,v.name AS vehicle_name FROM tms.deliveries d JOIN tms.vehicles v ON v.id=d.vehicle_id ORDER BY d.created_at DESC LIMIT 500`)).rows);return true;
   }
   if(path==='/api/v1/deliveries'&&req.method==='POST'){
    const b=await body(req);if(!/^\d+$/.test(String(b.vehicle_id)))throw new InputError('Invalid vehicle');
    if (process.env.PUBLIC_TRACKING_ENABLED === 'true') {
     const token = randomBytes(32).toString('base64url');
     try {
      const { rows: [delivery] } = await pool.query(`
       INSERT INTO tms.deliveries(client_name,reference,vehicle_id,destination,token_hash,expires_at)
       SELECT $1,$2,v.id,$4,$5,NULL FROM tms.vehicles v WHERE v.id=$3
       RETURNING id
      `, [text(b.client_name,'client'),text(b.reference,'reference',100),b.vehicle_id,
          text(b.destination,'destination',200),hash(token)]);
      if (!delivery) throw new InputError('Unknown vehicle');
      const url = 'https://www.lopetransport.co.za/track/tms-' + delivery.id + '#' + token;
      json(res,201,{id:delivery.id,url});return true;
     } catch (error) {
      if (error.constraint === 'deliveries_one_active_public_link_per_vehicle') {
       throw new InputError('Close the existing tracked delivery before assigning this vehicle to another.',409);
      }
      throw error;
     }
    }
    const hours=Number(b.hours??24);if(!Number.isInteger(hours)||hours<1||hours>168)throw new InputError('Expiry must be 1..168 hours');
    if(!(await pool.query('SELECT id FROM tms.vehicles WHERE id=$1',[b.vehicle_id])).rowCount)throw new InputError('Unknown vehicle');
    const token=randomBytes(32).toString('hex');
    const r=await pool.query(`INSERT INTO tms.deliveries(client_name,reference,vehicle_id,destination,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 hour') RETURNING id`,[text(b.client_name,'client'),text(b.reference,'reference',100),b.vehicle_id,text(b.destination,'destination',200),hash(token),hours]);
    json(res,201,{id:r.rows[0].id,path:'/client/'+token});return true;
   }
   const d=/^\/api\/v1\/deliveries\/(\d+)$/.exec(path);
   if(d&&req.method==='PATCH'){
    const b=await body(req);if(!['IN_TRANSIT','DELIVERED','CANCELLED'].includes(b.status))throw new InputError('Invalid status');
    const r=await pool.query(`UPDATE tms.deliveries SET status=$1, delivered_at=CASE WHEN $1='DELIVERED' THEN coalesce(delivered_at,now()) END WHERE id=$2 AND (expires_at IS NOT NULL OR status='IN_TRANSIT' OR status=$1) RETURNING id,status`,[b.status,d[1]]);if(!r.rowCount)throw new InputError('Delivery not found or already closed',404);json(res,200,r.rows[0]);return true;
   }
   throw new InputError('Route or method not found',404);
  }
  const assets={'/':'index.html','/app.js':'app.js','/dpd.js':'dpd.js','/styles.css':'styles.css','/vendor/maplibre-gl.js':'vendor/maplibre-gl.js','/vendor/maplibre-gl.css':'vendor/maplibre-gl.css','/favicon.svg':'favicon.svg','/lope-icon-v4.png':'lope-icon-v4.png','/lope-mark-v4-white.png':'lope-mark-v4-white.png'};
  const file=assets[path]??(/^\/client\/[a-f0-9]{64}$/.test(path)?'index.html':null);
  if(file&&(req.method==='GET'||req.method==='HEAD')){
   const data=await readFile(new URL('../public/'+file,import.meta.url));const ext=file.split('.').at(-1);
   res.writeHead(200,{'content-type':{html:'text/html; charset=utf-8',css:'text/css',js:'text/javascript',svg:'image/svg+xml',png:'image/png'}[ext],
    'cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
    'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://tiles.openfreemap.org; img-src 'self' data: blob: https://tiles.openfreemap.org; font-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(req.method==='HEAD'?undefined:data);return true;
  }
  return false;
 };
}
