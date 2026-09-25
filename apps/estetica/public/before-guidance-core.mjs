// Suggested frontal framing and model pose tolerances, not a clinical calibration.
export function beforePoseState(face,{level=null,phoneConfirmed=false,screenAngle=0,kind='front'}={}){
 const good=text=>({okay:true,text}),bad=text=>({okay:false,text});
 const portrait=((screenAngle%360)+360)%360===0;
 const sensor=level&&Number.isFinite(level.roll)&&Number.isFinite(level.pitch);
 const phone=phoneConfirmed&&portrait&&(!sensor||(Math.abs(level.roll)<=3&&Math.abs(level.pitch)<=3));
 const checks={phone:phone?good(sensor?'Telefono in bolla':'Verificato da te'):bad(!portrait?'Telefono verticale':!phoneConfirmed?'Verifica telefono e altezza':'Raddrizza il telefono'),distance:bad('Da leggere'),eyes:bad('Da leggere'),center:bad('Da leggere'),yaw:bad('Da leggere'),chin:bad('Da leggere')};
 if(kind!=='front')return {checks,ready:false,key:'side',text:'Segui la posa di questa vista',detail:'La stima frontale non si applica a tre quarti e profili. Mantieni telefono dritto, sguardo orizzontale e testa naturale.'};
 const usable=face&&!face.error&&['cx','cy','size','roll','yaw','pitch'].every(k=>Number.isFinite(face[k]))&&face.size>.025;
 if(!usable)return {checks,ready:false,key:'missing',text:!phone?'Prepara la fotocamera':face?.error||'Inquadra un solo viso',detail:!phone?'Lente all’altezza degli occhi. Apri «Postazione» e conferma il controllo.':'Illumina il viso e lascia visibili entrambi gli occhi.'};
 const orientation=Math.abs(face.yaw)<=8&&Math.abs(face.pitch)<=12;
 checks.distance=face.clipped?bad('Allontanati'):!orientation?bad('Prima orienta il viso'):face.size<.30?bad('Avvicinati'):face.size>.42?bad('Allontanati'):good('Inquadratura adeguata');
 checks.eyes=Math.abs(face.roll)>3?bad('Raddrizza la testa'):!Number.isFinite(face.eyeOpen)||face.eyeOpen<.12?bad('Apri gli occhi'):good('Occhi aperti e in piano');
 checks.center=Math.abs(face.cx-.5)>.035?bad(face.cx>.5?'Alla tua destra':'Alla tua sinistra'):Math.abs(face.cy-.36)>.045?bad(face.cy>.36?'Più in alto':'Più in basso'):good('Viso centrato');
 checks.yaw=Math.abs(face.yaw)>4?bad('Gira verso la tua '+(face.yaw>0?'destra':'sinistra')):good('Frontale stimata');
 checks.chin=Math.abs(face.pitch)>5?bad(face.pitch>0?'Solleva il mento':'Abbassa il mento'):good('Mento in posizione');
 const ready=Object.values(checks).every(c=>c.okay);
 const key=!phone?'phone':!orientation?'orientation':!checks.distance.okay?'distance':!checks.eyes.okay?'eyes':!checks.center.okay?'center':!checks.yaw.okay?'yaw':!checks.chin.okay?'chin':'ready';
 const text=key==='phone'?'Verifica la postazione':key==='orientation'?(!checks.yaw.okay?checks.yaw.text:checks.chin.text):key==='ready'?'Posa frontale vicina: resta fermo':checks[key].text;
 return {checks,ready,key,text,detail:key==='phone'?'Lente all’altezza degli occhi e telefono verticale. Non compensare inclinando la testa.':key==='ready'?'Mantieni espressione e sguardo verso l’obiettivo. Tutti i controlli restano attivi.':'Muoviti lentamente. La guida stima la posa; non forzare le asimmetrie naturali del viso.'};
}
export function faceSharpness(data,width,height,face){
 // Laplacian variance within the facial region, excluding most background detail.
 if(!face||face.error)return 0;
 const x0=Math.max(1,Math.floor((face.cx-face.size*.7)*width)),x1=Math.min(width-1,Math.ceil((face.cx+face.size*.7)*width));
 const y0=Math.max(1,Math.floor((face.cy-face.size*.35)*height)),y1=Math.min(height-1,Math.ceil((face.cy+face.size*.65)*height));
 const gray=(x,y)=>{const i=(y*width+x)*4;return .299*data[i]+.587*data[i+1]+.114*data[i+2];};
 let n=0,sum=0,squares=0;
 for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){const v=gray(x-1,y)+gray(x+1,y)+gray(x,y-1)+gray(x,y+1)-4*gray(x,y);n++;sum+=v;squares+=v*v;}
 return n?Math.max(0,squares/n-(sum/n)**2):0;
}
