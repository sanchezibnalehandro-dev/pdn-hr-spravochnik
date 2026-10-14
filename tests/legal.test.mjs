import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

async function load(name) {
  const html = await readFile(new URL('../'+name, import.meta.url),'utf8');
  const src = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(src);
  const nodes = new Map();
  const document = {
    readyState: 'loading', addEventListener(){},
    querySelectorAll(){ return []; },
    getElementById(id){
      if(!nodes.has(id)) nodes.set(id,{value:'',innerHTML:'',textContent:'',style:{},
        classList:{add(){},remove(){},toggle(){},contains(){return false}},
        addEventListener(){}});
      return nodes.get(id);
    }
  };
  const window={};
  vm.runInNewContext(src,{window,document,console,Intl}, {filename:name});
  return {app:window.PdnHrApp,html,node:id=>document.getElementById(id)};
}

const expected = {
  no_basis:      {first:['1',50000,150000], repeat:['1.1',100000,300000]},
  no_consent:    {first:['2',100000,300000], repeat:['2.1',300000,1000000]},
  no_policy:     {first:['3',6000,30000],repeat:null},
  localization:  {first:['8',100000,1000000],repeat:['9',500000,6000000]},
  no_notify_processing:{first:['10',30000,100000],repeat:null},
  no_notify_incident:{first:['11',400000,1000000],repeat:null},
  leak_small:    {first:['12',200000,3000000],repeat:['15',800000,20000000]},
  leak_medium:   {first:['13',300000,5000000],repeat:['15',800000,20000000]},
  leak_large:    {first:['14',400000,10000000],repeat:['15',800000,20000000]},
  leak_special:  {first:['16',1000000,10000000],repeat:['18',1500000,25000000]},
  leak_biometric:{first:['17',1300000,15000000],repeat:['18',1500000,25000000]}
};

for (const page of ['index.html','wide.html']) {
  test(page+': all 11 sanctions match checked article and distinguish repetition',async()=>{
    const {app,html}=await load(page);
    for(const [key,rule] of Object.entries(expected)){
      const firstOfficer=app.selectSanction(key,'official',false);
      const firstLegal=app.selectSanction(key,'legal',false);
      assert.equal(firstOfficer.part,rule.first[0],key);
      assert.equal(firstOfficer.range[0],rule.first[1],key);
      assert.equal(firstLegal.range[0],rule.first[2],key);
      const after=app.selectSanction(key,'legal',true);
      if(rule.repeat){
        assert.equal(after.part,rule.repeat[0],key);
        assert.equal(after.specialRepeat,true,key);
        assert.equal(app.selectSanction(key,'official',true).range[0],rule.repeat[1],key);
        const companyFine=after.range.turnover?.[0]??after.range[0];
        assert.equal(companyFine,rule.repeat[2],key);
      } else {
        assert.equal(after.part,rule.first[0]);
        assert.equal(after.noSpecialRepeat,true);
      }
      assert.ok(html.includes('value="'+key+'"'),key+' visible');
    }
    assert.equal(html.includes('value="cross_border"'),false,'mislabelled cross-border offense removed');
  });

  test(page+': correct SME, IP and citizen classifications',async()=>{
    const {app}=await load(page);
    assert.equal(app.selectSanction('no_basis','sme',false).range[0],50000);
    assert.equal(app.selectSanction('no_consent','sme',true).range[0],500000);
    assert.equal(app.selectSanction('no_policy','sme',false).range[0],10000);
    assert.equal(app.selectSanction('localization','sme',false).range[0],1000000);
    assert.equal(app.selectSanction('leak_large','ip',true).range.turnover[0],20000000);
    assert.equal(app.selectSanction('leak_special','sme',true).range.turnover[0],25000000);
    assert.equal(app.selectSanction('leak_special','citizen',false).range[0],300000);
    assert.equal(app.selectSanction('leak_biometric','official',false).range[0],1300000);
    assert.equal(app.selectSanction('no_basis','citizen',false).range[0],10000);
  });

  test(page+': calculator outputs correct article for changed user input',async()=>{
    const {app,node}=await load(page);
    node('violation-type').value='localization';
    node('org-type').value='official';
    node('is-repeat').value='yes';
    app.calcFine();
    assert.match(node('calc-result').innerHTML,/ч\. 9 ст\. 13\.11/);
    assert.match(node('calc-result').innerHTML,/500/);
    node('violation-type').value='leak_biometric';
    node('org-type').value='legal';
    app.calcFine();
    assert.match(node('calc-result').innerHTML,/ч\. 18 ст\. 13\.11/);
    assert.match(node('calc-result').innerHTML,/1–3%/);
    assert.match(node('calc-result').innerHTML,/25/);
  });

  test(page+': no green-light to send HR data based only on document type',async()=>{
    const {app,html,node}=await load(page);
    app.wNext(1,'vacancy');
    assert.equal(node('w-verdict').style.display,'none');
    app.wNext(2,'fio_no');
    app.wNext(3,'sens_no');
    app.wNext(4,'qwen');
    assert.match(node('w-verdict').innerHTML,/Нужна проверка перед загрузкой/);
    assert.match(html,/Учебная маскировка не подтверждает/);
    assert.match(html,/14\.10\.2026/);
  });
}
