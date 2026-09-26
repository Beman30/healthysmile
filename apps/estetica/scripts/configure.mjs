import {writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function makeConfig(s){
 if(!/^[a-f0-9]{32}$/.test(s.accountId||'')||!/^[a-f0-9-]{36}$/.test(s.databaseId||''))throw Error('Servono gli identificativi reali Cloudflare di account e database.');
 if(!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(s.domain||''))throw Error('Dominio non valido.');
 if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(s.accessTeamDomain||'')||!/^[a-f0-9]{64}$/.test(s.accessAudience||''))throw Error('Configura prima l’applicazione Cloudflare Access.');
 if(!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(s.bucket||'')||!s.databaseName)throw Error('Database e archivio foto mancanti.');
 return {account_id:s.accountId,$schema:'./node_modules/wrangler/config-schema.json',name:s.workerName||'healthy-smile-estetica',main:'server/worker.mjs',compatibility_date:'2026-09-23',workers_dev:false,preview_urls:false,routes:[{pattern:s.domain,custom_domain:true}],assets:{directory:'./public',binding:'ASSETS',run_worker_first:true},d1_databases:[{binding:'DB',database_name:s.databaseName,database_id:s.databaseId,migrations_dir:'migrations'}],r2_buckets:[{binding:'BUCKET',bucket_name:s.bucket}],vars:{APP_ORIGIN:'https://'+s.domain,ACCESS_TEAM_DOMAIN:s.accessTeamDomain,ACCESS_AUD:s.accessAudience}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
const file=process.argv[2];if(!file)throw Error('Uso: npm run configure -- deployment.local.json');
const settings=JSON.parse(await readFile(file,'utf8'));
await writeFile('wrangler.local.json',JSON.stringify(makeConfig(settings),null,2)+'\n');console.log('Configurazione generata. Nessuna risorsa cloud è stata creata o modificata.');

}
