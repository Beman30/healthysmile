'use strict';
// Inspection zoom only: identical fixed crops for live, original and its edges.
// No camera zoom, registration, warping, or automatic acceptance of skin contours.
(()=>{
 const start=document.createElement('button');start.id='startZoneGuide';start.type='button';start.className='zone-start';start.textContent='Guida con zoom per zone';$('patientGuidance').append(start);
 const dialog=document.createElement('dialog');dialog.id='zoneGuide';dialog.setAttribute('aria-labelledby','zoneTitle');
 dialog.innerHTML=`<header><div><small>CONFRONTO LIVE · DOPO</small><h2 id="zoneTitle">Occhi</h2></div><button type="button" id="closeZoneGuide" aria-label="Chiudi guida per zone">✕</button></header>
 <nav id="zoneSteps" aria-label="Zone del viso"></nav>
 <p id="zoneHint"></p><div class="zone-view"><canvas id="zoneCanvas" width="600" height="600" aria-label="Immagine live con riferimento del prima ingrandito"></canvas></div>
 <div class="zone-feedback" role="status" aria-live="polite"><strong id="zoneInstruction"></strong><div class="eye-status"><div><small>DISTANZA</small><span id="eyeDistance">In lettura…</span></div><div><small>CENTRATURA OCCHI</small><span id="eyeCenter">In lettura…</span></div></div><p id="zoneCheck"></p></div>
 <div class="zone-tools"><canvas id="zoneMap" width="150" height="200" aria-label="Tocca il prima per scegliere la zona da ingrandire" tabindex="0"></canvas><div>
 <label for="zoneZoom">Zoom di controllo <output id="zoneZoomValue">2.5×</output></label><input id="zoneZoom" type="range" min="1.5" max="8" step=".1" value="2.5">
 <label for="zoneOpacity">Trasparenza del prima</label><input id="zoneOpacity" type="range" min="0" max="100" value="35">
 <label class="zone-lines"><input id="zoneLines" type="checkbox" checked> Linee del prima</label><small>Tocca la miniatura o trascina lo zoom per centrare la zona. Le due immagini si spostano insieme.</small></div></div>
 <footer><button type="button" id="zoneBack">Indietro</button><button type="button" id="zoneNext">Zona controllata: avanti</button></footer>`;
 document.body.append(dialog);
 const stages=[['Occhi e distanza','Azzurro: riferimenti del prima. Giallo: occhi live. Fai coincidere entrambi, mantenendo distanza e inclinazione.'],['Contorno sinistro','Sinistra del paziente (a destra nell’immagine). Controlla il profilo senza cercare di annullare i cambiamenti del trattamento.'],['Contorno destro','Destra del paziente (a sinistra nell’immagine). Ricontrolla anche gli occhi se muovi la testa.'],['Fronte','Confronta fronte e attaccatura solo come controllo visivo: capelli ed espressione possono cambiare.'],['Viso completo','Ricontrolla tutte le zone insieme prima dello scatto. I passaggi precedenti non bloccano la posizione.']];
 let step=0,center={x:.5,y:.35},ref=null,image=null,face=null,faceURL='',facePatient='',openKey='',generation=0,raf=0,lastDraw=0,manual=false,holding=false,measurement=null;
 const canvas=$('zoneCanvas'),ctx=canvas.getContext('2d'),map=$('zoneMap'),mctx=map.getContext('2d');
 const stateKey=()=>[cloud.patient?.id,activeVisit,current,captureReference()?.url,stream?.id].join('|');
 const valid=()=>!!stream&&activeVisit>0&&!pending&&view!=='compare'&&!!captureReference();
 stages.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.textContent=(i+1)+' '+s[0];b.onclick=()=>choose(i);$('zoneSteps').append(b);});
 function roi(){const w=step===4?1:1/Number($('zoneZoom').value),h=step===4?1:w*.75;return {x:Math.max(0,Math.min(1-w,center.x-w/2)),y:Math.max(0,Math.min(1-h,center.y-h/2)),w,h};}
 function locate(){
  const target=faceURL===ref?.url&&facePatient===cloud.patient?.id?face:null,x=target?.cx??.5,y=target?.cy??.36,s=target?.size??.3;
  center={x:x+(step===1?s*.62:step===2?-s*.62:0),y:y+(step===1||step===2?s*.35:step===3?-s*.48:0)};
 }
 function choose(n){
  step=n;manual=false;locate();const size=faceURL===ref?.url&&facePatient===cloud.patient?.id?face?.size:null;const z=size?1/(size*(step===0?1.6:step===3?1.45:1.1)):(step===0?2.5:3.5);$('zoneZoom').value=String(Math.max(1.5,Math.min(8,z)));$('zoneZoom').disabled=step===4;
  canvas.width=600;canvas.height=step===4?800:600;
  $('zoneTitle').textContent=(step+1)+'/5 · '+stages[step][0];$('zoneHint').textContent=stages[step][1];
  [...$('zoneSteps').children].forEach((b,i)=>b.setAttribute('aria-current',String(i===step)));
  $('zoneBack').disabled=step===0;$('zoneNext').textContent=step===4?'Scatta il dopo':'Zona controllata: avanti';
 }
 function layer(context,source,sw,sh,r,width,height,alpha=1){
  if(!source||!sw||!sh||!alpha)return;
  const c=cropRect(sw,sh);context.globalAlpha=alpha;
  context.drawImage(source,c.sx+r.x*c.sw,c.sy+r.y*c.sh,r.w*c.sw,r.h*c.sh,0,0,width,height);context.globalAlpha=1;
 }
 function eyeMarkers(r,sample){
  if(!sample||![0,4].includes(step)||!sample.target?.anchors||sample.live?.error||sample.live?.clipped)return;
  const draw=(f,color,live)=>{
   const points=[f.anchors?.[0],f.anchors?.[3]];if(points.some(p=>!p||!p.every(Number.isFinite)))return;
   const xy=points.map(p=>[(p[0]-r.x)/r.w*canvas.width,(p[1]*.75-r.y)/r.h*canvas.height]);
   ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=3;ctx.shadowColor='#111';ctx.shadowBlur=3;
   ctx.setLineDash(live?[]:[8,6]);ctx.beginPath();ctx.moveTo(...xy[0]);ctx.lineTo(...xy[1]);ctx.stroke();ctx.setLineDash([]);
   for(const [x,y] of xy){ctx.beginPath();ctx.arc(x,y,live?5:12,0,Math.PI*2);live?ctx.fill():ctx.stroke();}ctx.restore();
  };
  draw(sample.target,'#26ffe0',false);draw(sample.live,'#ffd166',true);
 }
 function reportEyes(now){
  const fresh=measurement&&measurement.context===stateKey()&&now-measurement.measuredAt<1800&&$('togglePatientGuidance').getAttribute('aria-pressed')==='true';
  const sample=fresh?measurement:null,status=sample?.eyes;
  for(const [id,part]of [['eyeDistance','distance'],['eyeCenter','centering']]){
   const el=$(id),text=status?.[part]?.text||'Misura non disponibile';if(el.textContent!==text)el.textContent=text;
   el.dataset.state=status?.[part]?.key==='near'?'near':status?.[part]?.key==='unknown'||!status?'unknown':'adjust';
  }
  const text=status?.eyes||'Segui la sagoma: attendo una lettura affidabile degli occhi.';
  if($('zoneCheck').textContent!==text)$('zoneCheck').textContent=text;
  return sample;
 }
 function frame(now){
  if(!dialog.open)return;
  if(!valid()||openKey!==stateKey()){dialog.close();return;}
  raf=requestAnimationFrame(frame);if(document.hidden||now-lastDraw<66)return;lastDraw=now;
  const r=roi(),v=$('video'),edges=$('referenceContour');ctx.fillStyle='#171923';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(v.readyState>=2)layer(ctx,v,v.videoWidth,v.videoHeight,r,canvas.width,canvas.height);
  if(image)layer(ctx,image,image.naturalWidth,image.naturalHeight,r,canvas.width,canvas.height,Number($('zoneOpacity').value)/100);
  if(edges&&!edges.hidden&&$('zoneLines').checked)layer(ctx,edges,edges.width,edges.height,r,canvas.width,canvas.height,Number($('contourOpacity').value)/100);
  eyeMarkers(r,reportEyes(now));
  if(image){layer(mctx,image,image.naturalWidth,image.naturalHeight,{x:0,y:0,w:1,h:1},150,200);mctx.strokeStyle='#26ffe0';mctx.lineWidth=3;mctx.strokeRect(r.x*150,r.y*200,r.w*150,r.h*200);}
  $('zoneZoomValue').textContent=step===4?'Intero':Number($('zoneZoom').value).toFixed(1)+'×';
  const instruction=$('patientGuideInstruction').textContent;if($('zoneInstruction').textContent!==instruction)$('zoneInstruction').textContent=instruction;
  $('zoneNext').disabled=step===4&&(captureBusy||$('capture').disabled||v.readyState<2);
 }
 start.onclick=async()=>{
  if(!valid())return;const gen=++generation;ref=captureReference();openKey=stateKey();image=null;mctx.clearRect(0,0,150,200);choose(0);dialog.showModal();raf=requestAnimationFrame(frame);
  try{const im=await loadedImage(ref.url);if(gen===generation&&dialog.open)image=im;}catch{if(gen===generation){dialog.close();notify('Non riesco ad aprire la foto prima. Riprova.');}}
 };
 $('closeZoneGuide').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{generation++;cancelAnimationFrame(raf);image=null;ref=null;holding=false;});
 $('zoneBack').onclick=()=>choose(Math.max(0,step-1));
 $('zoneNext').onclick=()=>{if(step<4)choose(step+1);else if(valid()&&!$('capture').disabled&&!captureBusy){dialog.close();$('capture').click();}};
 map.addEventListener('pointerdown',e=>{if(step===4)return;const b=map.getBoundingClientRect();center={x:(e.clientX-b.left)/b.width,y:(e.clientY-b.top)/b.height};manual=true;});
 map.addEventListener('keydown',e=>{const d={ArrowLeft:[-.025,0],ArrowRight:[.025,0],ArrowUp:[0,-.025],ArrowDown:[0,.025]}[e.key];if(d&&step!==4){e.preventDefault();center.x=Math.max(0,Math.min(1,center.x+d[0]));center.y=Math.max(0,Math.min(1,center.y+d[1]));manual=true;}});
 let lastPoint=null;
 canvas.addEventListener('pointerdown',e=>{if(step===4)return;holding=true;lastPoint=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
 canvas.addEventListener('pointermove',e=>{if(!holding)return;const b=canvas.getBoundingClientRect(),r=roi();center.x=Math.max(0,Math.min(1,center.x-(e.clientX-lastPoint[0])/b.width*r.w));center.y=Math.max(0,Math.min(1,center.y-(e.clientY-lastPoint[1])/b.height*r.h));lastPoint=[e.clientX,e.clientY];manual=true;});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>holding=false);
 window.addEventListener('hs-face-guide',({detail})=>{if(detail.unavailable){measurement=null;return;}measurement=detail;const changed=faceURL!==detail.referenceURL||facePatient!==detail.patientId;face=detail.target;faceURL=detail.referenceURL;facePatient=detail.patientId;if(changed&&dialog.open&&!manual)locate();});
 setInterval(()=>{start.hidden=!valid();if(!cloud.patient||facePatient!==cloud.patient.id){face=null;faceURL='';facePatient='';measurement=null;}if(dialog.open&&(!valid()||openKey!==stateKey()))dialog.close();},350);
})();
