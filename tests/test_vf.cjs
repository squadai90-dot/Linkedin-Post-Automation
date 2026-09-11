const fs=require('fs');
eval(fs.readFileSync('tests/vf_test_src.js','utf8'));
const a=(c,m)=>{ if(!c){console.error('FAIL:',m);process.exitCode=1;} else console.log('ok:',m); };
const ctx={cy:2024,py:2023};
// P&L: one CY value -> books exactly that, PY ignored
let r=vF({label:'Sales',values:[9703,15965],years:[2024,2023]},false,ctx,'pdf');
a(Array.isArray(r)&&r.length===1&&r[0].field==='amount'&&r[0].value===9703&&r[0].year===2024,'P&L books ONLY the current-year value (PY ignored)');
// P&L: duplicate CY values -> ambiguous (refused), never summed
r=vF({label:'Sales',values:[594684,2290116],years:[2024,2024]},false,ctx,'pdf');
a(r==='ambiguous','P&L with two current-year values refuses instead of summing');
// P&L: only PY tagged -> refuses (the "Closing finished goods" case)
r=vF({label:'Closing finished goods',values:[22727],years:[2023]},false,ctx,'pdf');
a(Array.isArray(r)&&r.length===0,'P&L with only a prior-year value refuses');
// BS: CY+PY -> eoy + boy
r=vF({label:'Cash',values:[11783,9500],years:[2024,2023]},true,ctx,'pdf');
a(r.length===2&&r.find(x=>x.field==='eoy'&&x.value===11783)&&r.find(x=>x.field==='boy'&&x.value===9500),'Balance sheet books current year (eoy) AND previous year (boy)');
// BS: duplicate CY -> ambiguous
r=vF({label:'Cash',values:[100,200],years:[2024,2024]},true,ctx,'pdf');
a(r==='ambiguous','BS with two current-year values refuses');
// BS: CY ok but duplicate PY -> eoy only, boy skipped
r=vF({label:'Cash',values:[100,50,60],years:[2024,2023,2023]},true,ctx,'pdf');
a(Array.isArray(r)&&r.length===1&&r[0].field==='eoy'&&r[0].value===100,'BS with ambiguous prior year books CY only, leaves boy empty');
// BS: CY only, no PY -> eoy only
r=vF({label:'New account',values:[500],years:[2024]},true,ctx,'pdf');
a(r.length===1&&r[0].field==='eoy','BS with only CY books eoy alone');
// untagged single-column statement still books (single-column P&L IS the current year)
r=vF({label:'Rent',values:[1200],years:null},false,ctx,'pdf');
a(Array.isArray(r)&&r.length===1&&r[0].field==='amount'&&r[0].value===1200,'untagged single value still books');
// untagged multi-value -> ambiguous (unchanged)
r=vF({label:'Rent',values:[1200,1100],years:null},false,ctx,'pdf');
a(r==='ambiguous','untagged multi-value still refuses');
// grid conventions unchanged: IS last column only; BS last=eoy, prev=boy
r=vF({label:'Sales',values:[100,200,300],years:null},false,ctx,'grid');
a(r.length===1&&r[0].value===300,'grid P&L takes only the last (current) column');
r=vF({label:'Cash',values:[80,90],years:null},true,ctx,'grid');
a(r.length===2&&r[0].value===90&&r[1].value===80,'grid BS takes last=eoy, previous=boy');
// no-cy fallback: max tagged year treated as current
r=vF({label:'Sales',values:[7,8],years:[2022,2021]},false,{cy:null,py:null},'pdf');
a(r.length===1&&r[0].value===7&&r[0].year===2022,'without case year, newest tagged year is current');
// 13-15: balance-sheet rows carrying ONLY a prior-year figure still populate column D.
// Real case: Keystone "Structural Improvements" 2024 blank / 2023 150,928 — the opening
// balance is genuine Schedule F column D data and must not be discarded.
{
  const r = vF({ label: "Structural Improvements", values: [150928], years: [2023] }, true, ctx, "pdf");
  a(Array.isArray(r) && r.length === 1 && r[0].field === "boy" && r[0].value === 150928 && r[0].year === 2023,
    "BS row with only a prior-year value books boy (was previously dropped)");
}
{
  const r = vF({ label: "Sundry expenses", values: [4361], years: [2023] }, false, ctx, "pdf");
  a(Array.isArray(r) && r.length === 0,
    "P&L row with only a prior-year value is still refused (unchanged)");
}
{
  const r = vF({ label: "Less: Accumulated depreciation", values: [-45760], years: [2023] }, true, ctx, "pdf");
  a(Array.isArray(r) && r.length === 1 && r[0].field === "boy" && r[0].value === -45760,
    "BS prior-year-only negative keeps its sign into boy");
}
{
  const r = vF({ label: "Odd", values: [1, 2], years: [2023, 2023] }, true, ctx, "pdf");
  a(Array.isArray(r) && r.length === 0,
    "BS with no CY and TWO prior-year values still refuses (ambiguous opening balance)");
}

console.log(process.exitCode?'TESTS FAILED':'ALL 16 vF RULE TESTS PASSED');
