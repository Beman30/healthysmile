'use strict';
// A UX requirement, not an authentication boundary. Access and studio membership
// are still checked on every server request. Browser mode loads no patient code.
(async()=>{
 const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 if(!installed){location.replace('/installa');return;}
 const scripts=["app.js?v=15", "workflow.js?v=16", "cloud.js?v=2", "presentation.js?v=15", "device.js?v=1", "alignment.js?v=15", "brightness.js?v=15", "position.js?v=15", "sharing.js?v=15", "responsive.js?v=1", "install.js?v=2"];
 try{
  for(const src of scripts)await new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src='/'+src;
   script.onload=resolve;script.onerror=reject;document.body.append(script);
  });
  document.documentElement.removeAttribute('data-app-launching');
 }catch{
  // Leave no partially initialized camera controls usable after a failed load.
  document.body.replaceChildren();
  const message=document.createElement('p');message.textContent='Impossibile aprire l’app. Controlla la connessione e riprova.';
  const retry=document.createElement('button');retry.textContent='Riprova';retry.onclick=()=>location.reload();
  document.body.append(message,retry);document.documentElement.removeAttribute('data-app-launching');
 }
})();
