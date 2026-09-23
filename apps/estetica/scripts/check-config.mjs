import {readFile} from 'node:fs/promises';
let c;try{c=JSON.parse(await readFile('wrangler.local.json','utf8'));}catch{throw Error('Configura prima le risorse del tuo account: npm run configure -- deployment.local.json');}
if(!c.account_id&&!process.env.CLOUDFLARE_ACCOUNT_ID)throw Error('Imposta CLOUDFLARE_ACCOUNT_ID per scegliere esplicitamente l’account Cloudflare.');
if(!c.assets?.run_worker_first||c.workers_dev!==false||c.preview_urls!==false||!c.vars?.ACCESS_AUD||!c.d1_databases?.[0]?.database_id||!c.r2_buckets?.[0]?.bucket_name)throw Error('Configurazione cloud incompleta.');
console.log('Configurazione pronta per Cloudflare.');
