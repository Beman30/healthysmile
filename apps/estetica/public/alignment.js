'use strict';
// Similarity transform only: no warping, skin retouching or colour adjustment.
function validAlignment(a){
 const points=Array.isArray(a?.points)&&a.points.length>=2&&a.points.length<=32&&a.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1));
 if(!points)return false;
 if(a.version===1)return a.points.length===2&&Number.isFinite(a.angle)&&Math.abs(a.angle)<=Math.PI;
 return a.version===2&&Array.isArray(a.targets)&&a.targets.length===a.points.length&&a.targets.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=100));
}
function fitAlignmentPoints(source,target){
 const n=source.length,mean=ps=>ps.reduce((m,p)=>[m[0]+p[0]/n,m[1]+p[1]/n],[0,0]),s=mean(source),t=mean(target);
 let den=0,dot=0,cross=0;for(let i=0;i<n;i++){const x=source[i][0]-s[0],y=source[i][1]-s[1],u=target[i][0]-t[0],v=target[i][1]-t[1];den+=x*x+y*y;dot+=x*u+y*v;cross+=x*v-y*u;}
 if(den<1)throw Error('I reperi sono troppo vicini. Scegli riferimenti più distanti.');
 const a=dot/den,b=cross/den;if(!Number.isFinite(a)||!Number.isFinite(b)||Math.hypot(a,b)<.00001)throw Error('Controlla che i numeri corrispondano nelle due foto.');
 return [a,b,-b,a,t[0]-a*s[0]+b*s[1],t[1]-b*s[0]-a*s[1]];
}
function alignmentMatrix(a,width,height){
 if(!validAlignment(a)||width<=0||height<=0)throw Error('Punti non validi.');
 if(a.version===2)return fitAlignmentPoints(a.points.map(p=>[p[0]*width,p[1]*height]),a.targets.map(p=>[p[0]*900,p[1]*1200]));
 const points=a.points.map(p=>[p[0]*width,p[1]*height]).sort((p,q)=>p[0]-q[0]);
 const dx=points[1][0]-points[0][0],dy=points[1][1]-points[0][1],distance=Math.hypot(dx,dy);
 if(distance<Math.min(width,height)*.04)throw Error('I punti sono troppo vicini. Scegli due riferimenti più distanti.');
 const rotation=a.angle-Math.atan2(dy,dx),scale=900*.23/distance,c=scale*Math.cos(rotation),s=scale*Math.sin(rotation),mx=(points[0][0]+points[1][0])/2,my=(points[0][1]+points[1][1])/2;
 return [c,s,-s,c,450-c*mx+s*my,480-s*mx-c*my];
}
async function makeAlignmentView(photo,alignment){
 const img=await loadedImage(photo.url),m=alignmentMatrix(alignment,img.naturalWidth,img.naturalHeight),canvas=document.createElement('canvas');canvas.width=900;canvas.height=1200;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#eef0f3';ctx.fillRect(0,0,900,1200);ctx.setTransform(...m);ctx.drawImage(img,0,0);
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Allineamento non riuscito.')),'image/jpeg',.96));return {url:URL.createObjectURL(blob),signature:JSON.stringify(alignment)};
}
const alignmentCache=new WeakMap();let alignmentRebuild=null,alignmentFailure=false,alignmentEditor=null,alignmentPick=null;
function clearAlignmentCache(photo){const cached=alignmentCache.get(photo);if(cached)URL.revokeObjectURL(cached.url);alignmentCache.delete(photo);}
async function ensureAlignmentViews(){
 if(alignmentRebuild)return alignmentRebuild;
 alignmentRebuild=(async()=>{try{for(const v of visits)for(const photo of v.photos.values()){if(!validAlignment(photo.alignment))continue;const old=alignmentCache.get(photo),signature=JSON.stringify(photo.alignment);if(old?.signature===signature)continue;const result=await makeAlignmentView(photo,photo.alignment);clearAlignmentCache(photo);alignmentCache.set(photo,result);}alignmentFailure=false;return true;
 }catch{alignmentFailure=true;notify('Allineamento non disponibile. Riprova con Allinea visi.');return false;}})();
 try{return await alignmentRebuild;}finally{alignmentRebuild=null;}
}
const snapshotOriginal=snapshot;snapshot=function(key){const snap=snapshotOriginal(key),cached=snap.photo&&alignmentCache.get(snap.photo);return cached?{...snap,photo:{...snap.photo,url:cached.url,width:900,height:1200}}:snap;};
const revokeOriginal=revoke;revoke=function(photo){if(photo)clearAlignmentCache(photo);revokeOriginal(photo);};
function pairOriginal(){return [snapshotOriginal(`${compareA}|${comparePose}`),snapshotOriginal(`${compareB}|${comparePose}`)];}
const renderBeforeAlignment=renderComparison;renderComparison=function(){
 renderBeforeAlignment();const pair=pairOriginal(),available=compareA!==compareB&&pair.every(p=>p.photo);$('alignFaces').disabled=!available;
 $('resetAlignment').disabled=!available||!pair.some(p=>validAlignment(p.photo.alignment));
 const waiting=visits.some(v=>[...v.photos.values()].some(p=>validAlignment(p.alignment)&&alignmentCache.get(p)?.signature!==JSON.stringify(p.alignment)));
 $('alignmentStatus').textContent=alignmentFailure?'Allineamento non disponibile. Premi Allinea visi.':waiting?'Preparazione delle inquadrature allineate…':pair.every(p=>p.photo&&validAlignment(p.photo.alignment))?'Visi allineati · applicato anche al PDF e al JPG':'Per uniformare dimensione e posizione dei visi, premi Allinea visi.';
 if(waiting){$('exportComparison').disabled=true;$('pdfCompare').disabled=true;if(!alignmentRebuild&&!alignmentFailure)ensureAlignmentViews().then(()=>{if(view==='compare')renderComparison();});}
};
function drawAlignmentEditor(index){
 const editor=alignmentEditor;if(!editor)return;const canvas=$(index?'alignAfterCanvas':'alignBeforeCanvas'),img=editor.images[index],ctx=canvas.getContext('2d');ctx.fillStyle='#15171c';ctx.fillRect(0,0,600,800);drawContain(ctx,img,0,0,600,800,1);
 const scale=Math.min(600/img.naturalWidth,800/img.naturalHeight),w=img.naturalWidth*scale,h=img.naturalHeight*scale,x=(600-w)/2,y=(800-h)/2;
 editor.frames[index]={x,y,w,h};for(const [i,p]of editor.points[index].entries()){if(!p)continue;const px=x+p[0]*w,py=y+p[1]*h;ctx.beginPath();ctx.arc(px,py,11,0,Math.PI*2);ctx.strokeStyle='#ff408e';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 24px sans-serif';ctx.fillText(String(i+1),px+14,py-12);}
 $(index?'alignAfterCount':'alignBeforeCount').textContent=`${editor.points[index].filter(Boolean).length} / ${editor.points[index].length} reperi`;$('applyAlignment').disabled=!alignmentComplete(editor);renderAlignmentPointControls();drawAlignmentPreview();
}
$('alignFaces').addEventListener('click',async()=>{
 const pair=pairOriginal();if(compareA===compareB||pair.some(p=>!p.photo))return;
 $('alignFaces').disabled=true;
 try{const images=await Promise.all(pair.map(p=>loadedImage(p.photo.url)));alignmentEditor={pair,images,points:pair.map(p=>validAlignment(p.photo.alignment)?p.photo.alignment.points.map(q=>[...q]):[]),frames:[],active:0,profile:comparePose.startsWith('profile')};
 const count=Math.max(2,...alignmentEditor.points.map(p=>p.length));alignmentEditor.points=alignmentEditor.points.map(p=>Array.from({length:count},(_,i)=>p[i]||null));
 $('alignmentHelp').textContent='Posiziona lo stesso reperto numerato nel prima e nel dopo. Puoi aggiungerne altri: tutti contribuiranno all’allineamento. Tocca la foto per aprire il dettaglio ingrandito.';
 $('alignmentError').textContent='';$('alignmentPreviewOpacity').value=50;drawAlignmentEditor(0);drawAlignmentEditor(1);$('alignmentDialog').showModal();
 }catch{notify('Non riesco ad aprire le immagini. Riprova.');}finally{$('alignFaces').disabled=false;}
});
for(const [i,id]of ['alignBeforeCanvas','alignAfterCanvas'].entries())$(id).addEventListener('click',e=>{
 if(!alignmentEditor)return;const rect=$(id).getBoundingClientRect(),frame=alignmentEditor.frames[i],x=((e.clientX-rect.left)*600/rect.width-frame.x)/frame.w,y=((e.clientY-rect.top)*800/rect.height-frame.y)/frame.h;if(x<0||x>1||y<0||y>1)return;
 const pointIndex=alignmentEditor.active;
 alignmentPick={index:i,pointIndex,point:[x,y]};
 $('alignmentPointTitle').textContent=`${i?'Dopo':'Prima'} · reperto ${pointIndex+1}`;
 $('alignmentPointHelp').textContent='Centra il reperto nel dettaglio e conferma. Usa lo stesso numero per lo stesso riferimento nell’altra foto.';
 drawAlignmentPoint();$('alignmentPointDialog').showModal();
});
for(const [i,id]of ['redoBeforePoints','redoAfterPoints'].entries())$(id).addEventListener('click',()=>{if(alignmentEditor){alignmentEditor.points[i]=alignmentEditor.points[i].map(()=>null);alignmentEditor.active=0;drawAlignmentEditor(i);}});
$('cancelAlignment').addEventListener('click',()=>{$('alignmentDialog').close();alignmentEditor=null;});
$('alignmentDialog').addEventListener('cancel',e=>{if($('cancelAlignment').disabled)e.preventDefault();else alignmentEditor=null;});
$('applyAlignment').addEventListener('click',async()=>{
 const e=alignmentEditor;if(!alignmentComplete(e))return;$('applyAlignment').disabled=true;$('cancelAlignment').disabled=true;let prepared=[];
 try{const annotations=alignmentAnnotations(e);
 for(let i=0;i<2;i++)prepared.push(await makeAlignmentView(e.pair[i].photo,annotations[i]));
 e.pair.forEach((snap,i)=>{clearAlignmentCache(snap.photo);snap.photo.alignment=annotations[i];alignmentCache.set(snap.photo,prepared[i]);});prepared=[];revision++;alignmentFailure=false;$('compareZoom').value=1;$('alignmentDialog').close();alignmentEditor=null;renderComparison();if(typeof saveLocalSession==='function')saveLocalSession();
 }catch(err){prepared.forEach(p=>URL.revokeObjectURL(p.url));$('alignmentError').textContent=err.message||'Allineamento non riuscito. Riprova.';}
 finally{$('applyAlignment').disabled=false;$('cancelAlignment').disabled=false;}
});
$('resetAlignment').addEventListener('click',()=>{pairOriginal().forEach(s=>{if(s.photo){delete s.photo.alignment;clearAlignmentCache(s.photo);}});revision++;alignmentFailure=false;renderComparison();if(typeof saveLocalSession==='function')saveLocalSession();});

// A local magnifier selects original-image coordinates; it never edits a face.
function alignmentDetailPoint(point,localX,localY,width,height){
 const span=Math.min(width,height)*.18;
 return [Math.max(0,Math.min(1,point[0]+(localX-.5)*span/width)),Math.max(0,Math.min(1,point[1]+(localY-.5)*span/height))];
}
function alignmentComplete(editor){return !!editor&&editor.points[0].length>=2&&editor.points[0].length===editor.points[1].length&&editor.points.every(ps=>ps.every(Boolean));}
function renderAlignmentPointControls(){
 const e=alignmentEditor;if(!e)return;const select=$('alignmentPointSelect');select.replaceChildren();
 e.points[0].forEach((p,i)=>select.add(new Option(`Reperto ${i+1} · Prima ${p?'✓':'—'} · Dopo ${e.points[1][i]?'✓':'—'}`,String(i))));select.value=String(e.active);$('removeAlignmentPoint').disabled=e.points[0].length<=2;$('addAlignmentPoint').disabled=e.points[0].length>=32;
}
$('alignmentPointSelect').addEventListener('change',e=>{if(alignmentEditor)alignmentEditor.active=Number(e.target.value);});
$('addAlignmentPoint').addEventListener('click',()=>{const e=alignmentEditor;if(!e||e.points[0].length>=32)return;e.active=e.points[0].length;e.points.forEach(p=>p.push(null));drawAlignmentEditor(0);drawAlignmentEditor(1);});
$('removeAlignmentPoint').addEventListener('click',()=>{const e=alignmentEditor;if(!e||e.points[0].length<=2)return;e.points.forEach(p=>p.splice(e.active,1));e.active=Math.min(e.active,e.points[0].length-1);drawAlignmentEditor(0);drawAlignmentEditor(1);});
function alignmentAnnotations(editor){
 if(!alignmentComplete(editor))throw Error('Completa gli stessi reperi su entrambe le foto.');
 const points=editor.points.map(ps=>ps.map(p=>[...p]));const first=points[0].slice(0,2).sort((a,b)=>a[0]-b[0]);const im=editor.images[0];let angle=0;
 if(editor.profile)angle=Math.atan2((first[1][1]-first[0][1])*im.naturalHeight,(first[1][0]-first[0][0])*im.naturalWidth);
 if(points[0].length===2)return points.map(p=>({version:1,points:[...p].sort((a,b)=>a[0]-b[0]),angle}));
 const base=alignmentMatrix({version:1,points:first,angle},im.naturalWidth,im.naturalHeight);
 const targets=points[0].map(p=>{const x=p[0]*im.naturalWidth,y=p[1]*im.naturalHeight;return [(base[0]*x+base[2]*y+base[4])/900,(base[1]*x+base[3]*y+base[5])/1200]});
 return points.map(p=>({version:2,points:p,targets}));
}
function drawAlignmentPoint(){
 if(!alignmentPick||!alignmentEditor)return;
 const {index,point}=alignmentPick,img=alignmentEditor.images[index],canvas=$('alignmentPointCanvas'),ctx=canvas.getContext('2d'),span=Math.min(img.naturalWidth,img.naturalHeight)*.18,scale=500/span;
 ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#15171c';ctx.fillRect(0,0,500,500);
 ctx.setTransform(scale,0,0,scale,250-point[0]*img.naturalWidth*scale,250-point[1]*img.naturalHeight*scale);ctx.drawImage(img,0,0);ctx.setTransform(1,0,0,1,0,0);
 // Leave a clear hole at the exact point, so the pupil remains visible.
 ctx.beginPath();for(const [x,y,u,v]of [[215,250,242,250],[258,250,285,250],[250,215,250,242],[250,258,250,285]]){ctx.moveTo(x,y);ctx.lineTo(u,v);}ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#b52663';ctx.lineWidth=2;ctx.stroke();
}
$('alignmentPointCanvas').addEventListener('click',e=>{
 if(!alignmentPick||!alignmentEditor)return;const rect=$('alignmentPointCanvas').getBoundingClientRect(),img=alignmentEditor.images[alignmentPick.index];
 alignmentPick.point=alignmentDetailPoint(alignmentPick.point,(e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height,img.naturalWidth,img.naturalHeight);drawAlignmentPoint();
});
for(const [id,dx,dy]of [['alignPointLeft',-1,0],['alignPointRight',1,0],['alignPointUp',0,-1],['alignPointDown',0,1]])$(id).addEventListener('click',()=>{
 if(!alignmentPick||!alignmentEditor)return;const img=alignmentEditor.images[alignmentPick.index],step=Math.max(1,Math.round(Math.min(img.naturalWidth,img.naturalHeight)/1000));
 alignmentPick.point=[Math.max(0,Math.min(1,alignmentPick.point[0]+dx*step/img.naturalWidth)),Math.max(0,Math.min(1,alignmentPick.point[1]+dy*step/img.naturalHeight))];drawAlignmentPoint();
});
$('confirmAlignmentPoint').addEventListener('click',()=>{
 if(!alignmentPick||!alignmentEditor)return;const {index,pointIndex,point}=alignmentPick;alignmentEditor.points[index][pointIndex]=point;alignmentPick=null;$('alignmentPointDialog').close();const missing=alignmentEditor.points[index].findIndex(p=>!p);alignmentEditor.active=missing>=0?missing:Math.max(0,alignmentEditor.points[1-index].findIndex(p=>!p));drawAlignmentEditor(index);
 if(alignmentComplete(alignmentEditor))$('alignmentPreview').scrollIntoView({block:'nearest'});
});
$('cancelAlignmentPoint').addEventListener('click',()=>{alignmentPick=null;$('alignmentPointDialog').close();});
$('alignmentPointDialog').addEventListener('cancel',()=>{alignmentPick=null;});
function paintAlignmentPreviewOpacity(){const p=Number($('alignmentPreviewOpacity').value);$('alignmentPreviewAfter').style.opacity=String(p/100);$('alignmentPreviewValue').textContent=p===0?'Solo prima':p===100?'Solo dopo':`${p}% dopo`;}
$('alignmentPreviewOpacity').addEventListener('input',paintAlignmentPreviewOpacity);
function drawAlignmentPreview(){
 const e=alignmentEditor,complete=alignmentComplete(e);$('alignmentPreview').hidden=!complete;if(!complete)return;
 try{const annotations=alignmentAnnotations(e);for(let i=0;i<2;i++){const canvas=$(i?'alignmentPreviewAfter':'alignmentPreviewBefore'),ctx=canvas.getContext('2d'),im=e.images[i],m=alignmentMatrix(annotations[i],im.naturalWidth,im.naturalHeight);ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#eef0f3';ctx.fillRect(0,0,900,1200);ctx.setTransform(...m);ctx.drawImage(im,0,0);ctx.setTransform(1,0,0,1,0,0);}paintAlignmentPreviewOpacity();$('alignmentError').textContent='';
 }catch(err){$('alignmentPreview').hidden=true;$('alignmentError').textContent=err.message;$('applyAlignment').disabled=true;}
}
