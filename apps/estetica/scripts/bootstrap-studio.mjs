import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const [email,name='Healthy Smile']=process.argv.slice(2);
if(!email||!/^\S+@\S+\.\S+$/.test(email)||name.length>100)throw Error('Uso: node scripts/bootstrap-studio.mjs email-operatore "Nome studio"');
const quote=v=>"'"+v.replaceAll("'","''")+"'",id=randomUUID();
const sql=`BEGIN TRANSACTION;\nINSERT INTO studios (id,name,created) VALUES (${quote(id)},${quote(name)},${quote(new Date().toISOString())});\nINSERT INTO studio_members (studio_id,email,role) VALUES (${quote(id)},${quote(email.toLowerCase())},'owner');\nCOMMIT;\n`;
await writeFile('bootstrap.local.sql',sql,{flag:'wx',mode:0o600});
console.log('Creato bootstrap.local.sql. Verifica il file e applicalo una sola volta al nuovo database. Non contiene password.');
