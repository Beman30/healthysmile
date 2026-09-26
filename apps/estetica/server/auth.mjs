import {createRemoteJWKSet,jwtVerify} from 'jose';
const keys=new Map();
export async function verifyAccess(request,env,keyResolver){
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN||'')||!env.ACCESS_AUD)throw Object.assign(Error('Accesso studio non ancora configurato.'),{status:503});
 const token=request.headers.get('Cf-Access-Jwt-Assertion')||request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('CF_Authorization='))?.slice('CF_Authorization='.length);if(!token)throw Object.assign(Error('Accedi con il tuo account dello studio.'),{status:401});
 let jwks=keyResolver||keys.get(env.ACCESS_TEAM_DOMAIN);if(!jwks){jwks=createRemoteJWKSet(new URL(env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs'));keys.set(env.ACCESS_TEAM_DOMAIN,jwks);}
 try{const {payload}=await jwtVerify(token,jwks,{issuer:env.ACCESS_TEAM_DOMAIN,audience:env.ACCESS_AUD,algorithms:['RS256'],requiredClaims:['exp','sub','email']});if(typeof payload.email!=='string'||!payload.email.includes('@'))throw Error();return {subject:payload.sub,email:payload.email.toLowerCase()};}
 catch{throw Object.assign(Error('Accesso scaduto o non valido. Accedi nuovamente.'),{status:401});}
}
export async function resolveStudio(request,env,verify=verifyAccess){
 const user=await verify(request,env);if(!env.DB)throw Object.assign(Error('Archivio non ancora configurato.'),{status:503});
 const memberships=await env.DB.prepare('SELECT m.studio_id, m.role, s.name FROM studio_members m JOIN studios s ON s.id=m.studio_id WHERE m.email=? AND m.active=1 AND s.active=1 ORDER BY m.studio_id').bind(user.email).all();
 const wanted=request.headers.get('X-HS-Studio'),row=wanted?memberships.results.find(m=>m.studio_id===wanted):memberships.results.length===1?memberships.results[0]:null;
 if(!row)throw Object.assign(Error(memberships.results.length?'Seleziona lo studio autorizzato.':'Account non abilitato a uno studio.'),{status:403});
 return {studioId:row.studio_id,studioName:row.name,role:row.role,userEmail:user.email,subject:user.subject};
}
