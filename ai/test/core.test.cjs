const {test}=require('node:test');const assert=require('node:assert/strict');
const C=require('../clinical-core.js');
const att=[{id:'sano',label:'Sano'},{id:'cariato',label:'Cariato'},{id:'frattura',label:'Frattura'},{id:'devitaliz',label:'Devitalizzato'}];
const plan=[{id:'restauro',label:'Restauro composito',scope:'TOOTH_LEVEL',prezzo:100},{id:'endo',label:'Endodonzia',scope:'TOOTH_LEVEL',prezzo:200},{id:'arc',label:'Protesi arcata',scope:'ARCH_LEVEL',prezzo:1500},{id:'quad',label:'Prestazione quadrante',scope:'QUADRANT_LEVEL',prezzo:130},{id:'tac',label:'TAC',scope:'SESSION_LEVEL',prezzo:50}];
const row=(id,target='12',extra={})=>({id_listino:id,target,label:id,qta:1,prezzo:100,status:'dafare',...extra});
const finding=(target='12')=>({target,description:'Carie distale',id_listino:'cariato',note:''});
const sel=(rows=[],findings=[finding()])=>({findings,treatments:rows});
test('v5 label is readable and invalid ID recovers by exact label',()=>{const n=C.normalize({terapie_da_attuare:{denti:{12:{terapie:[{id_listino:'inventato',label:'Restauro composito',qta:2}]}}}},att,plan);assert.equal(n.treatments[0].label,'Restauro composito');assert.equal(n.treatments[0].id_listino,'restauro');assert.equal(n.treatments[0].qta,2);});
test('ambiguous substring and missing labels do not select a random item',()=>{assert.equal(C.match([{id:'a',label:'Corona su impianto'},{id:'b',label:'Impianto'}],'','corona'),null);assert.equal(C.match(att,'','',true),null);});
test('multiple findings on one tooth survive',()=>{const n=C.normalize({findings:[finding(),{...finding(),description:'Frattura',id_listino:'frattura'}],treatments:[]},att,plan);const s=C.apply({},n,att,plan);assert.deepEqual(s.teethAttuale[12],['cariato','frattura']);assert.match(s.teethNote[12],/Frattura/);});
test('healthy convention preserves existing chart and excludes unconfirmed mentioned teeth',()=>{const s=C.apply({teethAttuale:{13:['devitaliz']}},sel([row('restauro')]),att,plan,['14']);assert.deepEqual(s.teethAttuale[11],['sano']);assert.deepEqual(s.teethAttuale[13],['devitaliz']);assert.equal(s.teethAttuale[14],undefined);});
test('unknown diagnostic category is retained as clinical note',()=>{const f={...finding(),id_listino:'',description:'Mobilità da valutare'};const s=C.apply({},sel([],[f]),att,plan);assert.equal(s.teethAttuale[12].length,0);assert.match(s.teethNote[12],/Mobilità/);});
test('arch and quadrant update actual odontogramma maps and quote',()=>{const s=C.apply({},sel([row('arc','AS'),row('quad','Q2'),row('tac','')]),att,plan);assert.equal(s.arcatePianoPresta.sup[0].tid,'arc');assert.equal(s.quadrantePiano.q2[0].tid,'quad');assert.deepEqual(s.prevRows.map(r=>r.dente),['AS','Q2','']);});
test('catalogued alternate quadrant scope is retained',()=>{const cat=[{id:'multi',label:'Multi',scope:'SESSION_LEVEL',allowed_scopes:['SESSION_LEVEL','QUADRANT_LEVEL']}];const s=C.apply({},sel([row('multi','Q1')]),att,cat);assert.equal(s.quadrantePiano.q1[0].tid,'multi');});
test('state transitions preserve multiple treatments and avoid duplicate charges',()=>{let s=C.apply({},sel([row('restauro'),row('endo')]),att,plan);s=C.apply(s,sel([row('restauro','12',{status:'incorso',qta:2,prezzo:120})]),att,plan);assert.equal(s.teethPiano[12].length,2);assert.equal(s.prevRows.length,2);assert.equal(s.prevRows[0].qta,2);assert.equal(s.teethPiano[12][0].stato,'incorso');});
test('completed treatment updates phase 2 without creating a quote',()=>{const s=C.apply({},sel([row('endo','12',{status:'eseguito'})]),att,plan);assert.equal(s.teethPiano[12][0].stato,'eseguito');assert.equal(s.prevRows.length,0);});
test('invalid targets, unknown IDs, duplicate rows and NaN cannot be applied',()=>{for(const rows of [[row('restauro','19')],[row('arc','')],[row('unknown')],[row('restauro'),row('restauro')],[row('restauro','12',{prezzo:NaN})]])assert.throws(()=>C.apply({},sel(rows),att,plan));});
test('memory relevance retrieves matching corrections beyond frequency top ten',()=>{const m=Array.from({length:30},(_,i)=>({input:'altro argomento '+i}));m.push({input:'carie distale',confirmed:{},id:'relevant'});assert.equal(C.relevant(m,'carie distale 12')[0].id,'relevant');assert.equal(C.relevant([{input:'carie',reusable:false}],'carie').length,0);});
test('applying an empty rejected proposal does not fill the whole chart',()=>{const s=C.apply({},sel([],[]),att,plan);assert.deepEqual(s.teethAttuale,{});});
test('unknown status removes prior healthy default and clinical notes prevent future healthy defaults',()=>{
 const s=C.apply({teethAttuale:{16:['sano']},teethNote:{25:'Da precisare'}},sel([],[{target:'16',description:'Terapia canalare da chiarire',id_listino:''}]),att,plan);
 assert.deepEqual(s.teethAttuale[16],[]);assert.equal(s.teethAttuale[25],undefined);assert.deepEqual(s.teethAttuale[11],['sano']);
 assert.match(C.clarificationIssues([{target:'16',id_listino:''}],[])[0],/Dente 16/);
});
const chainIds=['impianto_osteointegrabile','abutment','corona_zirconio_su_impianto','terapia_endodontica_pluricanal','ricostruzione_moncone_perno_in','corona_provvisoria_in_resina','corona_zirconio'];
const chainCatalog=chainIds.map(id=>({id,label:id,scope:'TOOTH_LEVEL',prezzo:100}));
test('implant and endodontic completion use distinct catalogued crowns, correct teeth and no automatic charges',()=>{
 const rows=[row(chainIds[0],'25'),row(chainIds[3],'16')];const out=C.completionSuggestions(rows,chainCatalog);
 assert.deepEqual(out.filter(s=>s.target==='25').map(s=>s.id_listino),chainIds.slice(1,3));assert.deepEqual(out.filter(s=>s.target==='16').map(s=>s.id_listino),chainIds.slice(4));assert.equal(rows.length,2);
});
test('completion skips existing, excluded, disabled and completed treatments and never substitutes an unrelated item',()=>{
 const rows=[row(chainIds[0],'25'),row(chainIds[3],'16',{status:'eseguito'})];
 assert.deepEqual(C.completionSuggestions(rows,chainCatalog,{teethPiano:{25:[{tid:'abutment',stato:'eseguito'}]}},[],[{target:'25',id_listino:'corona_zirconio_su_impianto'}]),[]);
 assert.deepEqual(C.completionSuggestions(rows,chainCatalog,{},[{rule_id:'path_implant',enabled:false}]),[]);
 const missing=C.completionSuggestions(rows,[{id:'abutment_zigomatico',label:'Abutment zigomatico'}]);assert.equal(missing.length,2);assert.ok(missing.every(s=>s.id_listino===''));
});
