import pg from 'pg';
import {readFile} from 'node:fs/promises';
const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL});
await db.connect();
try{await db.query("SELECT pg_advisory_lock(4174001)");await db.query(await readFile(new URL('../migrations/002_portal.sql',import.meta.url),'utf8'));await db.query(await readFile(new URL('../migrations/006_public_tracking.sql',import.meta.url),'utf8'));console.log('Portal migrations applied.');}
finally{await db.end();}
