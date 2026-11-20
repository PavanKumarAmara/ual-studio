import 'dotenv/config';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp, loadConfig, publicContent } from './app.ts';
import { openDatabase, migrate, seed } from './db.ts';
const db=openDatabase();migrate(db);seed(db);
const readDb=openDatabase(process.env.DATABASE_PATH||'./data/nilapack.sqlite',true);
const config=loadConfig();
const app=createApp(db,readDb,config);
const production=process.argv.includes('--production')||process.env.NODE_ENV==='production';
if(production) {
  app.use(express.static(resolve('dist'),{index:false}));
  app.get('*',async(req,res,next)=>{try{const template=await readFile(resolve('dist/index.html'),'utf8');res.type('html').send(template.replace('<!--PUBLIC_CONTENT-->',publicContent(req.path)));}catch(error){next(error);}});
} else {
  const {createServer}=await import('vite');
  const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
  app.use(vite.middlewares);
  app.get('*',async(req,res,next)=>{try{const template=await readFile(resolve('index.html'),'utf8');res.type('html').send(await vite.transformIndexHtml(req.originalUrl,template.replace('<!--PUBLIC_CONTENT-->',publicContent(req.path))));}catch(e){next(e);}});
}
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  // Parser errors may contain submitted credentials; log only the error type.
  console.error('NilaPack request failed:',err instanceof Error?err.name:'unknown error');
  if(!res.headersSent)res.status(500).json({error:'Unable to complete the request. Please try again.'});
});
const server=app.listen(Number(process.env.PORT||3102),process.env.HOST||'127.0.0.1',()=>console.log(`NilaPack website: ${config.publicOrigin} | MCP: ${config.publicOrigin}/mcp | synthetic demo data`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{app.locals.support?.close();server.close(()=>{readDb.close();db.close();process.exit(0);});server.closeIdleConnections();});
