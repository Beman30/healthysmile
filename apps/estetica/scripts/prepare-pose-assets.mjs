// Reproducible, same-origin browser assets. Runs during Cloudflare's npm ci.
// No executable dependency is fetched at runtime from a third-party CDN.
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const assets=JSON.parse(await readFile(new URL('./pose-assets.json',import.meta.url),'utf8'));
const destination=process.env.POSE_ASSET_OUTPUT||fileURLToPath(new URL('../public/pose-vendor/',import.meta.url));
const hash=data=>createHash('sha256').update(data).digest('hex');
for(const asset of assets){
 const file=resolve(destination,asset.path);
 try{if(hash(await readFile(file))===asset.sha256)continue;}catch{}
 let last;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetch(asset.url,{signal:AbortSignal.timeout(60000)});
   if(!response.ok)throw Error(`HTTP ${response.status}`);
   const data=Buffer.from(await response.arrayBuffer());
   if(hash(data)!==asset.sha256)throw Error('SHA-256 mismatch');
   await mkdir(dirname(file),{recursive:true});await writeFile(file+'.download',data);await rename(file+'.download',file);
   last=null;break;
  }catch(error){last=error;await rm(file+'.download',{force:true});}
 }
 if(last)throw Error(`Cannot prepare verified pose asset ${asset.path}: ${last.message}`);
}
console.log('Verified face-guidance assets ready.');
