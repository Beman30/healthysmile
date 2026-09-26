'use strict';
// Installation changes only how the app opens. No service worker or offline
// patient cache: the app still requires its own authenticated session.
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
 const platform=isIOS?'ios':isAndroid?'android':'desktop';
 const help=document.getElementById('installHelp');
 function showGuide(){
  const guide=document.getElementById('install-'+platform);
  guide.hidden=false;guide.tabIndex=-1;guide.classList.add('install-guide-active');
  status.textContent=isIOS?'In Safari, tocca Condividi (il quadrato con la freccia verso l’alto), poi “Aggiungi alla schermata Home”.':'Segui i passaggi qui sotto per completare l’installazione dal menu del browser.';
  guide.focus({preventScroll:true});guide.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 function render(){
  const installed=isStandalone();
  if(installPage&&installed){location.replace('/');return;}
  if(button)button.textContent=installed?'App installata':'Installa sul telefono';
  status.textContent=installed?'Stai già usando la versione installata.':isIOS?'Su iPhone e iPad l’installazione si completa dal menu Condividi di Safari.':'Installa l’app, aprila dall’icona e inserisci username e password.';
  promptButton.hidden=installed;
  promptButton.textContent=isIOS?'Installa su iPhone / iPad':installPrompt?'Installa app':'Come installare l’app';
  promptButton.setAttribute('aria-controls','install-'+platform);
  if(help){help.hidden=installed;help.textContent=isIOS?'Il pulsante mostra i passaggi. La conferma finale si fa in Safari.':installPrompt?'Conferma l’installazione nella finestra del browser.':'Il pulsante mostra i passaggi per il tuo dispositivo.';}
  for(const type of ['ios','android','desktop'])document.getElementById('install-'+type).hidden=installed||type!==platform;
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
  const event=installPrompt;if(isIOS||!event){showGuide();return;}
  installPrompt=null;promptButton.disabled=true;
  try{
   await event.prompt();const choice=await event.userChoice;
   status.textContent=choice.outcome==='accepted'?'Installazione richiesta: segui la conferma del telefono.':'Installazione annullata. Per usare l’app, installala dal menu del browser e apri la nuova icona.';
  }catch{status.textContent='Apri il menu del browser e scegli “Installa app” o “Aggiungi alla schermata Home”.';}
  finally{promptButton.hidden=false;promptButton.disabled=false;promptButton.textContent='Come installare l’app';if(help)help.textContent='Puoi completare l’installazione dal menu del browser.';}
 });
 render();
})();
