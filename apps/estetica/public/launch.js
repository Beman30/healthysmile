'use strict';
// A UX requirement, not an authentication boundary. Access and studio membership
// and application sessions are still checked on every server request. Browser mode loads no patient code.
(async()=>{
 const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 if(!installed){location.replace('/installa');return;}
 const scripts=["app.js?v=17", "workflow.js?v=16", "cloud.js?v=2", "presentation.js?v=15", "device.js?v=1", "alignment.js?v=17", "brightness.js?v=15", "position.js?v=19", "reference-contour.js?v=19", "sharing.js?v=15", "responsive.js?v=2", "install.js?v=4", "auth-ui.js?v=1"];
 try{
  const auth=await fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'});
  if(auth.status===401||auth.status===403){location.replace('/login');return;}
  if(!auth.ok)throw Error('Login unavailable');
  window.hsAccount=await auth.json();
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
