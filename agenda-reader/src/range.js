export function dateRange(from,to,max=366){
 const parse=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Inserisci data iniziale e finale');const n=Date.parse(s+'T12:00:00Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==s)throw Error('Data non valida');return n;};
 const a=parse(from),b=parse(to),count=(b-a)/86400000+1;
 if(count<1)throw Error('La data finale precede quella iniziale');
 if(count>max)throw Error('Seleziona al massimo '+max+' giorni');
 return Array.from({length:count},(_,i)=>new Date(a+i*86400000).toISOString().slice(0,10));
}
export function paymentTotal(reports){
 let cents=0,review=0,missing=0;const seen=new Set();
 for(const r of reports){if(r.error||r.stale||!Array.isArray(r.payments)){missing++;continue;}
 for(const p of r.payments){const id=p.event_id+'|'+p.start_dt;if(seen.has(id))continue;seen.add(id);
 if(p.status!=='due'||!Number.isFinite(p.amount_due)){review++;continue;}
 cents+=Math.round(p.amount_due*100);
 }}
 return {amount:cents/100,review,missing};
}
