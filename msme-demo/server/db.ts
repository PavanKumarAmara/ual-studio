import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { products } from '../content/company.ts';

export const DEMO_PASSWORD = 'PackWithCare!2026'; // Synthetic accounts only; never used for integrations.
export function hashPassword(password: string) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  const derived = scryptSync(password, salt || 'invalid', 64);
  const expected = Buffer.from(hex || '', 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
export function openDatabase(filename = process.env.DATABASE_PATH || './data/nilapack.sqlite', readOnly = false) {
  if (filename !== ':memory:' && !readOnly) mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename, { readOnly });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (!readOnly) db.exec('PRAGMA journal_mode=WAL;');
  else db.exec('PRAGMA query_only=ON;');
  return db;
}
export function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, company_name TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL, payment_terms TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_users (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS web_sessions (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS products (sku TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, dimensions TEXT NOT NULL, material TEXT NOT NULL, moq INTEGER NOT NULL CHECK(moq>0), price_paise INTEGER NOT NULL CHECK(price_paise>=0), stock INTEGER NOT NULL CHECK(stock>=0), style TEXT NOT NULL, tag TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('processing','shipped','delayed','delivered')), subtotal_paise INTEGER NOT NULL CHECK(subtotal_paise>=0), tax_paise INTEGER NOT NULL CHECK(tax_paise>=0), shipping_paise INTEGER NOT NULL CHECK(shipping_paise>=0), total_paise INTEGER NOT NULL CHECK(total_paise=subtotal_paise+tax_paise+shipping_paise), estimated_delivery TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), sku TEXT NOT NULL REFERENCES products(sku), name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise>=0), total_paise INTEGER NOT NULL CHECK(total_paise=quantity*unit_price_paise));
    CREATE TABLE IF NOT EXISTS shipments (id TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL REFERENCES orders(id), carrier TEXT NOT NULL, tracking_number TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shipment_events (id INTEGER PRIMARY KEY, shipment_id TEXT NOT NULL REFERENCES shipments(id), occurred_at TEXT NOT NULL, description TEXT NOT NULL, location TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL REFERENCES orders(id), customer_id TEXT NOT NULL REFERENCES customers(id), issued_at TEXT NOT NULL, due_at TEXT NOT NULL, subtotal_paise INTEGER NOT NULL, tax_paise INTEGER NOT NULL, shipping_paise INTEGER NOT NULL, total_paise INTEGER NOT NULL CHECK(total_paise=subtotal_paise+tax_paise+shipping_paise));
    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id, issued_at DESC);
    CREATE TABLE IF NOT EXISTS invoice_items (id INTEGER PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), sku TEXT NOT NULL, name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise>=0), total_paise INTEGER NOT NULL CHECK(total_paise=quantity*unit_price_paise));
    CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), amount_paise INTEGER NOT NULL CHECK(amount_paise>0), paid_at TEXT NOT NULL, method TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tool_audit_events (id INTEGER PRIMARY KEY, customer_id TEXT, tool TEXT NOT NULL, outcome TEXT NOT NULL, occurred_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_sessions (website_session_hash TEXT NOT NULL REFERENCES web_sessions(token_hash) ON DELETE CASCADE, ual_session_id TEXT PRIMARY KEY);
    INSERT OR IGNORE INTO schema_migrations VALUES(1, datetime('now'));
  `);
}
export function seed(db: DatabaseSync) {
  if (db.prepare('SELECT COUNT(*) AS n FROM customers').get()?.n) return false;
  const accounts = [
    ['Aarohi Naturals', 'Ananya Rao', 'ananya@aarohi.example', 'Bengaluru'],
    ['Sunday Bakehouse', 'Rohan Shah', 'rohan@sunday.example', 'Mysuru'],
    ['Small Stories Studio', 'Meera Iyer', 'meera@stories.example', 'Chennai'],
    ['The Green Pantry', 'Kabir Nair', 'kabir@pantry.example', 'Hyderabad'],
    ['Everyday Objects', 'Isha Menon', 'isha@objects.example', 'Pune'],
    ['Little Leaf Retail', 'Dev Patel', 'dev@littleleaf.example', 'Mumbai'],
  ];
  const date = (day: number) => new Date(Date.UTC(2026, 10, day, 10)).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const p of products) db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(p.sku,p.name,p.category,p.description,p.dimensions,p.material,p.moq,p.price_paise,p.stock,p.style,p.tag);
    accounts.forEach(([business,name,email,city], ci) => {
      const cid = `CUS-${1001+ci}`;
      db.prepare('INSERT INTO customers VALUES(?,?,?,?,?,?,?)').run(cid,business,name,email,city,`${12+ci}, Sample Commerce Street, ${city} (fictional)`,ci%2 ? 'Net 15' : 'Net 30');
      db.prepare('INSERT INTO customer_users VALUES(?,?,?,?)').run(`USR-${ci+1}`,cid,email,hashPassword(DEMO_PASSWORD));
      for (let oi=0;oi<4;oi++) {
        const num=ci*4+oi+1, oid=`NP-2026-${String(num).padStart(4,'0')}`;
        const items=[products[(ci+oi)%products.length],products[(ci+oi+3)%products.length]];
        const sub=items.reduce((s,p)=>s+p.price_paise*p.moq,0),tax=Math.round(sub*18/100),ship=15000,total=sub+tax+ship;
        const status=['delivered','shipped','delayed','processing'][oi];
        db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?)').run(oid,cid,date(2+oi*4),status,sub,tax,ship,total,date(9+oi*4));
        for(const p of items) db.prepare('INSERT INTO order_items(order_id,sku,name,quantity,unit_price_paise,total_paise) VALUES(?,?,?,?,?,?)').run(oid,p.sku,p.name,p.moq,p.price_paise,p.moq*p.price_paise);
        if(oi<3) {
          const sid=`SHP-${num}`;
          db.prepare('INSERT INTO shipments VALUES(?,?,?,?)').run(sid,oid,'NilaPack Demo Courier',`NPK${880000+num}`);
          const ev = [['Order confirmed','Bengaluru'],['Packed and quality checked','Peenya fulfilment centre'],['Dispatched','Bengaluru hub'],[oi===0?'Delivered':oi===2?'Transit delayed — hub backlog':'In transit',city]];
          ev.forEach(([label,loc],i)=>db.prepare('INSERT INTO shipment_events(shipment_id,occurred_at,description,location) VALUES(?,?,?,?)').run(sid,date(2+oi*4+i),label,loc));
          const iid=`INV-2026-${String(ci*3+oi+1).padStart(4,'0')}`;
          db.prepare('INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?)').run(iid,oid,cid,date(2+oi*4),date(oi===2?15:25+oi),sub,tax,ship,total);
          for(const p of items) db.prepare('INSERT INTO invoice_items(invoice_id,sku,name,quantity,unit_price_paise,total_paise) VALUES(?,?,?,?,?,?)').run(iid,p.sku,p.name,p.moq,p.price_paise,p.moq*p.price_paise);
          if(oi<2) db.prepare('INSERT INTO payments VALUES(?,?,?,?,?)').run(`PAY-${num}`,iid,oi===0?total:Math.floor(total/2),date(7+oi*4),'Demo bank transfer');
        }
      }
    });
    db.exec('COMMIT'); return true;
  } catch(e) {db.exec('ROLLBACK');throw e;}
}
export type Row = Record<string, any>;
export class Repository {
  constructor(readonly db: DatabaseSync) {}
  products() {return this.db.prepare('SELECT * FROM products ORDER BY rowid').all() as Row[];}
  product(sku: string) {return this.db.prepare('SELECT * FROM products WHERE sku=?').get(sku) as Row|undefined;}
  profile(cid: string) {return this.db.prepare('SELECT id,company_name,contact_name,email,city,address,payment_terms FROM customers WHERE id=?').get(cid) as Row|undefined;}
  orders(cid: string, status?: string, limit=20, cursor=0) {return this.db.prepare('SELECT * FROM orders WHERE customer_id=? AND (? IS NULL OR status=?) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(cid,status??null,status??null,Math.min(50,limit),cursor) as Row[];}
  order(cid: string, id: string): Row | null {
    const order=this.db.prepare('SELECT * FROM orders WHERE customer_id=? AND id=?').get(cid,id) as Row|undefined;
    if(!order) return null;
    const items=this.db.prepare('SELECT sku,name,quantity,unit_price_paise,total_paise FROM order_items WHERE order_id=?').all(id);
    const shipment=this.db.prepare('SELECT id,carrier,tracking_number FROM shipments WHERE order_id=?').get(id);
    const events=shipment?this.db.prepare('SELECT occurred_at,description,location FROM shipment_events WHERE shipment_id=? ORDER BY occurred_at').all(shipment.id):[];
    return {...order,currency:'INR',items,shipment:shipment?{...shipment,events}:null};
  }
  invoices(cid: string, status?: string, limit=20, cursor=0, now=new Date().toISOString()): Row[] {
    const rows=this.db.prepare(`SELECT i.*, COALESCE(SUM(p.amount_paise),0) AS paid_paise, i.total_paise-COALESCE(SUM(p.amount_paise),0) AS balance_paise FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id WHERE i.customer_id=? GROUP BY i.id ORDER BY i.issued_at DESC,i.id DESC`).all(cid) as Row[];
    return rows.map(r=>({...r,currency:'INR',status:r.balance_paise===0?'paid':r.due_at<now?'overdue':r.paid_paise>0?'partial':'unpaid'})).filter(r=>!status||r.status===status).slice(cursor,cursor+Math.min(50,limit));
  }
  invoice(cid: string, id: string): Row | null {
    const invoice=this.invoices(cid,undefined,50).find(r=>r.id===id);
    if(!invoice)return null;
    return {...invoice,items:this.db.prepare('SELECT sku,name,quantity,unit_price_paise,total_paise FROM invoice_items WHERE invoice_id=?').all(id),payments:this.db.prepare('SELECT id,amount_paise,paid_at,method FROM payments WHERE invoice_id=? ORDER BY paid_at').all(id),notice:'Illustrative demo invoice — not valid for tax or payment.'};
  }
}
