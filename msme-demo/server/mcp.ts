import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { Repository } from './db.ts';
import { equalSecret, verifyAssertion } from './identity.ts';

export interface McpConfig { serviceToken:string; ualPublicKey:string; org:string; bot:string; ualOrigin:string; publicOrigin:string; }
const code=z.string().regex(/^[A-Z0-9-]{3,40}$/);
const paging={limit:z.number().int().min(1).max(50).optional(),cursor:z.number().int().min(0).max(10000).optional()};
export const toolSchemas={
  get_product_stock:z.object({sku:code}).strict(), get_my_profile:z.object({}).strict(),
  list_my_orders:z.object({...paging,status:z.enum(['processing','shipped','delayed','delivered']).optional()}).strict(),
  get_order:z.object({order_number:code}).strict(), get_order_tracking:z.object({order_number:code}).strict(),
  list_my_invoices:z.object({...paging,status:z.enum(['paid','unpaid','partial','overdue']).optional()}).strict(),
  get_invoice:z.object({invoice_number:code}).strict(),
};
export const toolDescriptions:Record<keyof typeof toolSchemas,string>={
  get_product_stock:'Read current public stock by SKU. Quantity is in units; stock may change.',
  get_my_profile:'Read the verified signed-in customer profile. Requires customer authentication; never ask for a customer ID.',
  list_my_orders:'List only the verified customer orders, newest first. Customer identity is supplied securely by the server.',
  get_order:'Read an owned order by order_number, including items, INR amounts in paise and shipment. Foreign/unknown orders return not found.',
  get_order_tracking:'Read the verified customer shipment timeline for order_number.',
  list_my_invoices:'List verified customer invoices with payment status and outstanding INR amounts in paise. Overdue is computed from due date.',
  get_invoice:'Read an owned invoice by invoice_number, its line items and allocated payments. Monetary values are integer paise; not a valid tax invoice.',
};
export function executeTool(repo:Repository,name:keyof typeof toolSchemas,raw:unknown,customerId?:string) {
  const args=toolSchemas[name].parse(raw) as Record<string,any>;
  if(name!=='get_product_stock'&&!customerId)throw new Error('SIGN_IN_REQUIRED: Sign in on the NilaPack website to access your account.');
  switch(name) {
    case 'get_product_stock': {const p=repo.product(args.sku);return p?{sku:p.sku,name:p.name,stock:p.stock,unit:'pieces',moq:p.moq,price_paise:p.price_paise,currency:'INR',as_of:new Date().toISOString()}: {found:false,message:'Product not found.'};}
    case 'get_my_profile': return repo.profile(customerId!)??{found:false,message:'Account not found.'};
    case 'list_my_orders': {const items=repo.orders(customerId!,args.status,args.limit,args.cursor);return{items,currency:'INR',next_cursor:items.length===(args.limit??20)?(args.cursor??0)+items.length:null};}
    case 'get_order': return repo.order(customerId!,args.order_number)??{found:false,message:'Order not found.'};
    case 'get_order_tracking': {const o=repo.order(customerId!,args.order_number);return o?{order_number:o.id,status:o.status,estimated_delivery:o.estimated_delivery,shipment:o.shipment}: {found:false,message:'Order not found.'};}
    case 'list_my_invoices': {const items=repo.invoices(customerId!,args.status,args.limit,args.cursor);return{items,currency:'INR',next_cursor:items.length===(args.limit??20)?(args.cursor??0)+items.length:null};}
    case 'get_invoice': return repo.invoice(customerId!,args.invoice_number)??{found:false,message:'Invoice not found.'};
  }
}
export function createBusinessMcp(repo:Repository,auditDb:DatabaseSync,customerId?:string) {
  const server=new McpServer({name:'nilapack-business-mcp',version:'1.0.0'},{maxToolInputElements:100});
  for(const name of Object.keys(toolSchemas) as Array<keyof typeof toolSchemas>) {
    server.registerTool(name,{description:toolDescriptions[name],inputSchema:toolSchemas[name],annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async (args:Record<string,unknown>)=>{
      let outcome='ok';
      try {const result=executeTool(repo,name,args,customerId);return{content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};}
      catch(e) {outcome='denied';return{isError:true,content:[{type:'text' as const,text:e instanceof z.ZodError?'Invalid tool arguments.':e instanceof Error?e.message:'Tool lookup failed.'}]};}
      finally {auditDb.prepare('INSERT INTO tool_audit_events(customer_id,tool,outcome,occurred_at) VALUES(?,?,?,?)').run(customerId??null,name,outcome,new Date().toISOString());}
    });
  }
  return server;
}
export function registerMcp(app:Express,repo:Repository,auditDb:DatabaseSync,config:McpConfig) {
  app.all('/mcp',async(req,res)=>{
    if(!config.serviceToken){res.status(503).json({error:'MCP integration is not configured.'});return;}
    if(req.headers.origin && req.headers.origin!==config.publicOrigin && req.headers.origin!==config.ualOrigin){res.status(403).json({error:'Origin not allowed.'});return;}
    if(!equalSecret(String(req.headers.authorization??''),`Bearer ${config.serviceToken}`)){res.status(401).json({error:'Service authentication required.'});return;}
    if(req.method!=='POST'){res.setHeader('Allow','POST');res.status(405).end();return;}
    let customerId:string|undefined;
    const assertion=req.headers['x-ual-customer-assertion'];
    if(assertion) {
      try {
        const claims=verifyAssertion(String(assertion),config.ualPublicKey,{issuer:config.ualOrigin,audience:`${config.publicOrigin}/mcp`,org:config.org,bot:config.bot});
        const session=auditDb.prepare('SELECT customer_id FROM web_sessions WHERE token_hash=? AND customer_id=? AND expires_at>?').get(claims.sid,claims.sub,Date.now());
        if(!session)throw new Error('Website session expired.');
        customerId=claims.sub;
      }
      catch {res.status(401).json({error:'Invalid or expired customer context.'});return;}
    }
    const server=createBusinessMcp(repo,auditDb,customerId);
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void server.close();});
    try {await server.connect(transport);await transport.handleRequest(req,res,req.body);}
    catch {if(!res.headersSent)res.status(500).json({error:'MCP request failed.'});}
  });
}
