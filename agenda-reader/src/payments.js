const clean=v=>String(v??'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').trim();
function cents(value){
 let s=value.replace(/\s/g,'');
 if(s.includes(',')&&s.includes('.')){if(s.lastIndexOf(',')>s.lastIndexOf('.'))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');}
 else if(s.includes(','))s=/^\d{1,3}(,\d{3})+$/.test(s)?s.replace(/,/g,''):s.replace(',','.');
 else if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
 if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;
 const n=Math.round(Number(s)*100);return Number.isSafeInteger(n)?n:null;
}
function amounts(text,field=false){
 const result=[];
 const re=/(?:€|\bEUR\b)\s*(\d+(?:[.,]\d+)*)|(\d+(?:[.,]\d+)*)\s*(?:€|\bEUR\b)/gi;
 for(const m of text.matchAll(re)){const n=cents(m[1]||m[2]);if(n!==null)result.push(n);}
 if(field&&!result.length&&/^\d+(?:[.,]\d+)*$/.test(text)){const n=cents(text);if(n!==null)result.push(n);}
 return [...new Set(result)];
}
export function paymentFor(event){
 const title=clean(event.title),field=clean(event.who);
 const a=amounts(field,true),b=amounts(title);
 const noField=!field||/^[-–—]$/.test(field);
 const paid=/\b(?:pagat[oaie]|saldat[oaie]|incassat[oaie]|ricevut[oaie])\b|nessun saldo/i;
 const noDebt=/^(?:no|zero|nessun saldo|pagato|saldato)$/i.test(field);
 const due=/\b(?:pagare|saldo|non saldato|non pagato|da saldare)\b/i;
 if(!a.length&&!b.length&&!due.test(title)&&noField)return null;
 if(noDebt&&!b.some(n=>n>0))return null;
 const reasons=[];
 if(a.length>1||b.length>1)reasons.push('Più importi: verificare quale resta da pagare');
 if(a.length===1&&b.length===1&&a[0]!==b[0])reasons.push('Importi discordanti');
 if(!noField&&!a.length&&!noDebt)reasons.push('Campo Deve pagare non numerico');
 if(noDebt&&b.some(n=>n>0))reasons.push('Campo e titolo discordanti');
 if(paid.test(title)||paid.test(field))reasons.push('È indicato anche un pagamento: verificare il residuo');
 const n=a.length===1?a[0]:b.length===1?b[0]:null;
 if(n===null)reasons.push('Importo da specificare');
 if(n===0&&!reasons.length)return null;
 return {event_id:String(event.id),appointment:title,start_dt:event.start_dt,all_day:!!event.all_day,field_text:field,title_amounts:b.map(n=>n/100),amount_due:reasons.length?null:n/100,status:reasons.length?'review':'due',reason:reasons.join('; '),source:a.length&&b.length?'Deve pagare e titolo':a.length?'Deve pagare':'Titolo'};
}
export function readPayments(raw,records){
 const appointments=new Set(records.filter(r=>r.kind==='appointment').map(r=>r.event_id));
 const seen=new Set(),out=[];
 for(const e of raw){const id=String(e.id);if(e.delete_dt||!appointments.has(id)||seen.has(id))continue;seen.add(id);const p=paymentFor(e);if(p)out.push(p);}
 return out.sort((a,b)=>String(a.start_dt).localeCompare(String(b.start_dt)));
}
