const http = require('http');

function req(method, path, data){
  const opts = { hostname: 'localhost', port: 3000, path, method, headers: { 'Content-Type': 'application/json' } };
  return new Promise((resolve, reject)=>{
    const r = http.request(opts, res=>{
      let body='';
      res.on('data', c=> body+=c);
      res.on('end', ()=>{
        try{ const json = JSON.parse(body); resolve({ status: res.statusCode, body: json }); } catch(e){ resolve({ status: res.statusCode, body }); }
      });
    });
    r.on('error', reject);
    if(data) r.write(JSON.stringify(data));
    r.end();
  });
}

(async ()=>{
  try{
    console.log('CREATE CLASS');
    const created = await req('POST','/api/classes', { name: 'TEST_CLASS_DELETE' });
    console.log(created);
    const classId = created.body && created.body.id;
    if(!classId){ console.error('Class id missing', created); process.exitCode = 1; return; }

    console.log('CREATE TEST');
    const testRes = await req('POST','/api/tests', { class_id: classId, name: 'Test for delete' });
    console.log(testRes);

    console.log('CREATE STUDENT');
    const studentRes = await req('POST','/api/students', { class_id: classId, name: 'student1' });
    console.log(studentRes);

    console.log('DELETE WITHOUT CASCADE');
    const deleteRes1 = await req('DELETE', '/api/classes/' + classId);
    console.log(deleteRes1);

    console.log('DELETE WITH CASCADE');
    const deleteRes2 = await req('DELETE', '/api/classes/' + classId + '?cascade=1');
    console.log(deleteRes2);

    console.log('CLASSES AFTER:');
    const after = await req('GET','/api/classes');
    console.log(after);
  }catch(e){ console.error('ERROR', e); process.exitCode=1; }
})();
