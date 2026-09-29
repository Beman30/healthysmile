'use strict';
// The before stays a single original; each after-zone is stored independently.
// Matching crops use the ROI recorded at that zone's shutter press.
(()=>{
 const surface=$('comparisonSurface');let generation=0,busy=false;
 const zoneMode=()=>compareA===0&&compareB>0&&FLOW_POSES.some(p=>p.id===comparePose)&&ZONE_IDS.some(id=>visits[compareB]?.photos.has(zonePhotoKey(comparePose,id)));
 const pair=id=>{const after=visits[compareB]?.photos.get(zonePhotoKey(comparePose,id));return {before:visits[0]?.photos.get(comparePose),after,roi:after?.zone?.roi};};
 const whole=()=>ZONE_IDS.every(id=>{const p=pair(id);return p.before&&p.after&&p.roi;});
 function drawBefore(ctx,image,roi,x,y,size){
  const c=cropRect(image.naturalWidth,image.naturalHeight);
  ctx.drawImage(image,c.sx+roi.x*c.sw,c.sy+roi.y*c.sh,roi.w*c.sw,roi.h*c.sh,x,y,size,size);
 }
 function squareData(image,roi){const c=document.createElement('canvas');c.width=540;c.height=540;drawBefore(c.getContext('2d'),image,roi,0,0,540);return c.toDataURL('image/jpeg',.94);}
 async function showPairs(){
  const serial=++generation;surface.replaceChildren();surface.className='comparison-surface zone-comparison-surface';
  if(!visits[0].photos.has(comparePose)){surface.textContent='Manca la foto originale del prima per questa posa.';return;}
  let before;try{before=await loadedImage(visits[0].photos.get(comparePose).url);}catch{if(serial===generation)surface.textContent='Non riesco ad aprire il prima. Riprova.';return;}
  if(serial!==generation||view!=='compare')return;
  for(const [i,id]of ZONE_IDS.entries()){
   const {after,roi}=pair(id),card=document.createElement('article');card.className='zone-pair';
   const title=document.createElement('h2');title.textContent=`${i+1}. ${ZONE_NAMES[i]}`;card.append(title);
   if(!after||!roi){const missing=document.createElement('p');missing.textContent='Zona del dopo da scattare';card.append(missing);surface.append(card);continue;}
   const image=squareData(before,roi),twoup=document.createElement('div');twoup.className='zone-pair-twoup';
   for(const [label,url]of [['Prima',image],['Dopo',after.url]]){const panel=document.createElement('div'),caption=document.createElement('span'),picture=document.createElement('img');caption.textContent=label;picture.src=url;picture.alt=`${label} · ${ZONE_NAMES[i]}`;panel.append(caption,picture);twoup.append(panel);}
   const stage=document.createElement('div');stage.className='zone-pair-stage';stage.style.setProperty('--wipe','50%');
   const a=document.createElement('img');a.src=after.url;a.alt='Dopo · '+ZONE_NAMES[i];
   const b=document.createElement('img');b.src=image;b.alt='Prima · '+ZONE_NAMES[i];b.className='zone-before';
   const line=document.createElement('span');line.className='zone-divider';line.setAttribute('aria-hidden','true');stage.append(a,b,line);
   const range=document.createElement('input');range.type='range';range.min='0';range.max='100';range.value='50';range.setAttribute('aria-label','Confronta prima e dopo: '+ZONE_NAMES[i]);range.addEventListener('input',()=>stage.style.setProperty('--wipe',range.value+'%'));
   const labels=document.createElement('p');labels.textContent='Trascina per sovrapporre prima e dopo';card.append(twoup,stage,range,labels);surface.append(card);
  }
 }
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
  }
  return c.toDataURL('image/jpeg',.9);
 };
 window.hasZoneComparison=zoneMode;window.hasAllZonePairs=whole;
 renderComparison();
})();
