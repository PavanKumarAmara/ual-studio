import { createHash, randomBytes, sign, verify, timingSafeEqual } from 'node:crypto';
export type CustomerClaims = { iss:string; aud:string; sub:string; org:string; bot:string; sid:string; scope:string[]; iat:number; exp:number; jti:string };
export const digest = (value:string) => createHash('sha256').update(value).digest('hex');
export const opaqueToken = () => randomBytes(32).toString('base64url');
export function equalSecret(a:string,b:string) {const x=Buffer.from(a),y=Buffer.from(b);return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);}
export function issueAssertion(claims:Omit<CustomerClaims,'iat'|'exp'|'jti'>,privateKey:string,ttl=60) {
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({...claims,iat:now,exp:now+Math.min(60,ttl),jti:opaqueToken()})).toString('base64url');
  const input=`${header}.${payload}`;
  return `${input}.${sign(null,Buffer.from(input),privateKey.replace(/\\n/g,'\n')).toString('base64url')}`;
}
export function verifyAssertion(token:string,publicKey:string,expected:{issuer:string;audience:string;org:string;bot:string},now=Math.floor(Date.now()/1000)):CustomerClaims {
  try {
    if(token.length>8000)throw new Error();
    const parts=token.split('.');if(parts.length!==3)throw new Error();
    const [head,body,sig]=parts;
    const header=JSON.parse(Buffer.from(head,'base64url').toString());
    if(header.alg!=='EdDSA'||header.typ!=='JWT'||!verify(null,Buffer.from(`${head}.${body}`),publicKey.replace(/\\n/g,'\n'),Buffer.from(sig,'base64url')))throw new Error();
    const c=JSON.parse(Buffer.from(body,'base64url').toString()) as CustomerClaims;
    if(c.iss!==expected.issuer||c.aud!==expected.audience||c.org!==expected.org||c.bot!==expected.bot||!Number.isInteger(c.exp)||!Number.isInteger(c.iat)||c.exp<=now||c.iat>now+5||c.exp-c.iat>60||c.exp<=c.iat||typeof c.sub!=='string'||!/^CUS-\d{4}$/.test(c.sub)||typeof c.sid!=='string'||!c.sid||typeof c.jti!=='string'||c.jti.length<20||!Array.isArray(c.scope)||!c.scope.includes('customer:read'))throw new Error();
    return c;
  } catch {throw new Error('Invalid or expired customer assertion.');}
}
