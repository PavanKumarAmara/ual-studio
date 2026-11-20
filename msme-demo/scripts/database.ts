import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { openDatabase, migrate, seed } from '../server/db.ts';
import { company, policies } from '../content/company.ts';
const action=process.argv[2];
if(action==='docs') {
  mkdirSync('knowledge-pack',{recursive:true});
  const manifest=policies.map(p=>{
    const file=`${p.slug}.txt`;
    writeFileSync(`knowledge-pack/${file}`,`${company.name}\n${p.subtitle}\nVersion: 2026-11-20\nPublic company knowledge — fictional demo business.\n\n${p.text}\n`);
    return{file,title:p.subtitle,version:'2026-11-20',website_path:`/help/${p.slug}`,visibility:'company-public'};
  });
  writeFileSync('knowledge-pack/manifest.json',JSON.stringify(manifest,null,2));
  console.log('Exported six company-public documents. Nothing has been uploaded to Google Drive.');
} else {
  const db=openDatabase();migrate(db);
  if(action==='seed')console.log(seed(db)?'Seeded 6 customers, 12 products, 24 orders and 18 invoices.':'Existing data kept; no duplicate seed records.');
  else if(action==='update-order') {
    const [id,status]=process.argv.slice(3);
    if(!/^NP-2026-\d{4}$/.test(id??'')||!['processing','shipped','delayed','delivered'].includes(status??''))throw new Error('Usage: npm run demo:update-order -- NP-2026-0004 shipped');
    db.exec('BEGIN IMMEDIATE');
    try {
      const result=db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,id);
      if(!result.changes)throw new Error('Order not found.');
      let shipment=db.prepare('SELECT id FROM shipments WHERE order_id=?').get(id);
      if(!shipment&&status!=='processing') {const sid=`SHP-${id}`;db.prepare('INSERT INTO shipments VALUES(?,?,?,?)').run(sid,id,'NilaPack Demo Courier',`DEMO-${id}`);shipment={id:sid};}
      if(shipment)db.prepare('INSERT INTO shipment_events(shipment_id,occurred_at,description,location) VALUES(?,?,?,?)').run(shipment.id,new Date().toISOString(),`Operator demo update: ${status}`,'Demo operations');
      db.exec('COMMIT');console.log(`Updated ${id} to ${status}.`);
    }catch(e){db.exec('ROLLBACK');throw e;}
  } else if(action!=='migrate')throw new Error('Expected migrate, seed, docs or update-order.');
  db.close();
}
