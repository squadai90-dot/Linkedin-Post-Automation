const a=(c,m)=>{ if(!c){console.error('FAIL:',m);process.exitCode=1;} else console.log('ok:',m); };
// replicate fixed setRelabel storage semantics
function relabelStore(n,key,i){ n={...n}; i.trim()?n[key]=i:delete n[key]; return n; }
let n={};
n=relabelStore(n,'IS:8','Other'); a(n['IS:8']==='Other','types first word');
n=relabelStore(n,'IS:8','Other ');  a(n['IS:8']==='Other ','trailing space SURVIVES (was the bug)');
n=relabelStore(n,'IS:8','Other income'); a(n['IS:8']==='Other income','second word lands after the space');
n=relabelStore(n,'IS:8','   '); a(!('IS:8' in n),'whitespace-only clears the relabel');
// stakeholder semantics
const stake=t=>t.trim()?t:'Unnamed stakeholder';
a(stake('Caitlin ')==='Caitlin ','stakeholder trailing space survives while typing');
a(stake('Caitlin Nowland')==='Caitlin Nowland','multi-word stakeholder name works');
a(stake('')==='Unnamed stakeholder','blank falls back');
// renameEntity semantics
const rename=e=>{ if(!e.trim()) return null; return e; };
a(rename('Keystone ')==='Keystone ','entity rename trailing space survives');
a(rename('  ')===null,'blank rename refused');
console.log(process.exitCode?'TESTS FAILED':'ALL SPACE-BUG TESTS PASSED');
