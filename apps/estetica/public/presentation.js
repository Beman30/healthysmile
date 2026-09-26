'use strict';
function sequenceIds(){const v=visits[activeVisit],available=FLOW_POSES.filter(p=>!activeVisit||visits[0].photos.has(p.id)).map(p=>p.id);const chosen=available.filter(id=>v.selected?.includes(id));return activeVisit&&chosen.length?chosen:available;}
function stepPose(delta){const ids=sequenceIds(),at=ids.indexOf(POSES[current].id),next=Math.min(ids.length-1,Math.max(0,at+delta));if(ids[next])selectPose(POSES.findIndex(p=>p.id===ids[next]));}
const viewBeforeRepeat=setView;setView=function(next){const ok=viewBeforeRepeat(next);if(ok&&next!=='compare'){const ids=sequenceIds(),id=ids.find(id=>!photos.has(id))||ids[0];if(id)current=POSES.findIndex(p=>p.id===id);render();}return ok;};
const acceptBeforeRepeat=acceptPhoto;acceptPhoto=function(){if(!pending)return;const ids=sequenceIds();acceptBeforeRepeat();const next=ids.find(id=>!photos.has(id));if(next)current=POSES.findIndex(p=>p.id===next);else if(ids.length){current=POSES.findIndex(p=>p.id===ids[ids.length-1]);notify(activeVisit?'Pose scelte completate. Apri Confronto.':'Prima completato. Premi Scatta il dopo.');}render();};
const flowBeforeRepeat=renderFlow;renderFlow=function(){flowBeforeRepeat();const ids=sequenceIds(),count=ids.filter(id=>photos.has(id)).length,at=ids.indexOf(POSES[current].id);
 $('repeatPhotos').disabled=!visits[0].photos.size||!!pending||importBusy;
 $('repeatProgress').textContent=activeVisit?`${count} di ${ids.length} pose scelte completate`:'';
 if(activeVisit){$('progressText').textContent=`${count} / ${ids.length}`;$('completionLabel').textContent=count===ids.length?'Pose completate':`${count} di ${ids.length}`;$('stepCount').textContent=`DOPO · SCATTO ${Math.max(1,at+1)} DI ${ids.length}`;}
 [...$('poseList').children].forEach((li,i)=>{li.hidden=!ids.includes(POSES[i].id);});
 $('prevPose').disabled=at<=0||!!pending;$('nextPose').disabled=at===ids.length-1||!!pending;
};
function poseChoices(container,ids){container.replaceChildren(...ids.map(id=>{const label=document.createElement('label');label.className='check';const input=document.createElement('input');input.type='checkbox';input.value=id;input.checked=true;const span=document.createElement('span');span.textContent=POSES.find(p=>p.id===id).title;label.append(input,span);return label;}));}
function checkedPoses(id){return [...$(id).querySelectorAll('input:checked')].map(i=>i.value);}
$('repeatPhotos').addEventListener('click',()=>{if(!readyToNavigate())return;poseChoices($('repeatChoices'),FLOW_POSES.filter(p=>visits[0].photos.has(p.id)).map(p=>p.id));$('repeatTreatment').value=$('treatment').value;$('repeatDialog').showModal();});
$('cancelRepeat').addEventListener('click',()=>$('repeatDialog').close());
$('beginRepeat').addEventListener('click',()=>{
 const ids=checkedPoses('repeatChoices');if(!ids.length){notify('Scegli almeno una posa.');return;}if(!readyToNavigate())return;
 rememberVisit();let index=activeVisit>0&&!photos.size?activeVisit:visits.length;
 if(index===visits.length){if(visits.length>=20){notify('Massimo 20 visite per archivio.');return;}visits.push({id:crypto.randomUUID(),date:localDate(),phase:'followup',photos:new Map()});}
 const v=visits[index];v.selected=ids;v.phase=$('repeatPhase').value;v.treatment=$('repeatTreatment').value.trim();lastFollowup=index;compareB=index;revision++;$('repeatDialog').close();setView('after');
});
function pairedPoses(){return compareA!==compareB?POSES.filter(p=>visits[compareA]?.photos.has(p.id)&&visits[compareB]?.photos.has(p.id)).map(p=>p.id):[];}
function patientNavigation(){const ids=pairedPoses(),at=ids.indexOf(comparePose);$('patientPoseLabel').textContent=POSES.find(p=>p.id===comparePose)?.title||'';$('patientPrev').disabled=at<=0;$('patientNext').disabled=at<0||at>=ids.length-1;}
function exitPatientMode(){document.body.classList.remove('patient-mode');$('patientNavigation').hidden=true;}
$('patientMode').addEventListener('click',()=>{const ids=pairedPoses();if(!ids.length){notify('Serve almeno una posa presente in due visite diverse.');return;}if(!ids.includes(comparePose))comparePose=ids[0];comparisonLayout='slider';customSlots=[];document.body.classList.add('patient-mode');$('patientNavigation').hidden=false;renderComparison();});
$('exitPatientMode').addEventListener('click',exitPatientMode);window.addEventListener('keydown',e=>{if(e.key==='Escape')exitPatientMode();});
for(const [button,delta]of [['patientPrev',-1],['patientNext',1]])$(button).addEventListener('click',()=>{const ids=pairedPoses(),next=ids.indexOf(comparePose)+delta;if(ids[next]){comparePose=ids[next];customSlots=[];renderComparison();}});
const comparisonBeforePatient=renderComparison;renderComparison=function(){comparisonBeforePatient();patientNavigation();$('pdfCompare').disabled=!pairedPoses().length;$('patientMode').disabled=!pairedPoses().length;};
$('pdfCompare').addEventListener('click',()=>{const ids=pairedPoses();if(!ids.length)return;poseChoices($('pdfChoices'),ids);$('pdfDates').textContent=`${visitLabel(compareA)} → ${visitLabel(compareB)}`;$('pdfStatus').textContent='';$('pdfDialog').showModal();});
$('cancelPdf').addEventListener('click',()=>$('pdfDialog').close());
// Standard PDF container. The JPEG pages contain the unretouched photographs and captions.
function buildPhotoPDF(pages){
 const enc=new TextEncoder(),chunks=[],offsets=[0];let length=0;const add=x=>{const b=typeof x==='string'?enc.encode(x):x;chunks.push(b);length+=b.length;};
 add('%PDF-1.4\n');const obj=(id,parts)=>{offsets[id]=length;add(`${id} 0 obj\n`);parts.forEach(add);add('\nendobj\n');};
 obj(1,['<< /Type /Catalog /Pages 2 0 R >>']);obj(2,[`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`]);
 pages.forEach((page,i)=>{const id=3+i*3;obj(id,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Photo ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`]);obj(id+1,[`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,page.bytes,'\nendstream']);const content='q 842 0 0 595 0 0 cm /Photo Do Q';obj(id+2,[`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`]);});
 const start=length;add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);for(const o of offsets.slice(1))add(`${String(o).padStart(10,'0')} 00000 n \n`);add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);return new Blob(chunks,{type:'application/pdf'});
}
function wrapText(ctx,text,x,y,maxWidth,lineHeight,maxLines){let line='',row=0;for(const word of text.split(/\s+/)){const next=line?line+' '+word:word;if(ctx.measureText(next).width>maxWidth&&line){ctx.fillText(line,x,y+row*lineHeight);line=word;if(++row>=maxLines)return;}else line=next;}if(row<maxLines)ctx.fillText(line,x,y+row*lineHeight);}
function drawPDFComparisonPanels(ctx,images,labels,treatments){
 const x=[60,592,1124],y=244,w=500,h=667;
 for(let j=0;j<3;j++){ctx.fillStyle='#25252d';ctx.font='bold 26px sans-serif';ctx.fillText(['PRIMA','DOPO','METÀ / METÀ'][j],x[j],224);ctx.fillStyle='#f0f1f4';ctx.fillRect(x[j],y,w,h);
 if(j<2)drawContain(ctx,images[j],x[j],y,w,h,1);else drawHalfComparison(ctx,images[0],images[1],x[j],y,w,h);
 ctx.fillStyle='#25252d';ctx.font='bold 23px sans-serif';wrapText(ctx,j<2?labels[j]:'Sinistra: prima · Destra: dopo',x[j],950,w,27,2);
 ctx.font='22px sans-serif';wrapText(ctx,j<2?'Trattamento: '+treatments[j]:'Taglio centrale al 50%. Le due immagini mantengono le stesse proporzioni.',x[j],1015,w,27,3);
 }
}
function drawPDFComparisonPage(ctx,images,info){
 ctx.fillStyle='#fff';ctx.fillRect(0,0,1684,1190);ctx.fillStyle='#b82c68';ctx.font='bold 40px sans-serif';ctx.fillText('Healthy Smile',60,70);ctx.fillStyle='#25252d';ctx.font='26px sans-serif';ctx.fillText('PRIMA E DOPO',1250,70);ctx.font='bold 30px sans-serif';wrapText(ctx,info.patient,60,122,1550,34,2);ctx.font='26px sans-serif';ctx.fillText(info.pose,60,178);
 drawPDFComparisonPanels(ctx,images,info.labels,info.treatments);
 ctx.fillStyle='#686870';ctx.font='20px sans-serif';if(info.brightnessNote)ctx.fillText(info.brightnessNote,60,1125);ctx.fillText(info.aligned?'Inquadrature allineate (scala, rotazione, posizione) · Originali conservati':info.brightnessNote?'Luminosità uniforme regolata · Originali conservati':'Fotografie senza ritocchi · Posa e luce possono influenzare il confronto',60,1160);ctx.fillText(`${info.page} / ${info.total}`,1520,1160);
}
$('downloadPdf').addEventListener('click',async()=>{
 if(typeof ensureAlignmentViews==='function'&&await ensureAlignmentViews()===false)return;
 const ids=checkedPoses('pdfChoices');if(!ids.length){$('pdfStatus').textContent='Seleziona almeno una coppia.';return;}
 const selected=ids.map(id=>({id,a:snapshot(`${compareA}|${id}`),b:snapshot(`${compareB}|${id}`)}));if(selected.some(p=>!p.a.photo||!p.b.photo))return;
 const labels=[visitLabel(compareA),visitLabel(compareB)],treatments=[visits[compareA].treatment||'Non annotato',visits[compareB].treatment||'Non annotato'],patient=typeof cloud!=='undefined'&&cloud.patient?`${cloud.patient.name?cloud.patient.name+' · ':''}${cloud.patient.code}`:$('patientCode').value;
 $('downloadPdf').disabled=true;$('cancelPdf').disabled=true;$('pdfStatus').textContent='Preparazione PDF…';const pages=[];
 try{for(let i=0;i<selected.length;i++){
  const pair=selected[i],canvas=document.createElement('canvas');canvas.width=1684;canvas.height=1190;
  const images=await Promise.all([pair.a,pair.b].map(s=>loadedComparisonImage(s.photo)));
  drawPDFComparisonPage(canvas.getContext('2d'),images,{patient,pose:POSES.find(p=>p.id===pair.id).title,labels,treatments,brightnessNote:brightnessSummary([pair.a.photo,pair.b.photo]),aligned:!!(pair.a.photo.alignment||pair.b.photo.alignment),page:i+1,total:selected.length});
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Impossibile preparare la pagina.')),'image/jpeg',.92));pages.push({bytes:new Uint8Array(await blob.arrayBuffer()),width:canvas.width,height:canvas.height});canvas.width=0;canvas.height=0;
 }
 download(buildPhotoPDF(pages),`${safeName($('patientCode').value)}_prima_dopo.pdf`);$('pdfStatus').textContent='PDF preparato. Verifica il file in Download / File.';
 }catch(e){$('pdfStatus').textContent='PDF non creato. Mantieni aperta la pagina e riprova.';}finally{$('downloadPdf').disabled=false;$('cancelPdf').disabled=false;}
});
render();
