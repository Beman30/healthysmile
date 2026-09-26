'use strict';
(()=>{
 const get=id=>document.getElementById(id),status=message=>{if(get('authStatus'))get('authStatus').textContent=message;};
 async function request(path,data){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json','X-HS-Write':'1'},body:JSON.stringify(data)}:{})});
  let result;try{result=await response.json();}catch{throw Error('Accesso non disponibile. Riprova.');}
  if(!response.ok)throw Object.assign(Error(result.error||'Richiesta non riuscita.'),{status:response.status});return result;
 }
 for(const id of ['menuAccount','patientAccount'])get(id)?.addEventListener('click',async()=>{if(await safePatientChange())location.assign('/account');});
 const page=document.body.dataset.authPage;
 if(!page)return;
 const next=new URLSearchParams(location.search).get('next')==='account'?'/account':'/';
 get('loginForm')?.addEventListener('submit',async event=>{
  event.preventDefault();get('loginSubmit').disabled=true;status('Accesso…');
  try{await request('/api/auth/login',{username:get('username').value,password:get('password').value});get('password').value='';location.replace(next);}catch(e){status(e.message);}finally{get('loginSubmit').disabled=false;}
 });
 if(page!=='account')return;
 let me,recoveryAvailable=false,credentialsUsername=null;
 function showCredentials(data){
  credentialsUsername=data.username;
  get('credentialsText').value=`Username: ${data.username}\nPassword: ${data.password}\nInstalla: ${location.origin}/installa`;
  get('credentialsSection').hidden=false;get('credentialsText').style.height='auto';get('credentialsText').style.height=(get('credentialsText').scrollHeight+4)+'px';get('credentialsSection').scrollIntoView({block:'start'});
 }
 get('copyCredentials').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(get('credentialsText').value);status('Credenziali copiate.');}catch{get('credentialsText').focus();get('credentialsText').select();status('Seleziona Copia per conservare le credenziali.');}});
 get('dismissCredentials').addEventListener('click',()=>{get('credentialsText').value='';get('credentialsSection').hidden=true;credentialsUsername=null;});
 async function list(){
  const data=await request('/api/accounts');get('accountsList').replaceChildren(...data.accounts.map(account=>{
   const row=document.createElement('div');row.className='account-row';
   const title=document.createElement('strong');title.textContent=account.username;
   const detail=document.createElement('span');detail.textContent=`${account.studio_name} · ${account.is_admin?'Amministratore':account.active?'Attivo':'Sospeso'}`;row.append(title,detail);
   if(!account.is_admin){
    const toggle=document.createElement('button');toggle.className='secondary';toggle.textContent=account.active?'Sospendi accesso':'Riattiva accesso';
    toggle.onclick=async()=>{toggle.disabled=true;try{await request(`/api/accounts/${account.id}/active`,{active:!account.active});await list();status('Accesso aggiornato.');}catch(e){status(e.message);toggle.disabled=false;}};
    const reset=document.createElement('button');reset.className='secondary';reset.textContent='Nuova password';
    reset.onclick=async()=>{if(!confirm('Generare una nuova password? La precedente smetterà di funzionare e il tester dovrà accedere di nuovo.'))return;reset.disabled=true;try{showCredentials(await request(`/api/accounts/${account.id}/reset`,{}));status('Nuova password generata.');}catch(e){status(e.message);}finally{reset.disabled=false;}};row.append(toggle,reset);
    const remove=document.createElement('button');remove.className='secondary';remove.textContent='Elimina account';
    remove.onclick=async()=>{
     if(!confirm(`Eliminare l’account “${account.username}”? L’utente verrà disconnesso e le credenziali non funzioneranno più. Foto e pazienti restano conservati. Ricreando lo stesso username si otterrà un nuovo archivio vuoto.`))return;
     for(const button of row.querySelectorAll('button'))button.disabled=true;
     try{
      await request(`/api/accounts/${account.id}/delete`,{confirmUsername:account.username});
      if(credentialsUsername===account.username){get('credentialsText').value='';get('credentialsSection').hidden=true;credentialsUsername=null;}
      row.remove();await list();status(`Account “${account.username}” eliminato.`);
     }catch(e){status(e.message);for(const button of row.querySelectorAll('button'))button.disabled=false;}
    };row.append(remove);
   }return row;
  }));
 }
 async function load(){
  recoveryAvailable=false;
  try{const recovery=await request('/api/auth/recovery');recoveryAvailable=recovery.available;get('recoveryUsername').textContent=recovery.username;}catch{}
  get('recoverySection').hidden=!recoveryAvailable;
  try{me=await request('/api/auth/me');get('accountLabel').textContent=`${me.username} · ${me.studio.name}`;get('bootstrapSection').hidden=!me.setupAllowed;get('adminSection').hidden=!me.admin;get('logout').hidden=!!me.setupAllowed;status('');if(me.admin)await list();}
  catch(e){if(e.status===401||e.status===403){if(recoveryAvailable){status('Puoi recuperare il tuo account con l’accesso verificato.');return;}location.replace('/login?next=account');return;}status(e.message);}
 }
 get('recoverPassword').addEventListener('click',async()=>{
  if(!get('credentialsSection').hidden){status('Conserva prima le credenziali già visualizzate.');get('credentialsSection').scrollIntoView();return;}
  if(!confirm('Generare una nuova password per il tuo account? La precedente smetterà di funzionare e gli altri dispositivi dovranno accedere nuovamente.'))return;
  const button=get('recoverPassword');button.disabled=true;status('Generazione della nuova password…');
  try{const data=await request('/api/auth/recovery',{});showCredentials(data);await load();status('Nuova password generata. Copiala e conservala prima di chiudere la pagina.');}catch(e){status(e.message);}finally{button.disabled=false;}
 });
 async function submit(form,path,data){const button=form.querySelector('button');button.disabled=true;status('Creazione…');try{const result=await request(path,data);await load();showCredentials(result);if(form.id==='createAccountForm')form.reset();status('Account creato. Conserva la password.');}catch(e){status(e.message);}finally{button.disabled=false;}}
 get('bootstrapForm').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'/api/auth/bootstrap',{username:get('ownerUsername').value});});
 get('createAccountForm').addEventListener('submit',e=>{e.preventDefault();if(!get('credentialsSection').hidden){status('Conserva prima le credenziali appena create.');get('credentialsSection').scrollIntoView();return;}submit(e.currentTarget,'/api/accounts',{username:get('testerUsername').value,name:get('testerName').value});});
 get('logout').addEventListener('click',async()=>{try{await request('/api/auth/logout',{});location.replace('/login');}catch(e){status(e.message);}});
 load();
})();
