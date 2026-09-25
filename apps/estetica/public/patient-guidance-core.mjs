// Patient coordinates: the live preview and saved photos are never mirrored.
export const deltaAngle=(a,b)=>((a-b+540)%360)-180;
export function measureFace(result,width,height){
 const faces=result.faceLandmarks||[];
 if(faces.length!==1)return {error:faces.length?'Inquadra una sola persona':'Non vedo bene il viso'};
 const p=faces[0],m=result.facialTransformationMatrixes?.[0]?.data;
 if(!m||m.length!==16||!p[263]||p.some(v=>!Number.isFinite(v.x)||!Number.isFinite(v.y)))return {error:'Viso non rilevato con sufficiente precisione'};
 const a=p[33],b=p[263],dx=(b.x-a.x)*width,dy=(b.y-a.y)*height;
 const size=Math.hypot(dx,dy)/width;
 const yaw=Math.atan2(-m[2],Math.hypot(m[0],m[1]))*180/Math.PI;
 const pitch=Math.atan2(m[6],m[10])*180/Math.PI;
 const roll=Math.atan2(dy,dx)*180/Math.PI;
 if(![yaw,pitch,roll,size].every(Number.isFinite)||size<.025)return {error:'Viso non rilevato con sufficiente precisione'};
 const xs=p.map(v=>v.x),ys=p.map(v=>v.y);
 return {cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,size,yaw,pitch,roll,
  clipped:Math.min(...xs)<.02||Math.max(...xs)>.98||Math.min(...ys)<.02||Math.max(...ys)>.98};
}
export function patientInstruction(live,target){
 if(live.error)return {key:'missing',text:live.error,detail:'Luce sul viso e obiettivo libero. Puoi comunque scattare.'};
 if(live.clipped)return {key:'clipped',text:'Allontanati un poco',detail:'Tieni tutto il viso nel riquadro.'};
 if(Math.abs(live.yaw)>55||Math.abs(live.pitch)>35)return {key:'unreliable',text:'Torna verso la posizione del riferimento',detail:'Con questa inclinazione la guida non è affidabile: usa la trasparenza.'};
 const yaw=deltaAngle(live.yaw,target.yaw),pitch=deltaAngle(live.pitch,target.pitch),roll=deltaAngle(live.roll,target.roll);
 // Correct orientation before estimating distance from eye spacing.
 if(Math.abs(yaw)>5)return {key:'yaw'+Math.sign(yaw),text:'Gira il viso verso la tua '+(yaw>0?'destra':'sinistra'),detail:'Ruota lentamente, senza inclinare la testa.'};
 if(Math.abs(pitch)>5)return {key:'pitch'+Math.sign(pitch),text:pitch>0?'Solleva un poco il mento':'Abbassa un poco il mento',detail:'Un piccolo movimento, poi fermati.'};
 if(Math.abs(roll)>4)return {key:'roll'+Math.sign(roll),text:'Inclina la testa verso la tua '+(roll>0?'destra':'sinistra'),detail:'Avvicina leggermente l’orecchio alla spalla, senza girare il viso.'};
 const scale=live.size/target.size;
 if(scale>1.09||scale<.91)return {key:scale>1?'away':'closer',text:scale>1?'Allontanati un poco':'Avvicinati un poco',detail:'Mantieni la testa nella stessa posizione, senza cambiare zoom.'};
 if(Math.abs(live.cx-target.cx)>.035)return {key:'x'+Math.sign(live.cx-target.cx),text:'Spostati un poco alla tua '+(live.cx>target.cx?'destra':'sinistra'),detail:'Sposta anche il busto, senza girare la testa.'};
 if(Math.abs(live.cy-target.cy)>.035)return {key:'y'+Math.sign(live.cy-target.cy),text:live.cy>target.cy?'Portati un poco più in alto':'Portati un poco più in basso',detail:'Mantieni l’inclinazione. Se serve, l’operatore regola l’altezza della fotocamera.'};
 return {key:'okay',text:'Posizione simile: resta fermo',detail:'L’operatore controlla espressione e luce, poi scatta.',okay:true};
}
export function targetForPose(pose,scale=.7){
 return {cx:.5,cy:165/400,size:76/300*scale,yaw:pose.kind==='oblique'?(pose.flip?-35:35):0,pitch:0,roll:0};
}
