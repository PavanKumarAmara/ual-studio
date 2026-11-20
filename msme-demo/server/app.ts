import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Repository, verifyPassword, hashPassword } from './db.ts';
import { digest, opaqueToken, issueAssertion } from './identity.ts';
import { registerMcp } from './mcp.ts';
import { registerSupport } from './support.ts';
import { company, policies } from '../content/company.ts';

export interface Config { publicOrigin:string;ualOrigin:string;org:string;bot:string;serviceToken:string;integrationToken:string;privateKey:string;ualPublicKey:string;embedPath:string;demoMode:boolean; }
export function loadConfig():Config {
  const file=resolve('data/integration.json');
  const local=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
  return {publicOrigin:process.env.PUBLIC_ORIGIN||local.publicOrigin||'http://localhost:3102',ualOrigin:process.env.UAL_ORIGIN||local.ualOrigin||'http://localhost:3201',org:process.env.UAL_ORG_SLUG||local.org||'nilapack-supplies',bot:process.env.UAL_BOT_SLUG||local.bot||'customer-support',serviceToken:process.env.MCP_SERVICE_TOKEN||local.serviceToken||'',integrationToken:process.env.UAL_INTEGRATION_TOKEN||local.integrationToken||'',privateKey:process.env.NILAPACK_SIGNING_PRIVATE_KEY||local.privateKey||'',ualPublicKey:process.env.UAL_SIGNING_PUBLIC_KEY||local.ualPublicKey||'',embedPath:process.env.UAL_EMBED_PATH||local.embedPath||'',demoMode:process.env.DEMO_MODE!=='false' && process.env.NODE_ENV!=='production'};
}
const asyncRoute=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>{fn(req,res).catch(next);};
export function createApp(db:DatabaseSync,readDb:DatabaseSync,config:Config):Express {
  const app=express(),repo=new Repository(db),attempts=new Map<string,{count:number;reset:number}>();
  app.disable('x-powered-by');
  app.use(express.json({limit:'64kb',inflate:false}));
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',`frame-ancestors 'self'; object-src 'none'; base-uri 'self'`);
    if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');
    const host=req.hostname;
    if(![new URL(config.publicOrigin).hostname,'127.0.0.1','localhost'].includes(host)){res.status(403).json({error:'Host not allowed.'});return;}
    const key=`${req.ip}:${req.path==='/api/auth/login'?'login':'general'}`;
    const now=Date.now();let bucket=attempts.get(key);
    if(!bucket||bucket.reset<now){bucket={count:0,reset:now+60000};attempts.set(key,bucket);}
    if(++bucket.count>(req.path==='/api/auth/login'?15:180)){res.status(429).json({error:'Too many requests. Please wait a minute.'});return;}
    if(attempts.size>1000)for(const [k,b] of attempts)if(b.reset<now)attempts.delete(k);
    if(req.method==='POST'&&req.path.startsWith('/api/')&&req.headers.origin!==config.publicOrigin){res.status(403).json({error:'Request must come from the NilaPack website.'});return;}
    next();
  });
  function currentSession(req:Request) {
    const token=String(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('np_session='))?.slice(11);
    if(!token)return null;
    const hash=digest(token);const s=db.prepare('SELECT customer_id,expires_at FROM web_sessions WHERE token_hash=? AND expires_at>?').get(hash,Date.now());
    return s?{customerId:String(s.customer_id),hash}:null;
  }
  function requireCustomer(req:Request,res:Response,next:NextFunction) {const session=currentSession(req);if(!session){res.status(401).json({error:'Please sign in to your NilaPack account.'});return;}res.locals.session=session;next();}
  const cookie=(token:string,age:number)=>`np_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${config.publicOrigin.startsWith('https:')?'; Secure':''}`;
  app.get('/api/health',(_req,res)=>res.json({ok:true,service:'nilapack',database:'sqlite',mcpConfigured:Boolean(config.serviceToken)}));
  app.get('/api/catalog',(_req,res)=>res.json({products:repo.products()}));
  app.get('/api/catalog/:sku',(req,res)=>{const p=repo.product(req.params.sku);res.status(p?200:404).json(p??{error:'Product not found.'});});
  app.get('/api/site-config',(_req,res)=>res.json({demoMode:config.demoMode,embedScriptUrl:config.embedPath?`${config.ualOrigin}${config.embedPath}`:null,ualOrigin:config.ualOrigin,org:config.org,bot:config.bot}));
  app.post('/api/auth/login',(req,res)=>{
    const {email,password}=req.body??{};
    if(typeof email!=='string'||typeof password!=='string'||email.length>180||password.length>128){res.status(400).json({error:'Enter a valid email and password.'});return;}
    const user=db.prepare('SELECT customer_id,password_hash FROM customer_users WHERE email=?').get(email.toLowerCase().trim());
    const valid=verifyPassword(password,user?String(user.password_hash):hashPassword('unavailable'));
    if(!user||!valid){res.status(401).json({error:'Email or password is incorrect.'});return;}
    const old=currentSession(req);if(old)db.prepare('DELETE FROM web_sessions WHERE token_hash=?').run(old.hash);
    const token=opaqueToken();db.prepare('INSERT INTO web_sessions VALUES(?,?,?)').run(digest(token),user.customer_id,Date.now()+8*60*60*1000);
    res.setHeader('Set-Cookie',cookie(token,8*60*60));res.json({customer:repo.profile(String(user.customer_id))});
  });
  app.post('/api/auth/logout',asyncRoute(async(req,res)=>{
    const session=currentSession(req);
    if(session){
      const sessions=db.prepare('SELECT ual_session_id FROM chat_sessions WHERE website_session_hash=?').all(session.hash);
      // Remove the website session first: MCP verifies it, so logout fails closed even if UAL is offline.
      db.prepare('DELETE FROM web_sessions WHERE token_hash=?').run(session.hash);
      await Promise.all(sessions.map(s=>fetch(`${config.ualOrigin}/api/v1/orgs/${config.org}/bots/${config.bot}/sessions/revoke`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.integrationToken}`},body:JSON.stringify({sessionId:s.ual_session_id}),signal:AbortSignal.timeout(3000)}).catch(()=>undefined)));
    }
    res.setHeader('Set-Cookie',cookie('',0));res.json({ok:true});
  }));
  app.get('/api/account',requireCustomer,(_req,res)=>{const {customerId}=res.locals.session;res.json({customer:repo.profile(customerId),orders:repo.orders(customerId),invoices:repo.invoices(customerId)});});
  app.get('/api/account/orders/:id',requireCustomer,(req,res)=>{const x=repo.order(res.locals.session.customerId,req.params.id);res.status(x?200:404).json(x??{error:'Order not found.'});});
  app.get('/api/account/invoices/:id',requireCustomer,(req,res)=>{const x=repo.invoice(res.locals.session.customerId,req.params.id);res.status(x?200:404).json(x??{error:'Invoice not found.'});});
  app.post('/api/chat/session',asyncRoute(async(req,res)=>{
    if(!config.integrationToken||!config.privateKey){res.status(503).json({error:'UAL support is not connected yet.'});return;}
    const customer=currentSession(req);
    const assertion=customer?issueAssertion({iss:config.publicOrigin,aud:config.ualOrigin,sub:customer.customerId,org:config.org,bot:config.bot,sid:customer.hash,scope:['customer:read']},config.privateKey):undefined;
    const response=await fetch(`${config.ualOrigin}/api/v1/orgs/${config.org}/bots/${config.bot}/sessions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.integrationToken}`},body:JSON.stringify({assertion,websiteOrigin:config.publicOrigin}),signal:AbortSignal.timeout(10000)});
    if(!response.ok){res.status(503).json({error:'Support is not ready. Please try again shortly.'});return;}
    const result=await response.json();
    if(customer&&result.sessionId)db.prepare('INSERT OR IGNORE INTO chat_sessions VALUES(?,?)').run(customer.hash,result.sessionId);
    res.json({token:result.token,expiresAt:result.expiresAt,authenticated:Boolean(customer)});
  }));
  app.locals.support = registerSupport(app, config.publicOrigin);
  registerMcp(app,new Repository(readDb),db,{serviceToken:config.serviceToken,ualPublicKey:config.ualPublicKey,org:config.org,bot:config.bot,ualOrigin:config.ualOrigin,publicOrigin:config.publicOrigin});
  app.get('/robots.txt',(_req,res)=>res.type('text').send('User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /signin\nDisallow: /api/\nDisallow: /mcp\n'));
  app.get('/sitemap.xml',(_req,res)=>res.type('xml').send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/','/catalog','/about','/help',...policies.map(p=>`/help/${p.slug}`)].map(p=>`<url><loc>${config.publicOrigin}${p}</loc></url>`).join('')}</urlset>`));
  return app;
}
const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function publicContent(pathname:string) {
  const p=policies.find(p=>pathname===`/help/${p.slug}`);
  if(pathname.startsWith('/account')||pathname==='/signin')return '';
  return `<main><h1>${escapeHtml(p?p.subtitle:company.name)}</h1><p>${escapeHtml(p?p.text:company.tagline)}</p>${p?'':policies.map(p=>`<article><h2><a href="/help/${p.slug}">${escapeHtml(p.subtitle)}</a></h2><p>${escapeHtml(p.text)}</p></article>`).join('')}<p>${escapeHtml(company.disclosure)}</p></main>`;
}
