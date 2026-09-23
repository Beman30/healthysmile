'use strict';
// Installation changes only how the app opens. No service worker or offline
// patient cache: requests continue through the existing Cloudflare Access login.
(() => {
 const button=document.getElementById('menuInstall');
 const dialog=document.getElementById('installDialog');
 const installPage=document.body.classList.contains('install-page');
 const promptButton=document.getElementById('installNow');
 const status=document.getElementById('installStatus');
 const standalone=matchMedia('(display-mode: standalone)');
 let installPrompt=null;
 const isStandalone=()=>standalone.matches||navigator.standalone===true;
 const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const isAndroid=/Android/.test(navigator.userAgent);
 function render(){
  const installed=isStandalone();
  if(installPage&&installed){location.replace('/');return;}
  if(button)button.textContent=installed?'App installata':'Installa sul telefono';
  status.textContent=installed?'Stai già usando la versione installata.':'Per usare Healthy Smile Foto devi installarla e aprirla dalla sua icona.';
  promptButton.hidden=installed||!installPrompt;
  for(const type of ['ios','android','desktop'])document.getElementById('install-'+type).hidden=installed||(type!==(isIOS?'ios':isAndroid?'android':'desktop'));
 }
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;render();});
 window.addEventListener('appinstalled',()=>{
  installPrompt=null;render();
  status.textContent='Installazione completata. Apri Healthy Smile Foto dalla nuova icona.';
 });
 standalone.addEventListener('change',render);
 button?.addEventListener('click',()=>{render();dialog.showModal();});
 document.getElementById('closeInstall')?.addEventListener('click',()=>dialog.close());
 dialog?.addEventListener('close',()=>document.getElementById('menuToggle').focus({preventScroll:true}));
 promptButton.addEventListener('click',async()=>{
  const event=installPrompt;if(!event)return;
  installPrompt=null;promptButton.disabled=true;
  try{
   await event.prompt();const choice=await event.userChoice;
   status.textContent=choice.outcome==='accepted'?'Installazione richiesta: segui la conferma del telefono.':'Installazione annullata. Per usare l’app, installala dal menu del browser e apri la nuova icona.';
  }catch{status.textContent='Apri il menu del browser e scegli “Installa app” o “Aggiungi alla schermata Home”.';}
  finally{promptButton.hidden=true;promptButton.disabled=false;}
 });
 render();
})();
