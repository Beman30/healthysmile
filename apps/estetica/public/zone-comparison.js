'use strict';
// The before stays a single original; each after-zone is stored independently.
// Matching crops use the ROI recorded at that zone's shutter press.
(()=>{
 const surface=$('comparisonSurface');let generation=0,busy=false,editor=null;
 const pointsDialog=document.createElement('dialog');pointsDialog.id='zonePointsDialog';pointsDialog.setAttribute('aria-labelledby','zonePointsTitle');
 pointsDialog.innerHTML=`<header><h2 id="zonePointsTitle">Reperi della zona</h2><button type="button" id="closeZonePoints" aria-label="Chiudi">✕</button></header>
 <p>Indica lo stesso reperto numerato nel prima e nel dopo. Usa lo zoom per posizionarlo con precisione: le fotografie originali non vengono deformate.</p>
 <label for="zonePointSelect">Reperto da posizionare</label><select id="zonePointSelect"></select>
 <div class="zone-points-images"><section><h3>Prima</h3><canvas id="zonePointBefore" width="600" height="600" aria-label="Posiziona il reperto sul prima"></canvas><label>Zoom prima <input id="zonePointZoomBefore" type="range" min="1" max="6" step=".1" value="1"></label></section>
 <section><h3>Dopo</h3><canvas id="zonePointAfter" width="600" height="600" aria-label="Posiziona lo stesso reperto sul dopo"></canvas><label>Zoom dopo <input id="zonePointZoomAfter" type="range" min="1" max="6" step=".1" value="1"></label></section></div>
 <p id="zonePointStatus" role="status"></p><footer><button type="button" id="zoneAddPoint">+ Altro reperto</button><button type="button" id="zoneRemovePoint">Elimina reperto</button><button type="button" id="zoneSavePoints">Salva reperi</button></footer>`;
 document.body.append(pointsDialog);
 const zoneMode=()=>compareA===0&&compareB>0&&FLOW_POSES.some(p=>p.id===comparePose)&&ZONE_IDS.some(id=>visits[compareB]?.photos.has(zonePhotoKey(comparePose,id)));
 const pair=id=>{const after=visits[compareB]?.photos.get(zonePhotoKey(comparePose,id));return {before:visits[0]?.photos.get(comparePose),after,roi:after?.zone?.roi};};
 const whole=()=>ZONE_IDS.every(id=>{const p=pair(id);return p.before&&p.after&&p.roi;});
 function drawBefore(ctx,image,roi,x,y,size){
  const c=cropRect(image.naturalWidth,image.naturalHeight);
  ctx.drawImage(image,c.sx+roi.x*c.sw,c.sy+roi.y*c.sh,roi.w*c.sw,roi.h*c.sh,x,y,size,size);
 }
 function squareData(image,roi){const c=document.createElement('canvas');c.width=540;c.height=540;drawBefore(c.getContext('2d'),image,roi,0,0,540);return c.toDataURL('image/jpeg',.94);}
 function marker(point,index,side){const el=document.createElement('span');el.className='zone-marker zone-marker-'+side;el.textContent=String(index+1);el.style.left=(point[0]*100)+'%';el.style.top=(point[1]*100)+'%';el.setAttribute('aria-label',`Reperto ${index+1} · ${side==='before'?'prima':'dopo'}`);return el;}
 function markerLayer(marks,side){const layer=document.createElement('div');layer.className='zone-marker-layer zone-marker-layer-'+side;marks.forEach((m,i)=>layer.append(marker(m[side],i,side)));return layer;}
 function drawMarkers(ctx,marks,side,x,y,size){ctx.save();ctx.font='bold 21px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';marks.forEach((m,i)=>{const px=x+m[side][0]*size,py=y+m[side][1]*size;ctx.fillStyle=side==='before'?'#0b7f7d':'#b82c68';ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();ctx.arc(px,py,15,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='white';ctx.fillText(String(i+1),px,py+1);});ctx.restore();}
 async function showPairs(){
  const serial=++generation;surface.replaceChildren();surface.className='comparison-surface zone-comparison-surface';
  if(!visits[0].photos.has(comparePose)){surface.textContent='Manca la foto originale del prima per questa posa.';return;}
  let before;try{before=await loadedImage(visits[0].photos.get(comparePose).url);}catch{if(serial===generation)surface.textContent='Non riesco ad aprire il prima. Riprova.';return;}
  if(serial!==generation||view!=='compare')return;
  for(const [i,id]of ZONE_IDS.entries()){
   const {after,roi}=pair(id),card=document.createElement('article');card.className='zone-pair';
   const title=document.createElement('h2');title.textContent=`${i+1}. ${ZONE_NAMES[i]}`;card.append(title);
   if(!after||!roi){const missing=document.createElement('p');missing.textContent='Zona del dopo da scattare';card.append(missing);surface.append(card);continue;}
   const marks=after.zone.landmarks||[],image=squareData(before,roi),twoup=document.createElement('div');twoup.className='zone-pair-twoup';
   for(const [side,label,url]of [['before','Prima',image],['after','Dopo',after.url]]){const panel=document.createElement('div'),caption=document.createElement('span'),frame=document.createElement('div'),picture=document.createElement('img');caption.textContent=label;frame.className='zone-pair-photo-frame';picture.src=url;picture.alt=`${label} · ${ZONE_NAMES[i]}`;frame.append(picture,markerLayer(marks,side));panel.append(caption,frame);twoup.append(panel);}
   const stage=document.createElement('div');stage.className='zone-pair-stage';stage.style.setProperty('--wipe','50%');
   const a=document.createElement('img');a.src=after.url;a.alt='Dopo · '+ZONE_NAMES[i];
   const b=document.createElement('img');b.src=image;b.alt='Prima · '+ZONE_NAMES[i];b.className='zone-before';
   const line=document.createElement('span');line.className='zone-divider';line.setAttribute('aria-hidden','true');stage.append(a,b,markerLayer(marks,'before'),markerLayer(marks,'after'),line);
   const range=document.createElement('input');range.type='range';range.min='0';range.max='100';range.value='50';range.setAttribute('aria-label','Confronta prima e dopo: '+ZONE_NAMES[i]);range.addEventListener('input',()=>stage.style.setProperty('--wipe',range.value+'%'));
   const labels=document.createElement('p');labels.textContent='Trascina per sovrapporre prima e dopo';
   const edit=document.createElement('button');edit.type='button';edit.className='zone-edit-points';edit.textContent=marks.length?`Modifica ${marks.length} reperi`:'Posiziona reperi';edit.onclick=()=>openPoints(id,before,after);
   card.append(twoup,stage,range,labels,edit);surface.append(card);
  }
 }
 function drawPointCanvas(side){
  if(!editor)return;const canvas=$(side==='before'?'zonePointBefore':'zonePointAfter'),image=editor.images[side];if(!image)return;
  const ctx=canvas.getContext('2d'),zoom=editor.zoom[side],point=editor.marks[editor.index]?.[side];
  if(point)editor.center[side]=[...point];
  const left=Math.max(0,Math.min(1-1/zoom,editor.center[side][0]-.5/zoom)),top=Math.max(0,Math.min(1-1/zoom,editor.center[side][1]-.5/zoom));
  editor.viewport[side]={left,top,zoom};ctx.fillStyle='#15171c';ctx.fillRect(0,0,600,600);
  const crop=side==='before'?cropRect(image.naturalWidth,image.naturalHeight):null,roi=editor.roi;
  const source=side==='before'?{x:crop.sx+roi.x*crop.sw,y:crop.sy+roi.y*crop.sh,w:roi.w*crop.sw,h:roi.h*crop.sh}:{x:0,y:0,w:image.naturalWidth,h:image.naturalHeight};
  ctx.drawImage(image,source.x+left*source.w,source.y+top*source.h,source.w/zoom,source.h/zoom,0,0,600,600);
  for(const [i,m]of editor.marks.entries()){
   const p=m[side];if(!p)continue;const x=(p[0]-left)*zoom*600,y=(p[1]-top)*zoom*600;if(x<0||x>600||y<0||y>600)continue;
   ctx.beginPath();ctx.arc(x,y,i===editor.index?15:12,0,Math.PI*2);ctx.fillStyle=side==='before'?'#0b7f7d':'#b82c68';ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.fill();ctx.stroke();ctx.font='bold 19px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';ctx.fillText(String(i+1),x,y+1);
  }
 }
 function renderPointEditor(){
  if(!editor)return;const select=$('zonePointSelect');select.replaceChildren(...editor.marks.map((m,i)=>new Option(`Reperto ${i+1} · ${m.before?'Prima ✓':'Prima —'} · ${m.after?'Dopo ✓':'Dopo —'}`,String(i))));
  select.value=String(editor.index);$('zoneAddPoint').disabled=editor.marks.length>=12||editor.marks.some(m=>!m.before||!m.after);
  $('zoneRemovePoint').disabled=!editor.marks.length;$('zoneSavePoints').disabled=editor.marks.some(m=>!m.before||!m.after);
  $('zonePointStatus').textContent=editor.marks.length?`Repero ${editor.index+1}: tocca un punto nel prima e lo stesso punto nel dopo. Puoi ingrandire e correggerlo.`:'Nessun reperto. Aggiungine uno oppure salva per cancellare quelli precedenti.';
  drawPointCanvas('before');drawPointCanvas('after');
 }
 async function openPoints(id,beforeImage,after){
  const patientId=cloud.patient?.id,visit=compareB,pose=comparePose,photo=after,zone=after.zone;
  const state={patientId,visit,pose,id,photo,roi:zone.roi,marks:(zone.landmarks||[]).map(m=>({before:[...m.before],after:[...m.after]})),index:0,images:{},zoom:{before:1,after:1},center:{before:[.5,.5],after:[.5,.5]},viewport:{}};
  if(!state.marks.length)state.marks.push({before:null,after:null});
  $('zonePointsTitle').textContent='Reperi · '+ZONE_NAMES[ZONE_IDS.indexOf(id)];$('zonePointStatus').textContent='Apro le fotografie…';pointsDialog.showModal();editor=state;
  for(const side of ['before','after'])$(side==='before'?'zonePointZoomBefore':'zonePointZoomAfter').value='1';
  try{const afterImage=await loadedImage(after.url);
   if(editor!==state||!pointsDialog.open)return;state.images={before:beforeImage,after:afterImage};renderPointEditor();
  }catch{if(editor===state){pointsDialog.close();notify('Non riesco ad aprire le foto per i reperi. Riprova.');}}
 }
 $('closeZonePoints').onclick=()=>pointsDialog.close();pointsDialog.addEventListener('close',()=>{editor=null;});
 $('zonePointSelect').onchange=()=>{if(editor){editor.index=Number($('zonePointSelect').value);renderPointEditor();}};
 $('zoneAddPoint').onclick=()=>{if(!editor||editor.marks.length>=12||editor.marks.some(m=>!m.before||!m.after))return;editor.marks.push({before:null,after:null});editor.index=editor.marks.length-1;renderPointEditor();};
 $('zoneRemovePoint').onclick=()=>{if(!editor)return;editor.marks.splice(editor.index,1);editor.index=Math.max(0,Math.min(editor.index,editor.marks.length-1));renderPointEditor();};
 for(const side of ['before','after']){
  $(side==='before'?'zonePointZoomBefore':'zonePointZoomAfter').oninput=e=>{if(!editor)return;editor.zoom[side]=Number(e.target.value);drawPointCanvas(side);};
  $(side==='before'?'zonePointBefore':'zonePointAfter').onclick=e=>{
   if(!editor?.images[side]||!editor.marks[editor.index])return;
   const canvas=e.currentTarget,box=canvas.getBoundingClientRect(),r=editor.viewport[side],x=r.left+(e.clientX-box.left)/box.width/r.zoom,y=r.top+(e.clientY-box.top)/box.height/r.zoom;
   editor.marks[editor.index][side]=[Math.max(0,Math.min(1,x)),Math.max(0,Math.min(1,y))];renderPointEditor();
  };
 }
 $('zoneSavePoints').onclick=()=>{
  if(!editor||editor.marks.some(m=>!m.before||!m.after))return;
  const {patientId,visit,pose,id,photo,marks}=editor;
  if(cloud.patient?.id!==patientId||visits[visit]?.photos.get(zonePhotoKey(pose,id))!==photo){pointsDialog.close();notify('La foto è cambiata. Riapri i reperi.');return;}
  photo.zone.landmarks=marks.map(m=>({before:[...m.before],after:[...m.after]}));revision++;pointsDialog.close();render();renderComparison();
 };
 document.addEventListener('click',async e=>{
  if(e.target.id!=='backToPhotos'||!zoneMode())return;
  e.preventDefault();e.stopImmediatePropagation();document.body.classList.remove('comparison-full');lastFollowup=compareB;
  const pose=comparePose;if(!setView('after'))return;current=POSES.findIndex(p=>p.id===pose);render();if(!stream)await startCamera();
 },true);
 const legacyRender=renderComparison;
 renderComparison=function(){
  if(!zoneMode()){document.body.classList.remove('zone-comparison-active');generation++;legacyRender();return;}
  rememberVisit();document.body.classList.add('zone-comparison-active');
  $('comparePatient').textContent=$('patientCode').value.trim()?`Paziente ${$('patientCode').value.trim()} · ${POSES.find(p=>p.id===comparePose)?.title||''}`:'';
  optionList($('compareBefore'),visits.map((v,i)=>[i,visitLabel(i)]),compareA);
  optionList($('compareAfter'),visits.map((v,i)=>[i,visitLabel(i)]),compareB);
  optionList($('comparePose'),POSES.map(p=>[p.id,p.title]),comparePose);
  $('exportComparison').disabled=!whole();$('pdfCompare').disabled=!whole();$('shareComparison').disabled=!whole();
  showPairs();
 };
 async function contactSheet(){
  if(!whole())throw Error('Completa le quattro zone.');
  const before=await loadedImage(pair(ZONE_IDS[0]).before.url),after=await Promise.all(ZONE_IDS.map(id=>loadedImage(pair(id).after.url)));
  const c=document.createElement('canvas');c.width=1684;c.height=1190;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);
  g.fillStyle='#b82c68';g.font='bold 40px sans-serif';g.fillText('Healthy Smile · Confronto per zone',48,62);
  g.fillStyle='#333';g.font='22px sans-serif';g.fillText(`${POSES.find(p=>p.id===comparePose).title} · ${visitLabel(0)} / ${visitLabel(compareB)}`,48,105);
  for(let i=0;i<4;i++){
   const x=48+i%2*800,y=140+Math.floor(i/2)*505,r=pair(ZONE_IDS[i]).roi;
   g.fillStyle='#20232a';g.font='bold 29px sans-serif';g.fillText(ZONE_NAMES[i],x,y+29);
   drawBefore(g,before,r,x,y+50,330);g.drawImage(after[i],x+380,y+50,330,330);
   const marks=pair(ZONE_IDS[i]).after.zone.landmarks||[];drawMarkers(g,marks,'before',x,y+50,330);drawMarkers(g,marks,'after',x+380,y+50,330);
   g.font='22px sans-serif';g.fillText('PRIMA',x,y+413);g.fillText('DOPO',x+380,y+413);
  }
  g.fillStyle='#626873';g.font='18px sans-serif';g.fillText('Ritagli originali · Inquadrature e luce possono differire · Nessuna deformazione del viso',48,1172);
  return c;
 }
 // The existing JPG and PDF buttons dispatch through this module only for zone visits.
 document.addEventListener('click',async e=>{
  if(!zoneMode()||!['exportComparison','pdfCompare'].includes(e.target.id))return;
  e.preventDefault();e.stopImmediatePropagation();if(busy||!whole())return;busy=true;
  const button=e.target;button.disabled=true;
  try{const canvas=await contactSheet(),jpeg=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Immagine non pronta')),'image/jpeg',.94));
   const name=`${safeName($('patientCode').value)}_quattro_zone`;
   if(button.id==='exportComparison')download(jpeg,name+'.jpg');
   else download(buildPhotoPDF([{bytes:new Uint8Array(await jpeg.arrayBuffer()),width:canvas.width,height:canvas.height}]),name+'.pdf');
   canvas.width=0;notify('Confronto delle quattro zone preparato. Verifica il file scaricato.');
  }catch{notify('Non riesco a creare il confronto. Riprova.');}finally{busy=false;button.disabled=!whole();}
 },true);
 // Existing encrypted share viewer can display both 2×2 contact sheets as a pair.
 window.zoneShareImageURL=async(beforePhase,pose=comparePose,visit=compareB)=>{
  const ref=await loadedImage(visits[0].photos.get(pose).url),after=beforePhase?null:await Promise.all(ZONE_IDS.map(id=>loadedImage(visits[visit].photos.get(zonePhotoKey(pose,id)).url)));
  const c=document.createElement('canvas');c.width=900;c.height=1200;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,900,1200);
  g.fillStyle='#b82c68';g.font='bold 36px sans-serif';g.fillText(beforePhase?'PRIMA · QUATTRO ZONE':'DOPO · QUATTRO ZONE',32,54);
  for(let i=0;i<4;i++){
   const x=32+(i%2)*445,y=85+Math.floor(i/2)*550,roi=visits[visit].photos.get(zonePhotoKey(pose,ZONE_IDS[i])).zone.roi;
   g.fillStyle='#25252d';g.font='bold 25px sans-serif';g.fillText(ZONE_NAMES[i],x,y+32);
   if(beforePhase)drawBefore(g,ref,roi,x,y+46,405);else g.drawImage(after[i],x,y+46,405,405);
   drawMarkers(g,visits[visit].photos.get(zonePhotoKey(pose,ZONE_IDS[i])).zone.landmarks||[],beforePhase?'before':'after',x,y+46,405);
  }
  return c.toDataURL('image/jpeg',.9);
 };
 window.hasZoneComparison=zoneMode;window.hasAllZonePairs=whole;
 renderComparison();
})();
