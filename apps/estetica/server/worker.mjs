import {resolveStudio} from './auth.mjs';
import {api} from './api.mjs';
import {shareAPI} from './sharing.mjs';
const baseHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'};
export async function handle(request,env,resolve=resolveStudio){
 const url=new URL(request.url),path=url.pathname,publicViewer=/^\/s\/[a-f0-9]{48}$/.test(path),publicAsset=['/viewer.js','/viewer.css'].includes(path),publicImage=request.method==='GET'&&/^\/api\/shares\/[a-f0-9]{48}$/.test(path);
 let identity=null;
 try{
  if(!publicViewer&&!publicAsset&&!publicImage)identity=await resolve(request,env);
  if(path==='/api/session')return Response.json({studio:{id:identity.studioId,name:identity.studioName},role:identity.role},{headers:baseHeaders});
  if(path==='/api/shares'||path.startsWith('/api/shares/'))return shareAPI(request,env,identity);
  if(path.startsWith('/api/'))return api(request,env,identity);
  if(!['GET','HEAD'].includes(request.method))return new Response('Metodo non consentito',{status:405,headers:baseHeaders});
  const assetURL=new URL(request.url);if(publicViewer)assetURL.pathname='/viewer.html';
  const response=await env.ASSETS.fetch(new Request(assetURL,request)),headers=new Headers(response.headers);for(const [k,v]of Object.entries(baseHeaders))headers.set(k,v);
  return new Response(response.body,{status:response.status,headers});
 }catch(e){return Response.json({error:e.status?e.message:'Servizio temporaneamente non disponibile.'},{status:e.status||503,headers:baseHeaders});}
}
export default {fetch:(request,env)=>handle(request,env)};
