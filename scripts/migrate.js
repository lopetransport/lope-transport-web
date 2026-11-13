import pg from 'pg';
import {readFile} from 'node:fs/promises';
const db=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL});
await db.connect();
try {
  await db.query("SELECT pg_advisory_lock(4174001)");
  for(const file of ['schema.sql','functions.sql','migrations/002_portal.sql','migrations/003_historical_operations.sql','migrations/004_historical_fuel_estimates.sql','migrations/005_dpd_audit.sql','migrations/006_public_tracking.sql']) {await db.query(await readFile(new URL('../'+file,import.meta.url),'utf8'));console.log('Applied '+file);}
}finally{await db.end();}

