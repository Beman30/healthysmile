'use strict';
// Similarity transform only: no warping, skin retouching or colour adjustment.
function validAlignment(a){return a?.version===1&&Number.isFinite(a.angle)&&Math.abs(a.angle)<=Math.PI&&Array.isArray(a.points)&&a.points.length===2&&a.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1));}
function alignmentMatrix(a,width,height){
 if(!validAlignment(a)||width<=0||height<=0)throw Error('Punti non validi.');
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
 editor.frames[index]={x,y,w,h};for(const [i,p]of editor.points[index].entries()){const px=x+p[0]*w,py=y+p[1]*h;ctx.beginPath();ctx.arc(px,py,11,0,Math.PI*2);ctx.strokeStyle='#ff408e';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 24px sans-serif';ctx.fillText(String(i+1),px+14,py-12);}
 $(index?'alignAfterCount':'alignBeforeCount').textContent=`${editor.points[index].length} / 2 punti`;$('applyAlignment').disabled=editor.points.some(p=>p.length!==2);drawAlignmentPreview();
}
$('alignFaces').addEventListener('click',async()=>{
 const pair=pairOriginal();if(compareA===compareB||pair.some(p=>!p.photo))return;
 $('alignFaces').disabled=true;
 try{const images=await Promise.all(pair.map(p=>loadedImage(p.photo.url)));alignmentEditor={pair,images,points:pair.map(p=>validAlignment(p.photo.alignment)?p.photo.alignment.points.map(q=>[...q]):[]),frames:[],profile:comparePose.startsWith('profile')};
 $('alignmentHelp').textContent=alignmentEditor.profile?'In entrambe le foto tocca gli stessi due riferimenti: per esempio angolo esterno dell’occhio e attacco superiore dell’orecchio. La posa deve già essere simile.':'Tocca ciascuna pupilla nelle due foto. Nel dettaglio ingrandito centra il riferimento e conferma: quattro punti in tutto.';
 $('alignmentError').textContent='';$('alignmentPreviewOpacity').value=50;drawAlignmentEditor(0);drawAlignmentEditor(1);$('alignmentDialog').showModal();
 }catch{notify('Non riesco ad aprire le immagini. Riprova.');}finally{$('alignFaces').disabled=false;}
});
for(const [i,id]of ['alignBeforeCanvas','alignAfterCanvas'].entries())$(id).addEventListener('click',e=>{
 if(!alignmentEditor)return;const rect=$(id).getBoundingClientRect(),frame=alignmentEditor.frames[i],x=((e.clientX-rect.left)*600/rect.width-frame.x)/frame.w,y=((e.clientY-rect.top)*800/rect.height-frame.y)/frame.h;if(x<0||x>1||y<0||y>1)return;
 const points=alignmentEditor.points[i],pointIndex=points.length<2?points.length:points.reduce((best,p,k)=>Math.hypot((p[0]-x)*frame.w,(p[1]-y)*frame.h)<Math.hypot((points[best][0]-x)*frame.w,(points[best][1]-y)*frame.h)?k:best,0);
 alignmentPick={index:i,pointIndex,point:[x,y]};
 $('alignmentPointTitle').textContent=`${i?'Dopo':'Prima'} · ${alignmentEditor.profile?'riferimento':'pupilla'} ${pointIndex+1}`;
 $('alignmentPointHelp').textContent=alignmentEditor.profile?'Tocca il riferimento nel dettaglio e conferma. Scegli lo stesso punto nell’altra foto.':'Tocca il centro della pupilla nel dettaglio. Usa le frecce per piccoli spostamenti.';
 drawAlignmentPoint();$('alignmentPointDialog').showModal();
});
for(const [i,id]of ['redoBeforePoints','redoAfterPoints'].entries())$(id).addEventListener('click',()=>{if(alignmentEditor){alignmentEditor.points[i]=[];drawAlignmentEditor(i);}});
$('cancelAlignment').addEventListener('click',()=>{$('alignmentDialog').close();alignmentEditor=null;});
$('alignmentDialog').addEventListener('cancel',e=>{if($('cancelAlignment').disabled)e.preventDefault();else alignmentEditor=null;});
$('applyAlignment').addEventListener('click',async()=>{
 const e=alignmentEditor;if(!e||e.points.some(p=>p.length!==2))return;$('applyAlignment').disabled=true;$('cancelAlignment').disabled=true;let prepared=[];
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
function alignmentAnnotations(editor){
 const points=editor.points.map(p=>[...p].sort((a,b)=>a[0]-b[0]));let angle=0;
 if(editor.profile){const im=editor.images[0];angle=Math.atan2((points[0][1][1]-points[0][0][1])*im.naturalHeight,(points[0][1][0]-points[0][0][0])*im.naturalWidth);}
 return points.map(p=>({version:1,points:p,angle}));
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
 if(!alignmentPick||!alignmentEditor)return;const {index,pointIndex,point}=alignmentPick;alignmentEditor.points[index][pointIndex]=point;alignmentPick=null;$('alignmentPointDialog').close();drawAlignmentEditor(index);
 if(alignmentEditor.points.every(p=>p.length===2))$('alignmentPreview').scrollIntoView({block:'nearest'});
});
$('cancelAlignmentPoint').addEventListener('click',()=>{alignmentPick=null;$('alignmentPointDialog').close();});
$('alignmentPointDialog').addEventListener('cancel',()=>{alignmentPick=null;});
function paintAlignmentPreviewOpacity(){const p=Number($('alignmentPreviewOpacity').value);$('alignmentPreviewAfter').style.opacity=String(p/100);$('alignmentPreviewValue').textContent=p===0?'Solo prima':p===100?'Solo dopo':`${p}% dopo`;}
$('alignmentPreviewOpacity').addEventListener('input',paintAlignmentPreviewOpacity);
function drawAlignmentPreview(){
 const e=alignmentEditor,complete=e&&e.points.every(p=>p.length===2);$('alignmentPreview').hidden=!complete;if(!complete)return;
 try{const annotations=alignmentAnnotations(e);for(let i=0;i<2;i++){const canvas=$(i?'alignmentPreviewAfter':'alignmentPreviewBefore'),ctx=canvas.getContext('2d'),im=e.images[i],m=alignmentMatrix(annotations[i],im.naturalWidth,im.naturalHeight);ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#eef0f3';ctx.fillRect(0,0,900,1200);ctx.setTransform(...m);ctx.drawImage(im,0,0);ctx.setTransform(1,0,0,1,0,0);}paintAlignmentPreviewOpacity();$('alignmentError').textContent='';
 }catch(err){$('alignmentPreview').hidden=true;$('alignmentError').textContent=err.message;$('applyAlignment').disabled=true;}
}
