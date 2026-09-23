const TOKEN=/^[a-f0-9]{48}$/;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'};
const json=(value,status=200)=>Response.json(value,{status,headers});
async function readBounded(request){const reader=request.body?.getReader();if(!reader)throw Error('empty');const parts=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>10*1024*1024){await reader.cancel();throw Error('large');}parts.push(value);}if(length<32)throw Error('empty');const out=new Uint8Array(length);let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;}
export async function shareAPI(request,env,identity){
 const url=new URL(request.url),id=url.pathname.slice('/api/shares/'.length),method=request.method,root=url.pathname==='/api/shares';
 if(!env.BUCKET)return json({error:'Condivisione temporaneamente non disponibile.'},503);
 try{
  // Anonymous access is restricted to one unguessable, expiring encrypted object.
  if(!root&&method==='GET'&&TOKEN.test(id)){
   const object=await env.BUCKET.get('shares/'+id);if(!object)return json({error:'Link non disponibile o revocato.'},404);
   if(!Number.isFinite(Number(object.customMetadata?.expires))||Number(object.customMetadata.expires)<=Date.now()){await env.BUCKET.delete('shares/'+id);return json({error:'Questo link è scaduto.'},410);}
   return new Response(object.body,{headers:{...headers,'Content-Type':'application/octet-stream'}});
  }
  if(!identity?.studioId)return json({error:'Accesso riservato allo studio.'},403);
  if(method!=='GET'&&(request.headers.get('X-HS-Write')!=='1'||request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')!==url.origin))return json({error:'Richiesta non autorizzata.'},403);
  if(root&&method==='GET'){
   const list=await env.BUCKET.list({prefix:'shares/',limit:1000,cursor:url.searchParams.get('cursor')||undefined,include:['customMetadata']});
   const links=[];for(const item of list.objects){if(item.customMetadata?.owner!==identity.studioId)continue;const expires=Number(item.customMetadata.expires);if(expires>Date.now())links.push({id:item.key.slice(7),expires,created:Number(item.customMetadata.created)});}
   return json({links:links.sort((a,b)=>b.created-a.created),cursor:list.truncated?list.cursor:null});
  }
  if(root&&method==='POST'){
   if(request.headers.get('Content-Type')!=='application/octet-stream')return json({error:'Formato non valido.'},415);
   const bytes=await readBounded(request),token=[...crypto.getRandomValues(new Uint8Array(24))].map(n=>n.toString(16).padStart(2,'0')).join(''),created=Date.now(),expires=created+30*24*60*60*1000;
   await env.BUCKET.put('shares/'+token,bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{owner:identity.studioId,created:String(created),expires:String(expires)}});return json({id:token,expires,created},201);
  }
  if(!root&&method==='DELETE'&&TOKEN.test(id)){
   const object=await env.BUCKET.head('shares/'+id);if(object&&object.customMetadata?.owner!==identity.studioId)return json({error:'Accesso non consentito.'},403);
   await env.BUCKET.delete('shares/'+id);return json({deleted:true});
  }
  return json({error:'Non trovato.'},404);
 }catch(e){return json({error:e.message==='large'?'Confronto troppo grande.':e.message==='empty'?'Confronto non valido.':'Condivisione non riuscita. Riprova.'},e.message==='large'?413:e.message==='empty'?400:503);}
}
