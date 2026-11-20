import {generateKeyPairSync,randomBytes}from'node:crypto';
import{mkdirSync,existsSync,readFileSync,writeFileSync}from'node:fs';
import{resolve}from'node:path';
const niladir=resolve('data'),ualdir=resolve('../ual-studio/.data');
mkdirSync(niladir,{recursive:true});mkdirSync(ualdir,{recursive:true});
const nf=resolve(niladir,'integration.json'),uf=resolve(ualdir,'nilapack-integration.json');
if(existsSync(nf)||existsSync(uf)){
  if(!existsSync(nf)||!existsSync(uf))throw new Error('Partial integration configuration exists. Review it before creating replacement credentials.');
  const originArg=process.argv.find(a=>a.startsWith('--ual-origin='));
  if(originArg){const origin=new URL(originArg.slice('--ual-origin='.length));if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/')throw new Error('Supply a valid UAL origin only.');for(const file of[nf,uf]){const cfg=JSON.parse(readFileSync(file,'utf8'));cfg.ualOrigin=origin.origin;writeFileSync(file,JSON.stringify(cfg,null,2),{mode:0o600});}console.log('UAL origin updated in both private configurations; credentials preserved.');}
  const websiteArg=process.argv.find(a=>a.startsWith('--website-origin='));
  if(websiteArg){const origin=new URL(websiteArg.slice('--website-origin='.length));if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/')throw new Error('Supply a valid website origin only.');for(const file of[nf,uf]){const cfg=JSON.parse(readFileSync(file,'utf8'));cfg.publicOrigin=origin.origin;if(file===uf)cfg.mcpEndpoint=`${origin.origin}/mcp`;writeFileSync(file,JSON.stringify(cfg,null,2),{mode:0o600});}console.log('Website origin and MCP endpoint updated; credentials preserved.');}
  if(process.argv.includes('--enable-widget')){const cfg=JSON.parse(readFileSync(nf,'utf8'));cfg.embedPath=`/embed/${cfg.org}/${cfg.bot}.js`;writeFileSync(nf,JSON.stringify(cfg,null,2),{mode:0o600});console.log('Widget enabled. Restart NilaPack; the bot must already be published in UAL.');}
  else console.log('Existing integration credentials preserved. No secrets printed.');
}else{
  const pair=()=>generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  const nila=pair(),ual=pair();const common={publicOrigin:'http://localhost:3102',ualOrigin:'http://localhost:3201',org:'nilapack-supplies',bot:'customer-support',serviceToken:randomBytes(32).toString('base64url'),integrationToken:randomBytes(32).toString('base64url')};
  writeFileSync(nf,JSON.stringify({...common,privateKey:nila.privateKey,ualPublicKey:ual.publicKey,embedPath:''},null,2),{mode:0o600,flag:'wx'});
  writeFileSync(uf,JSON.stringify({...common,mcpEndpoint:'http://localhost:3102/mcp',nilapackPublicKey:nila.publicKey,privateKey:ual.privateKey},null,2),{mode:0o600,flag:'wx'});
  console.log('Local integration keys generated in ignored private configuration files. No secrets printed.');
  console.log('After connecting and publishing the bot in UAL, run: npm run integration:setup -- --enable-widget');
}
