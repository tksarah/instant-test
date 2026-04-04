const http = require('http');

function req(method, path, data){
  const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json' } };
  return new Promise((resolve, reject)=>{
    const r = http.request(opts, res=>{
      let body='';
      res.on('data', c=> body+=c);
      res.on('end', ()=>{
        try{ const json = JSON.parse(body); resolve({status: res.statusCode, body: json}); } catch(e){ resolve({status: res.statusCode, body}); }
      });
    });
    r.on('error', reject);
    if(data) r.write(JSON.stringify(data));
    r.end();
  });
}

(async ()=>{
  try{
    console.log('GET tests for class 1');
    const tests = await req('GET','/api/tests?class_id=1');
    console.log(tests);
    if(!Array.isArray(tests.body) || tests.body.length===0){ console.log('No tests found'); return; }
    const t = tests.body[0];
    console.log('\nPUT toggle public for test', t.id);
    const newPublic = t.public ? 0 : 1;
    const putRes = await req('PUT', `/api/tests/${t.id}`, { name: t.name, description: t.description||'', public: newPublic, randomize: t.randomize||0 });
    console.log(putRes);
  }catch(e){ console.error('ERROR', e); process.exitCode=1; }
})();
