const http = require('http');
const testId = process.argv[2] || 1;
const runs = parseInt(process.argv[3] || '5', 10);
function fetchQuestions(testId){
  return new Promise((resolve, reject)=>{
    http.get(`http://localhost:3000/api/tests/${testId}/questions`, (res)=>{
      let data = '';
      res.on('data', c=> data += c);
      res.on('end', ()=>{
        try{ resolve(JSON.parse(data)); }catch(e){ reject(e); }
      });
    }).on('error', reject);
  });
}
(async ()=>{
  for(let i=0;i<runs;i++){
    try{
      const j = await fetchQuestions(testId);
      const qids = (j||[]).map(q=>q.id);
      console.log('run', i+1, qids.join(','));
    }catch(e){ console.error('error', e.message); process.exit(1); }
  }
})();
