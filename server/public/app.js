(function(){
  const e = React.createElement;
  function renderQuestionList(items){
    if(!items || items.length === 0){
      return e('p', null, '（問題がありません）');
    }
    return e('ol', null, items.map(function(q){
      return e('li', { key: q.id },
        e('div', null, q.text),
        e('ul', null, (q.choices || []).map(function(c, index){
          return e('li', { key: c.id || index }, (c.text || c.name) + (c.is_correct ? ' （正解）' : ''));
        }))
      );
    }));
  }

  function renderModal(modalQuestions, handlers){
    if(!handlers.modalOpen){
      return null;
    }
    return e('div', {
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'modal-title',
      id: 'modal-overlay',
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }
    },
      e('div', {
        id: 'modal-content',
        tabIndex: -1,
        style: {
          background: '#fff',
          padding: 20,
          width: '90%',
          maxWidth: 900,
          maxHeight: '90%',
          overflowY: 'auto',
          borderRadius: 8
        }
      },
        e('h2', { id: 'modal-title' }, '生成された問題の編集'),
        modalQuestions.length === 0
          ? e('p', null, '（編集する問題がありません）')
          : e('div', null, modalQuestions.map(function(q, qi){
              return e('div', {
                key: q.id,
                style: { border: '1px solid #ddd', padding: 10, marginBottom: 8, borderRadius: 6 }
              },
                e('div', null, e('strong', null, '問題 ' + (qi + 1))),
                e('div', null,
                  e('input', {
                    type: 'text',
                    value: q.text || '',
                    style: { width: '100%' },
                    onChange: function(ev){ handlers.updateModalQuestionText(qi, ev.target.value); }
                  })
                ),
                e('div', null,
                  e('textarea', { rows: 3, value: q.explanation || '', style: { width: '100%', marginTop:6 }, onChange: function(ev){ if(handlers.updateModalQuestionExplanation) handlers.updateModalQuestionExplanation(qi, ev.target.value); } })
                ),
                e('div', null, e('small', null, '選択肢：')),
                e('ul', null, (q.choices || []).map(function(c, ci){
                  return e('li', { key: c.id || ci, style: { marginBottom: 6 } },
                    e('input', {
                      type: 'text',
                      value: c.text || '',
                      onChange: function(ev){ handlers.updateModalChoiceText(qi, ci, ev.target.value); },
                      style: { marginRight: 8 }
                    }),
                    e('label', null,
                      e('input', {
                        type: 'checkbox',
                        checked: !!c.is_correct,
                        onChange: function(){ handlers.toggleModalChoiceCorrect(qi, ci); }
                      }),
                      ' 正解'
                    ),
                    e('button', { onClick: function(){ handlers.removeModalChoice(qi, ci); }, style: { marginLeft: 8 } }, '削除')
                  );
                })),
                e('div', null, e('button', { onClick: function(){ handlers.addModalChoice(qi); } }, '選択肢を追加'))
              );
            })),
        e('div', { style: { marginTop: 12, textAlign: 'right' } },
          e('button', { onClick: handlers.saveModal, className: 'btn btn-primary', style: { marginRight: 8 } }, '保存'),
          e('button', { onClick: handlers.closeModal, className: 'btn' }, 'キャンセル')
        )
      )
    );
  }

  function cx(){
    return Array.prototype.slice.call(arguments).filter(Boolean).join(' ');
  }

  function formatAnswerTexts(values, fallback){
    return values && values.length ? values.join(' / ') : fallback;
  }

  function calculatePercent(earned, total){
    const safeTotal = Number(total || 0);
    if(!safeTotal){
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(Number(earned || 0) / safeTotal * 100)));
  }

  function getTeacherTestManagementState(test, questionCount){
    const normalizedQuestionCount = Number(questionCount || 0);
    if(!normalizedQuestionCount){
      return {
        label: '要問題作成',
        detail: 'まずは問題を追加すると、配布準備を進めやすくなります。',
        tone: 'warning'
      };
    }
    if(!test.class_id){
      return {
        label: 'クラス未割当',
        detail: 'クラスへ割り当てると、共有 QR で案内しやすくなります。',
        tone: 'muted'
      };
    }
    if(!test.public){
      return {
        label: '公開待ち',
        detail: '公開すると、生徒がこのテストを受験できる状態になります。',
        tone: 'default'
      };
    }
    return {
      label: '準備完了',
      detail: '公開済みです。必要なら共有 QR でそのまま案内できます。',
      tone: 'success'
    };
  }

  function getInitialRouteState(){
    const params = new URLSearchParams(window.location.search || '');
    const sharedTestId = (params.get('test_id') || '').trim();
    const sharedClassId = (params.get('class_id') || '').trim();
    return {
      sharedStudentAccess: params.get('access') === 'student' && !!sharedTestId,
      sharedTestId: sharedTestId,
      sharedClassId: sharedClassId
    };
  }

  function buildStudentAccessUrl(test){
    const url = new URL(window.location.pathname || '/', window.location.origin);
    url.searchParams.set('access', 'student');
    url.searchParams.set('test_id', String(test.id));
    if(test.class_id){
      url.searchParams.set('class_id', String(test.class_id));
    }
    return url.toString();
  }

  function copyTextToClipboard(text){
    if(navigator.clipboard && window.isSecureContext){
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function(resolve, reject){
      try{
        const input = document.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', 'readonly');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        input.setSelectionRange(0, input.value.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(input);
        if(copied) resolve();
        else reject(new Error('copy_failed'));
      }catch(err){
        reject(err);
      }
    });
  }

  function App(){
    const initialRoute = React.useRef(getInitialRouteState());
    const sharedStudentAccess = initialRoute.current.sharedStudentAccess;
    const sharedStudentTestId = initialRoute.current.sharedTestId;
    const sharedStudentClassId = initialRoute.current.sharedClassId;
    const [teacherUser, setTeacherUser] = React.useState(null);
    const [classes, setClasses] = React.useState([]);
    const [tests, setTests] = React.useState([]);
      const [testQuestionCounts, setTestQuestionCounts] = React.useState({});
    const [className, setClassName] = React.useState('');
    const [selectedClass, setSelectedClass] = React.useState(null);
    const [testName, setTestName] = React.useState('');
    const [testPublic, setTestPublic] = React.useState(false);
    const [testRandomize, setTestRandomize] = React.useState(false);
    const [textForAI, setTextForAI] = React.useState('');
    const [message, setMessage] = React.useState('');
    const [questions, setQuestions] = React.useState([]);
    const [modalOpen, setModalOpen] = React.useState(false);
    const [modalQuestions, setModalQuestions] = React.useState([]);
    const [mode, setMode] = React.useState(sharedStudentAccess ? 'student' : 'teacher');
    const [teacherTestQuery, setTeacherTestQuery] = React.useState('');
    const [teacherFilterClassId, setTeacherFilterClassId] = React.useState('');
    const [teacherTestViewMode, setTeacherTestViewMode] = React.useState('compact');
    const [expandedTeacherTests, setExpandedTeacherTests] = React.useState({});
    const [qrShareModal, setQrShareModal] = React.useState({
      open: false,
      loading: false,
      testName: '',
      className: '',
      url: '',
      qrDataUrl: '',
      error: ''
    });

    // Student states
    const [studentName, setStudentName] = React.useState('');
    const [studentClassId, setStudentClassId] = React.useState('');
    const [student, setStudent] = React.useState(null);
    const [studentTests, setStudentTests] = React.useState([]);
    const [currentTest, setCurrentTest] = React.useState(null);
    const [currentQuestions, setCurrentQuestions] = React.useState([]);
    const [currentIndex, setCurrentIndex] = React.useState(0);
    const [currentSelection, setCurrentSelection] = React.useState([]);
    const [lastResult, setLastResult] = React.useState(null);
    const [resultsSummary, setResultsSummary] = React.useState([]);
    const [summaryMeta, setSummaryMeta] = React.useState(null);
    const [currentSessionId, setCurrentSessionId] = React.useState(null);
    // Reports (integrated) state
    const [reports, setReports] = React.useState([]);
    const [reportsLoading, setReportsLoading] = React.useState(false);
    const [reportsPage, setReportsPage] = React.useState(1);
    const [reportsPerPage] = React.useState(10);
    const [reportsSortKey, setReportsSortKey] = React.useState('finished_at');
    const [reportsSortDir, setReportsSortDir] = React.useState('desc'); // 'asc' or 'desc'
    const [reportFilterTest, setReportFilterTest] = React.useState('');
    const [reportFilterUser, setReportFilterUser] = React.useState('');
    const [reportDatePreset, setReportDatePreset] = React.useState('all');
    const [reportDateFrom, setReportDateFrom] = React.useState('');
    const [reportDateTo, setReportDateTo] = React.useState('');
    const [reportSummaryOpen, setReportSummaryOpen] = React.useState(false);
    const [reportSummaryData, setReportSummaryData] = React.useState(null);
    const [reportFilterAnalytics, setReportFilterAnalytics] = React.useState(null);
    const [reportFilterAnalyticsLoading, setReportFilterAnalyticsLoading] = React.useState(false);
    const [initialDataLoading, setInitialDataLoading] = React.useState(true);
    const [studentBusyLabel, setStudentBusyLabel] = React.useState('');
    const reportSummaryCacheRef = React.useRef({});
    // selectedUserId / selectedUserSummary removed (side-card feature disabled)
    React.useEffect(()=>{
      setInitialDataLoading(true);

      if(sharedStudentAccess){
        Promise.all([
          fetch('/api/classes').then(function(r){ return r.json(); }),
          fetch('/api/tests').then(function(r){ return r.json(); })
        ]).then(function(results){
          setClasses(results[0] || []);
          setTests(results[1] || []);
        }).catch(function(){
          setMessage('初期データの読み込みに失敗しました');
        }).finally(function(){
          setInitialDataLoading(false);
        });
        return;
      }

      fetch('/api/teacher/me').then(function(r){
        if(!r.ok){
          var next = window.location.pathname + (window.location.search || '');
          window.location.href = '/login.html?next=' + encodeURIComponent(next);
          return null;
        }
        return r.json();
      }).then(function(me){
        if(!me || !me.teacher) return;
        setTeacherUser(me.teacher);
        return Promise.all([
          fetch('/api/classes').then(function(r){ return r.json(); }),
          fetch('/api/tests').then(function(r){ return r.json(); })
        ]);
      }).then(function(results){
        if(!results) return;
        setClasses(results[0] || []);
        setTests(results[1] || []);
      }).catch(function(){
        setMessage('初期データの読み込みに失敗しました');
      }).finally(function(){
        setInitialDataLoading(false);
      });
    },[]);

    function logoutTeacher(){
      fetch('/api/teacher/logout', { method: 'POST' })
        .then(function(){ window.location.href = '/'; })
        .catch(function(){ window.location.href = '/'; });
    }

    // fetch question counts for tests whenever tests list changes
    React.useEffect(()=>{
      if(!tests || tests.length === 0) return;
      const counts = {};
      tests.forEach(function(t){
        fetch('/api/tests/'+encodeURIComponent(t.id)+'/questions').then(r=>r.json()).then(qs=>{ counts[t.id] = (qs && qs.length) || 0; setTestQuestionCounts(prev=> Object.assign({}, prev, counts)); }).catch(()=>{ counts[t.id] = 0; setTestQuestionCounts(prev=> Object.assign({}, prev, counts)); });
      });
    }, [tests]);
    React.useEffect(function(){
      if(!sharedStudentAccess || !tests.length) return;
      const matchedTest = tests.find(function(t){ return String(t.id) === String(sharedStudentTestId); }) || null;
      setStudentTests(matchedTest ? [matchedTest] : []);
      if(matchedTest && matchedTest.class_id){
        setStudentClassId(String(matchedTest.class_id));
      } else if(sharedStudentClassId){
        setStudentClassId(String(sharedStudentClassId));
      }
    }, [sharedStudentAccess, sharedStudentTestId, sharedStudentClassId, tests]);
    React.useEffect(function(){
      if(modalOpen){
        setTimeout(function(){ var mc = document.getElementById('modal-content'); if(mc) mc.focus(); }, 0);
      }
    }, [modalOpen]);
    function createClass(){
      const name = (className || '').trim();
      if(!name){
        window.alert('クラス名を入力してください');
        return;
      }
      if(name.length > 25){
        window.alert('クラス名は25文字以内で入力してください');
        return;
      }
      fetch('/api/classes',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name: name})})
        .then(async r => {
          if(!r.ok){
            const j = await r.json().catch(()=>({ error: '登録に失敗しました' }));
            window.alert(j.error || '登録に失敗しました');
            return null;
          }
          return r.json();
        })
        .then(n=>{ if(n){ setClasses(prev=>prev.concat(n)); setClassName(''); } });
    }
    function editClass(c){
      const newName = window.prompt('クラス名を編集', c.name);
      if(!newName || !newName.trim() || newName === c.name) return;
      fetch('/api/classes/'+c.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: newName }) }).then(r=>r.json()).then(updated=>{
        setClasses(prev=> prev.map(x => x.id===updated.id ? updated : x));
        if(selectedClass && selectedClass.id === updated.id) setSelectedClass(updated);
      }).catch(()=> setMessage('クラス更新エラー'));
    }
    function deleteClass(c){
      if(!confirm('「' + c.name + '」を削除しますか？')) return;
      fetch('/api/classes/'+c.id, { method: 'DELETE' }).then(async r=>{
        if(r.ok){
          setClasses(prev=> prev.filter(x=> x.id !== c.id));
          if(selectedClass && selectedClass.id === c.id) setSelectedClass(null);
          setMessage('削除しました');
        } else {
          const json = await r.json().catch(()=> ({ error: '削除失敗' }));
          if(json && json.error === 'has_dependencies'){
            const ok = confirm('このクラスには ' + json.tests + ' 件のテストと ' + json.students + ' 名の生徒がいます。関連データも削除しますか？（取り消せません）');
            if(!ok) return;
            fetch('/api/classes/'+c.id+'?cascade=1', { method: 'DELETE' }).then(r2=>{
              if(r2.ok){
                setClasses(prev=> prev.filter(x=> x.id !== c.id));
                if(selectedClass && selectedClass.id === c.id) setSelectedClass(null);
                setMessage('関連データを含め削除しました');
              } else { setMessage('削除に失敗しました'); }
            }).catch(()=> setMessage('削除エラー'));
          } else { setMessage(json && json.error ? json.error : '削除エラー'); }
        }
      }).catch(()=> setMessage('通信エラー'));
    }
    function createTest(){
      // バリデーション: 空文字チェック
      if(!testName || !testName.trim()){
        window.alert('テスト名を入力してください');
        return;
      }
      // バリデーション: 名前の重複チェック（既存テスト名と比較）
      var exists = tests.some(function(t){ return (t.name || '').trim() === testName.trim(); });
      if(exists){
        window.alert('そのテスト名は既に使われています。別の名前を指定してください');
        return;
      }
      fetch('/api/tests',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({class_id:selectedClass?selectedClass.id:null, name:testName, public: testPublic, randomize: testRandomize})}).then(r=>r.json()).then(n=>{ setTests(prev=>prev.concat({id:n.id, name:testName, class_id:selectedClass?selectedClass.id:null, public: testPublic?1:0, randomize: testRandomize?1:0})); setTestName(''); setTestPublic(false); setTestRandomize(false); });
    }
    function editTest(t){
      const newName = window.prompt('テスト名を編集', t.name);
      if(!newName || !newName.trim() || newName === t.name) return;
      fetch('/api/tests/'+t.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: newName, description: t.description || '', public: t.public || 0, randomize: t.randomize || 0 }) }).then(r=>r.json()).then(updated=>{
        setTests(prev=> prev.map(x => x.id===updated.id ? updated : x));
        setMessage('更新しました');
      }).catch(()=> setMessage('テスト更新エラー'));
    }

    function deleteTest(t){
      if(!confirm('「' + t.name + '」を削除しますか？')) return;
      fetch('/api/tests/'+t.id, { method: 'DELETE' }).then(async r=>{
        if(r.ok){
          setTests(prev=> prev.filter(x=> x.id !== t.id));
          setMessage('削除しました');
        } else {
          const json = await r.json().catch(()=> ({ error: '削除失敗' }));
          if(json && json.error === 'has_dependencies'){
            const ok = confirm('このテストには ' + json.questions + ' 件の問題と ' + json.answers + ' 件の回答があります。関連データも削除しますか？（取り消せません）');
            if(!ok) return;
            fetch('/api/tests/'+t.id+'?cascade=1', { method: 'DELETE' }).then(r2=>{
              if(r2.ok){ setTests(prev=> prev.filter(x=> x.id !== t.id)); setMessage('関連データを含め削除しました'); }
              else { setMessage('削除に失敗しました'); }
            }).catch(()=> setMessage('削除エラー'));
          } else { setMessage(json && json.error ? json.error : '削除エラー'); }
        }
      }).catch(()=> setMessage('通信エラー'));
    }
    function fetchQuestions(testId){ if(!testId) return Promise.resolve([]); return fetch('/api/tests/'+testId+'/questions').then(r=>r.json()).then(j=>{ setQuestions(j); return j; }).catch(()=>{ setMessage('問題取得エラー'); return []; }); }

    // Fetch reports (uses /api/exams)
    async function fetchReports(){
      setReportsLoading(true);
      try{
        const res = await fetch('/api/exams');
        const j = await res.json();
        const arr = Array.isArray(j) ? j : (j && j.value) ? j.value : [];
        setReports(arr || []);
        setReportsPage(1);
      }catch(e){ setMessage('レポート取得エラー'); setReports([]); }
      setReportsLoading(false);
    }

    React.useEffect(()=>{ if(mode === 'reports') fetchReports(); }, [mode]);
    
    // Report summary modal / user summary panel helpers
    async function showReportSummary(r){
      if(!r) return;
      // open modal immediately (will populate when data arrives)
      setReportSummaryOpen(true);
      setReportSummaryData({ loading: true });
      const testId = r.testId || r.test_id || r.testId;
      const studentId = r.studentId || r.student_id;
      try{
        // fetch per-question summary (which contains choice ids) and questions (to get choice texts)
        const [sumRes, qRes] = await Promise.all([
          fetch('/api/tests/' + encodeURIComponent(testId) + '/summary?student_id=' + encodeURIComponent(studentId)),
          fetch('/api/tests/' + encodeURIComponent(testId) + '/questions')
        ]);
        if(!sumRes.ok) throw new Error('summary fetch failed');
        if(!qRes.ok) throw new Error('questions fetch failed');
        const summary = await sumRes.json();
        const questions = await qRes.json();
        // build choice id -> text map
        const choiceMap = {};
        (questions || []).forEach(q => { (q.choices || []).forEach(c => { choiceMap[c.id] = c.text; }); });
        // attach textual labels to details
        const detailsWithText = (summary.details || []).map(d => ({
          question_id: d.question_id,
          text: d.text,
          points: d.points,
          correct: d.correct,
          given_choice_ids: d.given_choice_ids || [],
          given_texts: (d.given_choice_ids || []).map(id => choiceMap[id] || String(id)),
          correct_choice_ids: d.correct_choice_ids || [],
          correct_texts: (d.correct_choice_ids || []).map(id => choiceMap[id] || String(id))
        }));
        setReportSummaryData({ loading: false, meta: r, total_points: summary.total_points, earned_points: summary.earned_points, details: detailsWithText });
      }catch(err){
        console.error(err);
        setReportSummaryData({ loading: false, error: '詳細の取得に失敗しました', meta: r });
      }
    }
    function closeReportSummary(){ setReportSummaryOpen(false); setReportSummaryData(null); }

    // showUserSummary / closeUserSummary removed
    function generate(){ if(!textForAI || !window.selectedTestId){ setMessage('テキストとテスト選択が必要です'); return; } setMessage('生成中...'); fetch('/api/generate-questions',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ testId: window.selectedTestId, text: textForAI })}).then(r=>r.json()).then(j=>{ setMessage('生成完了: '+(j.length||0)+'問'); fetchQuestions(window.selectedTestId).then(qs=>{ setModalQuestions(qs || []); setModalOpen(true); }); }).catch(err=>setMessage('エラー')); }
    function openTest(t){ window.selectedTestId = t.id; setMessage('テスト '+t.name+' を選択しました'); fetchQuestions(t.id); }

    function updateModalQuestionText(qIndex, value){ setModalQuestions(prev=>{ const arr = prev.map(q=> ({...q}) ); arr[qIndex].text = value; return arr; }); }
    function updateModalQuestionExplanation(qIndex, value){ setModalQuestions(prev=>{ const arr = prev.map(q=> ({...q}) ); arr[qIndex].explanation = value; return arr; }); }
    function updateModalChoiceText(qIndex, cIndex, value){ setModalQuestions(prev=>{ const arr = prev.map(q=> ({...q, choices: (q.choices||[]).map(c=>({...c})) })); arr[qIndex].choices[cIndex].text = value; return arr; }); }
    function toggleModalChoiceCorrect(qIndex, cIndex){ setModalQuestions(prev=>{ const arr = prev.map(q=> ({...q, choices: (q.choices||[]).map(c=>({...c})) })); arr[qIndex].choices[cIndex].is_correct = !arr[qIndex].choices[cIndex].is_correct; return arr; }); }
    function addModalChoice(qIndex){ setModalQuestions(prev=>{ const arr = prev.map(q=> ({...q, choices: (q.choices||[]).map(c=>({...c})) })); arr[qIndex].choices.push({ id: null, text: '新しい選択肢', is_correct: 0 }); return arr; }); }
    function removeModalChoice(qIndex, cIndex){ setModalQuestions(prev=>{ const arr = prev.map(q=> ({...q, choices: (q.choices||[]).map(c=>({...c})) })); arr[qIndex].choices.splice(cIndex,1); return arr; }); }
    function closeModal(){ setModalOpen(false); setModalQuestions([]); }
    function saveModal(){ if(!window.selectedTestId){ setMessage('テスト未選択'); return; } setMessage('保存中...'); const ops = [];
      modalQuestions.forEach(q=>{
        // update question (including explanation)
        ops.push(fetch('/api/questions/'+q.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: q.text, type: q.type||'single', points: q.points||1, explanation: q.explanation || '' }) }));
        (q.choices||[]).forEach(c=>{
          if(c.id){ ops.push(fetch('/api/choices/'+c.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: c.text, is_correct: c.is_correct?1:0 }) })); }
          else { ops.push(fetch('/api/questions/'+q.id+'/choices', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: c.text, is_correct: c.is_correct?1:0 }) })); }
        });
      });
      Promise.all(ops).then(()=>{ fetchQuestions(window.selectedTestId).then(()=>{ setMessage('保存完了'); closeModal(); }); }).catch(()=>setMessage('保存エラー'));
    }

    function toggleTestPublic(test){
      const newPublic = test.public ? 0 : 1;
      fetch('/api/tests/'+test.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: test.name, description: test.description || '', public: newPublic, randomize: test.randomize || 0 }) }).then(r=>r.json()).then(updated=>{
        setTests(prev => prev.map(t => t.id===updated.id ? updated : t));
      }).catch(()=> setMessage('公開設定更新エラー'));
    }
    async function openQrShareModal(test){
      if(!test || !test.id) return;
      if(!Number(testQuestionCounts[test.id] || 0)){
        setMessage('問題が1問もないテストは共有QRを表示できません');
        return;
      }
      if(!test.public){
        setMessage('公開前のテストは共有QRを表示できません');
        return;
      }
      if(!test.class_id){
        setMessage('クラス未割り当てのテストは共有URLを作成できません');
        return;
      }
      const classNameForTest = (classes.find(function(c){ return c.id === test.class_id; }) || {}).name || '未割当';
      const url = buildStudentAccessUrl(test);
      setQrShareModal({
        open: true,
        loading: true,
        testName: test.name || 'テスト',
        className: classNameForTest,
        url: url,
        qrDataUrl: '',
        error: ''
      });
      try{
        const res = await fetch('/api/qr-code?text=' + encodeURIComponent(url));
        const payload = await res.json();
        if(!res.ok || !payload.dataUrl){
          throw new Error(payload && payload.error ? payload.error : 'QRコード生成エラー');
        }
        setQrShareModal(function(prev){
          return Object.assign({}, prev, { loading: false, qrDataUrl: payload.dataUrl, error: '' });
        });
      }catch(err){
        setQrShareModal(function(prev){
          return Object.assign({}, prev, { loading: false, qrDataUrl: '', error: err && err.message ? err.message : 'QRコード生成エラー' });
        });
      }
    }
    function closeQrShareModal(){
      setQrShareModal({
        open: false,
        loading: false,
        testName: '',
        className: '',
        url: '',
        qrDataUrl: '',
        error: ''
      });
    }
    function copySharedUrl(url){
      copyTextToClipboard(url).then(function(){
        setMessage('アクセスURLをコピーしました');
      }).catch(function(){
        setMessage('URLのコピーに失敗しました');
      });
    }
    function updateTestRecord(test, overrides, errorMessage, successMessage){
      const payload = {
        name: Object.prototype.hasOwnProperty.call(overrides || {}, 'name') ? overrides.name : test.name,
        description: Object.prototype.hasOwnProperty.call(overrides || {}, 'description') ? overrides.description : (test.description || ''),
        public: Object.prototype.hasOwnProperty.call(overrides || {}, 'public') ? overrides.public : (test.public || 0),
        randomize: Object.prototype.hasOwnProperty.call(overrides || {}, 'randomize') ? overrides.randomize : (test.randomize || 0),
        class_id: Object.prototype.hasOwnProperty.call(overrides || {}, 'class_id') ? overrides.class_id : (test.class_id || null)
      };
      return fetch('/api/tests/'+test.id, {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      }).then(r=>r.json()).then(updated=>{
        const merged = Object.assign({}, test, updated, { class_id: payload.class_id });
        setTests(prev => prev.map(t => t.id===test.id ? merged : t));
        if(successMessage) setMessage(successMessage);
        return merged;
      }).catch(()=>{
        setMessage(errorMessage || '更新エラー');
        return null;
      });
    }

    const classItems = classes.map(function(c){
      const linkedTests = tests.filter(function(t){ return t.class_id === c.id; }).length;
      return e('li', { key: c.id, className: 'task-list-row' },
        e('div', { className: 'task-list-row__body' },
          e('strong', null, c.name),
          e('span', { className: 'task-list-row__meta' }, linkedTests + '件のテスト')
        ),
        e('div', { className: 'task-list-row__actions' },
          e('button', { onClick: function(){ editClass(c); }, className: 'btn btn-small btn-ghost', type: 'button' }, '編集'),
          e('button', { onClick: function(){ deleteClass(c); }, className: 'btn btn-small btn-ghost', type: 'button' }, '削除')
        )
      );
    });

    // drag handlers for tests
    function onDragStartTest(ev, t){
      ev.dataTransfer.setData('text/plain', JSON.stringify({ testId: t.id }));
      ev.dataTransfer.effectAllowed = 'move';
    }

    function toggleTeacherTestExpanded(testId){
      setExpandedTeacherTests(function(prev){
        const next = Object.assign({}, prev);
        if(next[testId]){
          delete next[testId];
        } else {
          next[testId] = true;
        }
        return next;
      });
    }

    // build list of test item elements from data (keep data->UI mapping pure)
    const normalizedTeacherQuery = (teacherTestQuery || '').trim().toLowerCase();
    const displayedTests = tests.filter(function(t){
      const matchesQuery = !normalizedTeacherQuery || (t.name || '').toLowerCase().includes(normalizedTeacherQuery);
      const matchesClass = !teacherFilterClassId || String(t.class_id || '') === String(teacherFilterClassId);
      return matchesQuery && matchesClass;
    });
    const publicTestsCount = tests.filter(function(t){ return !!t.public; }).length;
    const draftTestsCount = tests.filter(function(t){ return !t.public; }).length;
    const assignedTestsCount = tests.filter(function(t){ return !!t.class_id; }).length;
    const teacherFlowSteps = [
      {
        key: 'classroom',
        step: '1',
        title: 'クラス管理',
        summary: 'クラスを作成'
      },
      {
        key: 'compose',
        step: '2',
        title: 'テストを作成',
        summary: '配布するテストを作成'
      },
      {
        key: 'manage',
        step: '3',
        title: 'テストの管理',
        items: [
          { key: 'edit', step: '3-1', text: '問題の作成・編集' },
          { key: 'public', step: '3-2', text: '公開設定' },
          { key: 'share', step: '3-3', text: '共有 QR から生徒へ配布' }
        ]
      }
    ];

    const teacherNode = e('section', { className: 'task-page' },
      e('div', { className: 'task-page-hero compact teacher-page-hero' },
        e('div', { className: 'teacher-page-hero__intro' },
          e('p', { className: 'eyebrow' }, '教員メニュー'),
          e('h1', null, 'テスト準備ダッシュボード'),
          e('p', { className: 'lead' }, '準備フローを参考に、テストの準備・配布を行います。')
        ),
        e('div', { className: 'teacher-page-flow' },
          e('div', { className: 'teacher-page-flow__header' },
            e('span', { className: 'teacher-page-flow__kicker' }, '準備フロー')
          ),
          e('div', { className: 'teacher-page-flow__lane' },
            e('ol', { className: 'teacher-page-flow__list', 'aria-label': '教師メニューの準備フロー' }, teacherFlowSteps.map(function(step){
              return e('li', { key: step.key, className: step.items ? 'teacher-page-flow__step is-detailed' : 'teacher-page-flow__step' },
                e('div', { className: 'teacher-page-flow__step-top' },
                  e('span', { className: 'teacher-page-flow__step-index', 'aria-hidden': true }, step.step),
                  e('div', { className: 'teacher-page-flow__step-copy' },
                    e('strong', { className: 'teacher-page-flow__step-title' }, step.title),
                    step.summary ? e('span', { className: 'teacher-page-flow__step-summary' }, step.summary) : null
                  )
                ),
                step.items ? e('ul', { className: 'teacher-page-flow__sublist' }, step.items.map(function(item){
                  return e('li', { key: item.key, className: 'teacher-page-flow__subitem' },
                    e('span', { className: 'teacher-page-flow__subindex' }, item.step),
                    e('span', { className: 'teacher-page-flow__subtext' }, item.text)
                  );
                })) : null
              );
            }))
          )
        )
      ),
      e('div', { className: 'task-stat-grid compact' }, [
        e('article', { key: 'teacher-stat-draft', className: 'task-stat-card' },
          e('span', { className: 'task-stat-card__label' }, '下書き'),
          e('strong', { className: 'task-stat-card__value' }, String(draftTestsCount)),
          e('span', { className: 'task-stat-card__note' }, '公開前に確認するテスト')
        ),
        e('article', { key: 'teacher-stat-public', className: 'task-stat-card' },
          e('span', { className: 'task-stat-card__label' }, '公開中'),
          e('strong', { className: 'task-stat-card__value' }, String(publicTestsCount)),
          e('span', { className: 'task-stat-card__note' }, '生徒に見えているテスト')
        ),
        e('article', { key: 'teacher-stat-assigned', className: 'task-stat-card' },
          e('span', { className: 'task-stat-card__label' }, 'クラス割当済み'),
          e('strong', { className: 'task-stat-card__value' }, String(assignedTestsCount)),
          e('span', { className: 'task-stat-card__note' }, '共有 QR を出せる状態')
        )
      ]),
      initialDataLoading ? e('div', { className: 'teacher-status-strip', role: 'status' }, 'クラスとテストの一覧を読み込んでいます。') : null,
      e('div', { className: 'teacher-workspace-grid' },
        e('section', { className: 'teacher-workspace-main' },
          e('section', { className: 'task-section-card teacher-class-card' },
            e('div', { className: 'task-section-heading' },
              e('div', { 'data-title-icon': 'classroom' },
                e('h2', null, 'クラス管理'),
                e('p', { className: 'section-note' }, 'クラスの追加と管理を行います。')
              ),
              e('span', { className: 'task-chip task-chip-muted' }, '登録済み: ' + classes.length + 'クラス')
            ),
            e('div', { className: 'teacher-class-card__top teacher-class-card__top--single' },
              e('div', { className: 'task-inline-form teacher-class-card__form' },
                e('input', { value: className, onChange: function(ev){ setClassName(ev.target.value); }, placeholder: '例: 1年A組', 'aria-label': 'クラス名', maxLength: 25 }),
                e('button', { onClick: createClass, className: 'btn btn-primary', type: 'button' }, '追加')
              )
            ),
            classItems.length ? e('ul', { className: 'task-list' }, classItems) : e('div', { className: 'task-empty' }, 'クラスがまだありません')
          ),
          e('section', { className: 'task-section-card' },
            e('div', { className: 'task-section-heading' },
              e('div', { 'data-title-icon': 'list' },
                e('h2', null, 'テストの管理')
              ),
              e('span', { className: 'task-chip task-chip-muted' }, '共有 QR は1問以上作成・公開・クラス割当後に有効')
            ),
            e('div', { className: 'task-filter-bar' },
              e('input', {
                value: teacherTestQuery,
                onChange: function(ev){ setTeacherTestQuery(ev.target.value); },
                placeholder: 'テスト名で検索',
                'aria-label': 'テスト名で検索'
              }),
              e('select', {
                value: teacherFilterClassId,
                onChange: function(ev){ setTeacherFilterClassId(ev.target.value); },
                'aria-label': 'クラスで絞り込み'
              }, [
                e('option', { key: '__all_filter', value: '' }, 'すべてのクラス')
              ].concat(classes.map(function(c){
                return e('option', { key: c.id, value: c.id }, c.name);
              }))),
              e('button', {
                onClick: function(){ setTeacherTestQuery(''); setTeacherFilterClassId(''); },
                className: 'btn btn-ghost',
                type: 'button'
              }, '条件をクリア')
            ),
            e('div', { className: 'teacher-test-toolbar' },
              e('div', { className: 'task-results-meta' },
                displayedTests.length + '件を表示中' + (teacherTestQuery || teacherFilterClassId ? ' / 条件あり' : ' / 全件表示')
              ),
              e('div', { className: 'teacher-test-view-switch', role: 'group', 'aria-label': 'テストカード表示切替' },
                e('button', {
                  onClick: function(){ setTeacherTestViewMode('compact'); },
                  className: teacherTestViewMode === 'compact' ? 'mode-tab is-active' : 'mode-tab',
                  type: 'button',
                  'aria-pressed': teacherTestViewMode === 'compact'
                }, '簡易表示'),
                e('button', {
                  onClick: function(){ setTeacherTestViewMode('detailed'); },
                  className: teacherTestViewMode === 'detailed' ? 'mode-tab is-active' : 'mode-tab',
                  type: 'button',
                  'aria-pressed': teacherTestViewMode === 'detailed'
                }, '詳細表示')
              )
            ),
            displayedTests.length ? e('div', { className: cx('task-card-grid', teacherTestViewMode === 'detailed' && 'teacher-test-grid-detailed') }, displayedTests.map(function(t){
              const questionCount = testQuestionCounts[t.id] || 0;
              const classNameForTest = (classes.find(function(c){ return c.id === t.class_id; }) || {}).name || '未割当';
              const canShareTest = Number(questionCount) > 0 && !!t.public && !!t.class_id;
              const managementState = getTeacherTestManagementState(t, questionCount);
              const isDetailedCard = teacherTestViewMode === 'detailed' || !!expandedTeacherTests[t.id];
              return e('article', {
                key: t.id,
                draggable: true,
                onDragStart: function(ev){ onDragStartTest(ev, t); },
                className: cx('task-card', 'teacher-test-card', 'teacher-test-card--' + managementState.tone, isDetailedCard && 'is-detailed')
              },
                e('div', { className: 'task-card-header teacher-test-card__header' },
                  e('div', { className: 'teacher-test-card__title-block' },
                    e('h4', { className: 'task-card-title', 'data-title-icon': 'test' }, t.name),
                    e('div', { className: 'teacher-test-card__overview' },
                      e('span', { className: 'teacher-test-state is-' + managementState.tone }, managementState.label),
                      e('p', { className: 'teacher-test-card__helper' }, managementState.detail)
                    )
                  ),
                  e('div', { className: 'task-badges teacher-test-card__badges' },
                    e('span', { className: !!t.public ? 'badge badge-success' : 'badge' }, !!t.public ? '公開中' : '下書き'),
                    e('span', { className: !!t.randomize ? 'badge badge-accent' : 'badge badge-muted' }, !!t.randomize ? 'ランダム' : '固定順')
                  )
                ),
                e('div', { className: 'teacher-test-card__summary-grid' },
                  e('div', { className: 'teacher-test-meta' },
                    e('span', { className: 'teacher-test-meta__label' }, 'クラス'),
                    e('strong', { className: 'teacher-test-meta__value' }, classNameForTest)
                  ),
                  e('div', { className: cx('teacher-test-meta', questionCount === 0 && 'is-warning') },
                    e('span', { className: 'teacher-test-meta__label' }, '問題数'),
                    e('strong', { className: 'teacher-test-meta__value' }, questionCount + '問')
                  )
                ),
                e('div', { className: 'teacher-test-card__primary-actions' },
                  e('a', { href: '/create_test.html?class_id=' + encodeURIComponent(t.class_id || '') + '&name=' + encodeURIComponent(t.name || '') + '&test_id=' + encodeURIComponent(t.id), className: 'btn btn-small btn-primary' }, '問題管理'),
                  e('button', { onClick: function(){ openQrShareModal(t); }, className: 'btn btn-small btn-secondary', type: 'button', disabled: !canShareTest }, '共有 QR'),
                  teacherTestViewMode === 'compact'
                    ? e('button', {
                        onClick: function(){ toggleTeacherTestExpanded(t.id); },
                        className: 'btn btn-small btn-ghost',
                        type: 'button',
                        'aria-expanded': isDetailedCard
                      }, isDetailedCard ? '詳細を隠す' : '詳細')
                    : null
                ),
                isDetailedCard ? e('div', { className: 'teacher-test-card__details' },
                  e('div', { className: 'task-card-controls teacher-test-card__controls' },
                    e('label', { className: 'task-toggle compact' }, e('input', { type: 'checkbox', checked: !!t.public, onChange: function(){ toggleTestPublic(t); } }), e('span', null, '公開')),
                    e('label', { className: 'task-toggle compact' }, e('input', { type: 'checkbox', checked: !!t.randomize, onChange: function(){ updateTestRecord(t, { randomize: t.randomize ? 0 : 1 }, 'ランダム設定更新エラー'); } }), e('span', null, 'ランダム'))
                  ),
                  e('p', { className: 'teacher-inline-note teacher-test-card__detail-note' }, managementState.detail),
                  e('div', { className: 'task-card-footer teacher-card-footer teacher-test-card__secondary-actions' },
                    e('button', { onClick: function(){ editTest(t); }, className: 'btn btn-small btn-ghost', type: 'button' }, '名称変更'),
                    e('button', { onClick: function(){ deleteTest(t); }, className: 'btn btn-small btn-ghost', type: 'button' }, '削除')
                  )
                ) : null
              );
            })) : e('div', { className: 'task-empty' }, teacherTestQuery || teacherFilterClassId ? '条件に一致するテストがありません' : 'テストがまだありません')
          )
        ),
        e('aside', { className: 'teacher-workspace-side' },
          e('section', { className: 'task-section-card teacher-create-card' },
            e('div', { className: 'task-section-heading' },
              e('div', { 'data-title-icon': 'compose' },
                e('h2', null, 'テストを作成'),
                e('p', { className: 'section-note' }, 'クラスを選択して新しいテストを作成します。')
              ),
              e('span', { className: 'task-chip' }, selectedClass ? ('対象クラス: ' + selectedClass.name) : '対象クラス: 未選択')
            ),
            null,
            e('div', { className: 'task-form-stack teacher-create-grid' },
              e('select', { value: selectedClass ? selectedClass.id : '', onChange: function(ev){ setSelectedClass(classes.find(function(x){ return x.id == ev.target.value; }) || null); }, 'aria-label': 'クラス選択' }, [ e('option', { key: '__empty', value: '' }, 'クラスを選択') ].concat(classes.map(function(c){ return e('option', { key: c.id, value: c.id }, c.name); })) ),
              e('input', { value: testName, onChange: function(ev){ setTestName(ev.target.value); }, placeholder: '例: 小テスト 4月1週', 'aria-label': 'テスト名' }),
              e('div', { className: 'task-toggle-row' },
                e('label', { className: 'task-toggle' }, e('input', { type: 'checkbox', checked: testPublic, onChange: function(ev){ setTestPublic(!!ev.target.checked); } }), e('span', null, '公開する')),
                e('label', { className: 'task-toggle' }, e('input', { type: 'checkbox', checked: testRandomize, onChange: function(ev){ setTestRandomize(!!ev.target.checked); } }), e('span', null, '問題順をランダム化'))
              ),
              e('div', { className: 'task-inline-actions' },
                e('button', { onClick: createTest, className: 'btn btn-primary', type: 'button' }, '作成'),
                e('span', { className: 'teacher-inline-note' }, '作成後に問題を編集できます。')
              )
            )
          ),
          e('section', { className: 'task-section-card' },
            e('div', { className: 'task-section-heading' },
              e('div', { 'data-title-icon': 'assign' },
                e('h2', null, 'クラスへ割り当て'),
                e('p', { className: 'section-note' }, 'テストをドラッグしてクラスに割り当てます。')
              )
            ),
            e('div', { className: 'drop-zone-grid' }, classes.map(function(c){
              function onDragOver(ev){ ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; }
              async function onDrop(ev){
                ev.preventDefault();
                try{
                  const data = JSON.parse(ev.dataTransfer.getData('text/plain'));
                  const droppedTest = tests.find(function(t){ return t.id === data.testId; });
                  if(!droppedTest) return;
                  await updateTestRecord(droppedTest, { class_id: c.id }, '移動に失敗しました', 'テストを「' + c.name + '」に移動しました');
                }catch(e){ setMessage('移動に失敗しました'); }
              }
              return e('div', { key: c.id, onDragOver: onDragOver, onDrop: onDrop, className: 'drop-zone' },
                e('strong', null, c.name),
                e('span', null, tests.filter(function(t){ return t.class_id === c.id; }).length + '件のテスト')
              );
            }))
          )
        )
      ),

      renderModal(modalQuestions, {
        modalOpen: modalOpen,
        updateModalQuestionText: updateModalQuestionText,
        updateModalChoiceText: updateModalChoiceText,
        toggleModalChoiceCorrect: toggleModalChoiceCorrect,
        addModalChoice: addModalChoice,
        removeModalChoice: removeModalChoice,
        saveModal: saveModal,
        closeModal: closeModal
      })
    );

    // Student UI functions
    // Start a test as the current (or newly created) student.
    function attemptStartTest(t){
      const activeClassId = studentClassId || sharedStudentClassId || (t && t.class_id ? String(t.class_id) : '');
      if(!studentName || !studentName.trim()){
        window.alert('名前を入力してください');
        return;
      }
      if(!activeClassId){
        window.alert('クラスを選択してください');
        return;
      }
      if(student){ startTest(t); return; }
      // Create student then start
      setStudentBusyLabel('参加情報を確認しています');
      fetch('/api/students', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ class_id: activeClassId, name: studentName }) })
        .then(r=>r.json()).then(j=>{
          if(j.error){ setMessage(j.error); setStudentBusyLabel(''); return; }
          setStudent(j);
          setStudentClassId(String(j.class_id || activeClassId));
          // removed welcome message to simplify student UI
          if(sharedStudentAccess){
            setStudentTests([t]);
          } else {
            fetch('/api/tests?class_id='+j.class_id+'&public=1').then(r=>r.json()).then(ts=>{ setStudentTests(ts || []); }).catch(()=>{});
          }
          // pass the created student into startTest to avoid relying on state update timing
          return startTest(t, j);
        }).catch(()=> { setMessage('参加処理に失敗しました'); setStudentBusyLabel(''); });
    }

    async function startTest(t, explicitStudent){
      setStudentBusyLabel('テストを準備しています');
      setCurrentTest(t);
      setCurrentIndex(0);
      setResultsSummary([]);
      setCurrentSelection([]);
      // Prefer explicitStudent (passed from caller) otherwise fall back to state `student`.
      const useStudent = explicitStudent && explicitStudent.id ? explicitStudent : student;
      // create exam session if student exists
      if(useStudent && useStudent.id){
        try{
          const resp = await fetch('/api/exam-sessions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ student_id: useStudent.id, test_id: t.id }) });
          const js = await resp.json();
          if(resp.ok && js && js.id) setCurrentSessionId(js.id);
          else setCurrentSessionId(null);
        }catch(e){ setCurrentSessionId(null); setMessage('セッション作成エラー'); }
      } else { setCurrentSessionId(null); }
      fetch('/api/tests/'+t.id+'/questions').then(r=>r.json()).then(qs=>{ setCurrentQuestions(qs||[]); setLastResult(null); setCurrentSelection([]); }).catch(function(){ setMessage('問題取得エラー'); }).finally(function(){ setStudentBusyLabel(''); });
    }

    function selectChoice(q, choiceId, checked){
      if(!q) return;
      if(q.type === 'multiple'){
        setCurrentSelection(prev => {
          const s = prev ? prev.slice() : [];
          if(checked){ if(!s.includes(choiceId)) s.push(choiceId); }
          else { const idx = s.indexOf(choiceId); if(idx>=0) s.splice(idx,1); }
          return s;
        });
      } else {
        setCurrentSelection([choiceId]);
      }
    }

    function submitCurrentAnswer(){
      const q = currentQuestions[currentIndex];
      if(!q) return;
      setStudentBusyLabel('回答を送信しています');
      const payload = { student_id: student.id, test_id: currentTest.id, question_id: q.id, session_id: currentSessionId };
      if(q.type === 'multiple') payload.choice_ids = currentSelection;
      else payload.choice_id = currentSelection && currentSelection[0] ? currentSelection[0] : null;
      fetch('/api/submit-answer', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }).then(r=>r.json()).then(j=>{
        if(j && j.error){
          setMessage(j.error);
          return;
        }
        nextQuestion();
      }).catch(()=> setMessage('送信エラー')).finally(function(){ setStudentBusyLabel(''); });
    }

    function nextQuestion(){
      setCurrentSelection([]);
      setLastResult(null);
      if(currentIndex+1 < currentQuestions.length){ setCurrentIndex(currentIndex+1); }
      else {
        // finished: fetch summary for this student and test
        setStudentBusyLabel('結果をまとめています');
        (async ()=>{
            try{
              // finish session (compute & persist) if exists
              if(currentSessionId){
                try{ await fetch('/api/exam-sessions/'+currentSessionId+'/finish', { method: 'PUT' }); }
                catch(e){ /* continue even if finish fails */ }
              }
              // request summary (prefer session-scoped summary when available)
              let summaryUrl = '/api/tests/'+currentTest.id+'/summary?student_id='+student.id;
              if(currentSessionId) summaryUrl += '&session_id=' + encodeURIComponent(currentSessionId);
              const res = await fetch(summaryUrl);
              const j = await res.json();
              if(j && j.details){
              // fetch questions + choices to map choice ids -> texts
              const qres = await fetch('/api/tests/'+currentTest.id+'/questions');
              const questions = await qres.json().catch(()=>[]);
              const details = j.details.map(d => {
                const q = (questions || []).find(x => x.id === d.question_id) || { choices: [] };
                const choiceMap = {};
                (q.choices || []).forEach(c => { choiceMap[c.id] = c.text; });
                const given_texts = (d.given_choice_ids || []).map(id => choiceMap[id] || String(id)).filter(Boolean);
                const correct_texts = (d.correct_choice_ids || []).map(id => choiceMap[id] || String(id)).filter(Boolean);
                return {
                  questionId: d.question_id,
                  text: d.text,
                  points: d.points,
                  correct: !!d.correct,
                  given_choice_ids: d.given_choice_ids || [],
                  given_texts: given_texts,
                  correct_choice_ids: d.correct_choice_ids || [],
                  correct_texts: correct_texts,
                  explanation: d.explanation || ''
                };
              });
              setResultsSummary(details);
              setSummaryMeta({ testName: currentTest ? currentTest.name : '', total: j.total_points || 0, earned: j.earned_points || 0 });
            } else {
              setResultsSummary([]);
              setSummaryMeta({ testName: currentTest ? currentTest.name : '', total: 0, earned: 0 });
            }
              setMessage('試験終了 - 詳細スコアを表示');
              setCurrentTest(null);
              setCurrentSessionId(null);
          }catch(e){ setMessage('サマリ取得エラー'); setCurrentTest(null); }
          finally{ setStudentBusyLabel(''); }
        })();
      }
    }

    function goToStudentStart(){
      const sharedTest = sharedStudentAccess
        ? (tests.find(function(t){ return String(t.id) === String(sharedStudentTestId); }) || null)
        : null;
      setResultsSummary([]);
      setSummaryMeta(null);
      setStudent(null);
      setStudentName('');
      setStudentClassId(sharedTest && sharedTest.class_id ? String(sharedTest.class_id) : (sharedStudentClassId || ''));
      setStudentTests(sharedTest ? [sharedTest] : []);
      setCurrentTest(null);
      setCurrentQuestions([]);
      setCurrentIndex(0);
      setCurrentSelection([]);
      setLastResult(null);
      setMessage('');
      setStudentBusyLabel('');
    }

    function clearStudentSummary(){
      setResultsSummary([]);
      setSummaryMeta(null);
      setMessage('');
    }

    function renderStudent(){
      const sharedTest = sharedStudentAccess
        ? ((studentTests || []).find(function(t){ return String(t.id) === String(sharedStudentTestId); }) || tests.find(function(t){ return String(t.id) === String(sharedStudentTestId); }) || null)
        : null;
      const resolvedClassId = studentClassId || (sharedTest && sharedTest.class_id ? String(sharedTest.class_id) : sharedStudentClassId);
      const availableTests = sharedStudentAccess
        ? (sharedTest ? [sharedTest] : [])
        : (studentTests || []);
      const currentClass = classes.find(function(c){ return String(c.id) === String(resolvedClassId); }) || null;
      const classLabel = currentClass ? currentClass.name : (sharedStudentAccess ? '配布テスト' : 'クラス未選択');
      const sharedAccessUnavailable = sharedStudentAccess && !sharedTest;
      const sharedAccessNeedsClass = sharedStudentAccess && !resolvedClassId;
      const hasStudentName = !!(studentName && studentName.trim());
      const finished = !currentTest && resultsSummary && resultsSummary.length > 0 && summaryMeta;
      const correctCount = (resultsSummary || []).filter(function(item){ return !!item.correct; }).length;
      const totalQuestions = (resultsSummary || []).length;
      const summaryPercent = summaryMeta
        ? calculatePercent(summaryMeta.earned, summaryMeta.total)
        : (totalQuestions ? Math.round(correctCount / totalQuestions * 100) : 0);

      function renderTestCatalog(buttonText, handler){
        if(sharedAccessUnavailable){
          return e('div', { className: 'student-empty-state' },
            e('strong', null, 'この共有テストは見つかりません。'),
            e('p', null, 'URLを確認するか、先生に最新のURLを共有してもらってください。')
          );
        }
        if(sharedAccessNeedsClass){
          return e('div', { className: 'student-empty-state' },
            e('strong', null, 'このテストはまだ開始できません。'),
            e('p', null, 'クラス設定が未完了のため、先生に設定後のURLを共有してもらってください。')
          );
        }
        if(!studentClassId){
          return e('div', { className: 'student-empty-state' },
            e('strong', null, 'クラスを選択するとテスト候補を表示します。'),
            e('p', null, '公開設定済みのテストだけが並びます。プレビューしたい導線をそのまま選べます。')
          );
        }
        if(!availableTests.length){
          return e('div', { className: 'student-empty-state' },
            e('strong', null, '公開されているテストがありません。'),
            e('p', null, '先生画面で公開設定を確認してから、もう一度プレビューしてください。')
          );
        }
        return e('div', { className: 'student-test-grid' }, availableTests.map(function(t){
          const questionCount = testQuestionCounts[t.id];
          return e('article', { key: t.id, className: cx('student-test-card', !hasStudentName && 'is-disabled') },
            e('div', { className: 'student-test-card__top' },
              e('span', { className: 'student-pill' }, questionCount != null ? (questionCount + '問') : '問題確認中'),
              t.randomize ? e('span', { className: 'student-pill student-pill-muted' }, 'ランダム出題') : null,
              t.public ? e('span', { className: 'student-pill student-pill-soft' }, '公開中') : null
            ),
            e('h3', null, t.name),
            e('p', { className: 'student-test-card__meta' }, classLabel + ' / 答えた直後に解説とふりかえり'),
            e('div', { className: cx('student-test-card__footer', sharedStudentAccess && 'student-test-card__footer-centered') },
              e('span', { className: 'student-test-card__helper' }, hasStudentName ? '最後に学習のふりかえりまで確認できます。' : '表示名を入力すると始められます。'),
              e('button', { onClick: function(){ handler(t); }, className: 'btn btn-primary', type: 'button', disabled: !hasStudentName || !!studentBusyLabel }, studentBusyLabel ? '準備中...' : buttonText)
            )
          );
        }));
      }

      if(!student){
        return e('div', { className: 'student-preview-shell' },
          studentBusyLabel ? e('div', { className: 'student-status-strip', role: 'status' }, studentBusyLabel) : null,
          e('section', { className: 'student-preview-banner student-preview-banner-entry' },
            e('div', { className: 'student-preview-banner__body' },
              e('p', { className: 'student-preview-kicker' }, sharedStudentAccess ? '受験画面' : '受験開始'),
              e('h2', null, sharedStudentAccess ? ((sharedTest && sharedTest.name ? sharedTest.name : '配布テスト') + ' に参加') : 'テストを選んで開始'),
              e('p', { className: 'student-preview-lead' }, sharedStudentAccess ? '共有されたテストに参加します。表示名を入力して開始してください。' : 'クラスと表示名を入力し、受験するテストを選択してください。')
            ),
            null
          ),
          e('div', { className: 'student-preview-grid student-entry-grid' },
            e('section', { className: 'student-preview-panel student-preview-panel-spotlight student-start-panel' },
              e('div', { className: 'student-preview-panel__header' },
                e('div', null,
                  e('p', { className: 'student-preview-kicker student-preview-kicker-muted' }, ''),
                  e('h3', null, sharedStudentAccess ? '表示名を入力して参加' : '参加情報を入力')
                ),
                e('span', { className: 'student-preview-caption' }, '必要事項を入力')
              ),
              e('div', { className: 'student-preview-form-grid' },
                sharedStudentAccess
                  ? e('label', null,
                      e('span', { className: 'student-field-label' }, 'クラス'),
                      e('div', { className: 'student-preview-inline-note is-strong' },
                        e('strong', null, classLabel),
                        e('span', null, sharedAccessNeedsClass ? '先生側でクラス設定が必要です。' : '共有されたテストに合わせて固定されています。')
                      )
                    )
                  : e('label', null,
                      e('span', { className: 'student-field-label' }, 'クラス'),
                      e('select', { value: studentClassId, onChange: ev => { const cid = ev.target.value; setStudentClassId(cid); if(cid){ fetch('/api/tests?class_id='+cid+'&public=1').then(r=>r.json()).then(ts=>{ setStudentTests(ts || []); }).catch(()=> setMessage('テスト取得エラー')); } else { setStudentTests([]); } }, 'aria-label': 'クラス選択' }, [ e('option', { key: '__empty2', value: '' }, 'クラス選択') ].concat(classes.map(c=> e('option', { key: c.id, value: c.id }, c.name) )))
                    ),
                e('label', null,
                  e('span', { className: 'student-field-label' }, '表示名'),
                  e('input', { placeholder: '例: 佐藤 花子', value: studentName, onChange: ev => setStudentName(ev.target.value), 'aria-label': '名前' })
                )
              ),
              e('div', { className: 'student-preview-inline-note' },
                e('strong', null, hasStudentName ? (sharedStudentAccess ? '参加の準備ができました' : '開始の準備ができました') : '表示名を入力してください'),
                e('span', null, hasStudentName ? (sharedStudentAccess ? '下のカードからこのテストを開始できます。' : 'テストを選ぶと、そのまま回答を始められます。') : '入力が終わると開始ボタンが有効になります。')
              )
            ),
            e('section', { className: 'student-preview-panel' },
              e('div', { className: 'student-preview-panel__header' },
                e('div', null,
                  e('p', { className: 'student-preview-kicker student-preview-kicker-muted' }, '受験するテスト'),
                  e('h3', null, sharedStudentAccess ? '今回のテスト' : '開始するテストを選ぶ')
                ),
                e('span', { className: 'student-preview-caption' }, resolvedClassId ? classLabel : (sharedStudentAccess ? '共有設定を確認中' : 'クラス選択待ち'))
              ),
              renderTestCatalog(sharedStudentAccess ? 'テストを始める' : '学習をはじめる', attemptStartTest)
            )
          )
        );
      }
      if(!currentTest){
        if(finished){
          return e('div', { className: 'student-preview-shell' },
            studentBusyLabel ? e('div', { className: 'student-status-strip', role: 'status' }, studentBusyLabel) : null,
            e('section', { className: 'student-summary-hero' },
              e('div', { className: 'student-summary-hero__main' },
                e('p', { className: 'student-preview-kicker' }, 'ふりかえり'),
                e('h2', null, (summaryMeta.testName || 'この学習') + ' のふりかえり'),
                e('p', { className: 'student-preview-lead' }, summaryPercent >= 80 ? '理解できている内容が多い状態です。気になった問題だけを短く見直せます。' : (summaryPercent >= 60 ? '正解できた内容と迷った内容が分かるように整理しています。' : '見直すべき問題がすぐ分かるように、自分の答えと正答を並べています。')),
                e('div', { className: 'hero-actions student-summary-hero__actions' },
                  e('button', { onClick: sharedStudentAccess ? function(){ goToStudentStart(); } : clearStudentSummary, className: 'btn btn-primary', type: 'button' }, sharedStudentAccess ? 'もう一度このテストを受ける' : '別の学習を見る'),
                  sharedStudentAccess ? null : e('button', { onClick: function(){ goToStudentStart(); }, className: 'btn btn-ghost btn-ghost-contrast', type: 'button' }, '最初から確認し直す')
                )
              ),
              e('div', { className: 'student-score-orb', style: { '--score-angle': summaryPercent + '%' } },
                e('div', { className: 'student-score-orb__inner' },
                  e('span', { className: 'student-score-orb__eyebrow' }, '理解度'),
                  e('strong', { className: 'student-score-orb__value' }, summaryPercent + '%'),
                  e('span', { className: 'student-score-orb__sub' }, (summaryMeta.earned || 0) + ' / ' + (summaryMeta.total || 0))
                )
              )
            ),
            e('div', { className: 'student-summary-stats' }, [
              e('article', { key: 'sum-score', className: 'student-preview-stat' },
                e('span', { className: 'student-preview-stat__label' }, '得点'),
                e('strong', { className: 'student-preview-stat__value' }, (summaryMeta.earned || 0) + '点'),
                e('span', { className: 'student-preview-stat__note' }, '満点 ' + (summaryMeta.total || 0) + ' 点')
              ),
              e('article', { key: 'sum-correct', className: 'student-preview-stat' },
                e('span', { className: 'student-preview-stat__label' }, '正解数'),
                e('strong', { className: 'student-preview-stat__value' }, correctCount + '問'),
                e('span', { className: 'student-preview-stat__note' }, '全 ' + totalQuestions + ' 問中')
              ),
              e('article', { key: 'sum-student', className: 'student-preview-stat' },
                e('span', { className: 'student-preview-stat__label' }, '学習者'),
                e('strong', { className: 'student-preview-stat__value' }, student.name || studentName || '—'),
                e('span', { className: 'student-preview-stat__note' }, classLabel)
              )
            ]),
            e('section', { className: 'student-preview-panel' },
              e('div', { className: 'student-preview-panel__header' },
                e('div', null,
                  e('p', { className: 'student-preview-kicker student-preview-kicker-muted' }, 'ふりかえりノート'),
                  e('h3', null, '問題ごとのふりかえり')
                ),
                e('span', { className: 'student-preview-caption' }, '自分の答えとポイントを見直し')
              ),
              e('div', { className: 'student-summary-list' }, resultsSummary.map(function(r, index){
                const points = Number(r.points || 0);
                return e('article', { key: r.questionId || index, className: cx('student-summary-card', r.correct ? 'is-correct' : 'is-incorrect') },
                  e('div', { className: 'student-summary-card__header' },
                    e('div', null,
                      e('span', { className: 'student-summary-card__index' }, 'Q' + (index + 1)),
                      e('h4', null, r.text || '（無題）')
                    ),
                    e('span', { className: cx('student-status-pill', r.correct ? 'is-correct' : 'is-incorrect') }, r.correct ? '理解OK' : '見直し')
                  ),
                  e('div', { className: 'student-summary-card__meta' },
                    e('span', null, '配点 ' + points + ' 点'),
                    e('span', null, '獲得 ' + (r.correct ? points : 0) + ' 点')
                  ),
                  e('div', { className: 'student-summary-card__rows' },
                    e('div', { className: 'student-summary-row' },
                      e('span', { className: 'student-summary-row__label' }, 'あなたの回答'),
                      e('strong', null, formatAnswerTexts(r.given_texts, '未回答'))
                    ),
                    e('div', { className: 'student-summary-row' },
                      e('span', { className: 'student-summary-row__label' }, '正答'),
                      e('strong', null, formatAnswerTexts(r.correct_texts, '設定なし'))
                    ),
                    r.explanation ? e('div', { className: 'student-summary-row student-summary-row-note' },
                      e('span', { className: 'student-summary-row__label' }, '解説'),
                      e('span', null, r.explanation)
                    ) : null
                  )
                );
              }))
            )
          );
        }

        return e('div', { className: 'student-preview-shell' },
          studentBusyLabel ? e('div', { className: 'student-status-strip', role: 'status' }, studentBusyLabel) : null,
          e('section', { className: 'student-preview-banner student-preview-banner-loggedin' },
            e('div', { className: 'student-preview-banner__body' },
              e('p', { className: 'student-preview-kicker' }, '学習ロビー'),
              e('h2', null, (student.name || studentName || '学習者') + ' さんの学習ホーム'),
              e('p', { className: 'student-preview-lead' }, '公開中のテストから受験する内容を選択できます。')
            ),
            null
          ),
          e('div', { className: 'student-preview-grid' },
            e('section', { className: 'student-preview-panel student-preview-panel-spotlight' },
              e('div', { className: 'student-preview-panel__header' },
                e('div', null,
                  e('p', { className: 'student-preview-kicker student-preview-kicker-muted' }, 'プロフィール'),
                  e('h3', null, '学習の準備は完了')
                ),
                e('span', { className: 'student-preview-caption' }, '入力内容を確認できます')
              ),
              e('div', { className: 'student-preview-inline-note is-strong' },
                e('strong', null, student.name || studentName || '学習者'),
                e('span', null, '公開中のテストから選んで受験できます。')
              ),
              e('div', { className: 'hero-actions' },
                e('button', { onClick: function(){ goToStudentStart(); }, className: 'btn btn-ghost', type: 'button' }, '最初の画面へ戻る')
              )
            ),
            e('section', { className: 'student-preview-panel' },
              e('div', { className: 'student-preview-panel__header' },
                e('div', null,
                  e('p', { className: 'student-preview-kicker student-preview-kicker-muted' }, '学習メニュー'),
                  e('h3', null, '今日の学習メニュー')
                ),
                e('span', { className: 'student-preview-caption' }, classLabel)
              ),
              renderTestCatalog('この学習を始める', startTest)
            )
          )
        );
      }
      // Test in progress
      const q = currentQuestions[currentIndex];
      if(!q) return e('div', { className: 'task-empty' }, '問題がありません');

      const answeredCount = currentIndex;
      const progressPercent = currentQuestions.length ? Math.round(answeredCount / currentQuestions.length * 100) : 0;

      return e('div', { className: 'student-exam-shell' },
        e('section', { className: 'student-exam-main' },
          studentBusyLabel ? e('div', { className: 'student-status-strip', role: 'status' }, studentBusyLabel) : null,
          e('div', { className: 'student-exam-topbar' },
            e('div', null),
            
          ),
          e('section', { className: 'student-exam-panel student-exam-progress-panel' },
            e('div', { className: 'student-exam-progress-panel__header' },
              e('div', null,
                e('p', { className: 'student-preview-kicker student-preview-kicker-muted' }, 'テスト進捗'),
                e('h3', null, currentTest.name)
              ),
              e('span', { className: 'student-status-pill is-neutral' }, '進捗 ' + progressPercent + '%')
            ),
            e('p', { className: 'student-exam-progress-panel__lead' }, (student && student.name ? student.name : studentName || '学習者') + ' として学習中'),
            e('div', { className: 'student-exam-progress-bar' }, e('span', { style: { width: progressPercent + '%' } })),
            e('div', { className: 'student-exam-panel__meta' },
              e('span', null, '解答済み ' + answeredCount + ' / ' + currentQuestions.length),
              e('span', null, '残り ' + Math.max(currentQuestions.length - answeredCount, 0) + ' 問')
            )
          ),
          e('article', { className: 'student-question-card' },
            e('div', { className: 'student-question-card__header' },
                e('span', { className: 'student-question-card__type-label' }, q && q.type === 'multiple' ? '複数選択' : '１つ選択')
              ),
            e('h3', null, q.text),
            e('p', { className: 'student-question-card__hint' }, ''),
            e('div', { className: 'student-choice-list' }, (q.choices || []).map(function(c){
              const selected = currentSelection.includes(c.id);
              const inputType = q.type === 'multiple' ? 'checkbox' : 'radio';
              return e('label', { key: c.id, className: cx('student-choice-option', selected && 'is-selected') },
                e('input', { type: inputType, name: 'q' + q.id, checked: selected, disabled: !!studentBusyLabel, onChange: function(ev){ selectChoice(q, c.id, q.type === 'multiple' ? ev.target.checked : true); } }),
                e('span', { className: 'student-choice-option__marker' }),
                e('span', { className: 'student-choice-option__text' }, c.text)
              );
            }))
          ),
          e('div', { className: 'student-exam-actions' },
            e('button', { onClick: submitCurrentAnswer, className: 'btn btn-primary', type: 'button', disabled: !currentSelection.length || !!studentBusyLabel }, studentBusyLabel ? '送信中...' : '回答を送信')
          )
        )
      );
    }

    const studentNode = e('section', { className: 'task-page' },
      e('div', { className: 'task-section-card' },
        renderStudent()
      )
    );

    // Reports view (integrated)
      const filteredReports = (reports || []).filter(r => {
        const tn = (r.testName || '').toLowerCase();
      const un = (r.studentName || '').toLowerCase();
        // If a test is selected from the dropdown, match exact test name (case-insensitive)
        if(reportFilterTest && tn !== (reportFilterTest||'').toLowerCase()) return false;
      if(reportFilterUser && !un.includes((reportFilterUser||'').toLowerCase())) return false;
      // date range filter
      try{
        const preset = reportDatePreset || 'all';
        let rangeStart = null, rangeEnd = null;
        const now = new Date();
        if(preset === '7'){ rangeEnd = now; rangeStart = new Date(now.getTime() - 7*24*60*60*1000); }
        else if(preset === '30'){ rangeEnd = now; rangeStart = new Date(now.getTime() - 30*24*60*60*1000); }
        else if(preset === 'range'){
          if(reportDateFrom) rangeStart = new Date(reportDateFrom + 'T00:00:00');
          if(reportDateTo) rangeEnd = new Date(reportDateTo + 'T23:59:59');
        }
        if(rangeStart || rangeEnd){
          const dt = new Date(r.finished_at || r.started_at || r.created_at || null);
          if(isNaN(dt.getTime())) return false;
          if(rangeStart && dt < rangeStart) return false;
          if(rangeEnd && dt > rangeEnd) return false;
        }
      }catch(e){ /* ignore date parse errors, don't filter out */ }
      return true;
    });
    // Apply sorting to filteredReports based on selected key/dir
    const sortedReports = (filteredReports || []).slice();
    try{
      sortedReports.sort(function(a,b){
        const key = reportsSortKey || 'finished_at';
        let va = a[key];
        let vb = b[key];
        // normalize for known keys
        if(key === 'studentName' || key === 'testName'){
          va = String(va || '').toLowerCase(); vb = String(vb || '').toLowerCase();
        } else if(key === 'percent' || key === 'score' || key === 'maxScore'){
          va = Number(va || 0); vb = Number(vb || 0);
        } else { // date
          va = new Date(a.finished_at || a.started_at || a.created_at || '');
          vb = new Date(b.finished_at || b.started_at || b.created_at || '');
        }
        if(va < vb) return reportsSortDir === 'asc' ? -1 : 1;
        if(va > vb) return reportsSortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }catch(e){ /* ignore sort errors */ }
    const totalReports = sortedReports.length;
    const pages = Math.max(1, Math.ceil(totalReports / reportsPerPage));
    const currentPage = Math.min(Math.max(1, reportsPage || 1), pages);
    const pageSlice = sortedReports.slice((currentPage-1)*reportsPerPage, currentPage*reportsPerPage);

    function exportReportsCSV(){
      // CSV columns aligned with visible table: 日時, studentName, testName, score, maxScore, percent
      const rows = [['日時','studentName','testName','score','maxScore','percent']];
      filteredReports.forEach(r=> {
        const dt = r.finished_at || r.started_at || '';
        rows.push([dt || '記録なし', r.studentName||'', r.testName||'', r.score||0, r.maxScore||0, Math.round((r.percent||0)*100)/100]);
      });
      const csv = rows.map(r=> r.map(c=> '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'reports.csv'; a.click(); URL.revokeObjectURL(url);
    }

    const averageReportPercent = filteredReports.length
      ? Math.round(filteredReports.reduce(function(sum, r){ return sum + Number(r.percent || 0); }, 0) / filteredReports.length)
      : 0;
    const uniqueStudentsCount = Array.from(new Set(filteredReports.map(function(r){ return r.studentId || r.studentName || ''; }).filter(Boolean))).length;
    const selectedReportTest = reportFilterTest
      ? (tests || []).find(function(t){ return String(t.name || '') === String(reportFilterTest || ''); })
      : null;
    const selectedReportTestId = selectedReportTest ? selectedReportTest.id : '';
    const selectedReportRows = selectedReportTestId
      ? filteredReports.filter(function(row){ return String(row.testId || '') === String(selectedReportTestId); })
      : [];
    const selectedReportRowsKey = selectedReportRows.map(function(row, index){
      return [row.sessionId || '', row.studentId || '', row.finished_at || row.started_at || '', index].join('|');
    }).join('::');

    function buildSummaryFromAnswerRows(questionsForTest, answerRows, sessionId){
      const scopedRows = (answerRows || []).filter(function(answer){
        if(!sessionId) return true;
        if(answer && (answer.session_id === sessionId || String(answer.session_id || '') === String(sessionId))) return true;
        return false;
      });
      const fallbackRows = scopedRows.length ? scopedRows : (answerRows || []);
      const byQuestion = {};
      (fallbackRows || []).forEach(function(answer){
        const questionId = answer.question_id;
        if(!questionId) return;
        byQuestion[questionId] = byQuestion[questionId] || [];
        byQuestion[questionId].push(answer);
      });
      const details = (questionsForTest || []).map(function(question){
        const rows = byQuestion[question.id] || [];
        const questionCorrect = rows.some(function(answer){ return Number(answer.correct || 0) === 1; });
        return {
          question_id: question.id,
          correct: questionCorrect
        };
      });
      return { details: details };
    }

    function fetchReportAnalyticsSummary(testId, row, questionsForTest){
      const sessionId = row.sessionId || '';
      const cacheKey = [testId, row.studentId || '', sessionId].join(':');
      if(reportSummaryCacheRef.current[cacheKey]){
        return Promise.resolve(reportSummaryCacheRef.current[cacheKey]);
      }
      const params = new URLSearchParams();
      params.set('student_id', row.studentId || '');
      if(sessionId){
        params.set('session_id', sessionId);
      }

      return fetch('/api/teacher/tests/' + encodeURIComponent(testId) + '/summary?' + params.toString())
        .then(function(r){
          if(!r.ok) throw new Error('teacher_summary_unavailable');
          return r.json();
        })
        .catch(function(){
          return fetch('/api/studentAnswers?student_id=' + encodeURIComponent(row.studentId || '') + '&test_id=' + encodeURIComponent(testId))
            .then(function(r){
              if(!r.ok) throw new Error('student_answers_unavailable');
              return r.json();
            })
            .then(function(answerRows){
              return buildSummaryFromAnswerRows(questionsForTest, Array.isArray(answerRows) ? answerRows : [], sessionId);
            });
        })
        .then(function(summary){
          reportSummaryCacheRef.current[cacheKey] = summary;
          return summary;
        });
    }

    React.useEffect(function(){
      let cancelled = false;

      if(mode !== 'reports' || !selectedReportTest || !selectedReportTestId){
        setReportFilterAnalytics(null);
        setReportFilterAnalyticsLoading(false);
        return function(){ cancelled = true; };
      }

      const matchingRows = selectedReportRows;
      const validRows = matchingRows.filter(function(row){
        return row && row.studentId;
      });

      setReportFilterAnalyticsLoading(true);

      fetch('/api/tests/' + encodeURIComponent(selectedReportTest.id) + '/questions').then(function(r){
        if(!r.ok) throw new Error('questions_fetch_failed');
        return r.json();
      }).then(function(questionsForTest){
        return Promise.all([
          Promise.resolve(Array.isArray(questionsForTest) ? questionsForTest : []),
          Promise.allSettled(validRows.map(function(row){
            return fetchReportAnalyticsSummary(selectedReportTest.id, row, questionsForTest || []);
          }))
        ]);
      }).then(function(results){
        if(cancelled) return;
        const questionsForTest = Array.isArray(results[0]) ? results[0] : [];
        const settledSummaries = Array.isArray(results[1]) ? results[1] : [];
        const summaries = settledSummaries
          .filter(function(item){ return item && item.status === 'fulfilled' && item.value; })
          .map(function(item){ return item.value; });
        const failedCount = settledSummaries.filter(function(item){ return item && item.status === 'rejected'; }).length;
        const detailMap = {};
        questionsForTest.forEach(function(question, index){
          detailMap[question.id] = {
            questionId: question.id,
            label: 'Q' + (index + 1),
            text: question.text || '無題の問題',
            attempts: 0,
            correct: 0,
            rate: 0
          };
        });
        summaries.forEach(function(summary){
          (summary && summary.details || []).forEach(function(detail){
            if(!detailMap[detail.question_id]) return;
            detailMap[detail.question_id].attempts += 1;
            if(detail.correct) detailMap[detail.question_id].correct += 1;
          });
        });
        const questionRates = questionsForTest.map(function(question){
          var item = detailMap[question.id] || {
            questionId: question.id,
            label: 'Q?',
            text: question.text || '無題の問題',
            attempts: 0,
            correct: 0,
            rate: 0
          };
          item.rate = item.attempts ? Math.round(item.correct / item.attempts * 100) : 0;
          return item;
        });
        setReportFilterAnalytics({
          testId: selectedReportTest.id,
          testName: selectedReportTest.name || reportFilterTest,
          averagePercent: averageReportPercent,
          sampleSize: matchingRows.length,
          questionRates: questionRates,
          partialError: failedCount > 0 ? '一部の受験結果を集計できなかったため、表示は取得できたデータのみで計算しています。' : ''
        });
        setReportFilterAnalyticsLoading(false);
      }).catch(function(){
        if(cancelled) return;
        setReportFilterAnalytics({
          testId: selectedReportTest.id,
          testName: selectedReportTest.name || reportFilterTest,
          averagePercent: averageReportPercent,
          sampleSize: matchingRows.length,
          questionRates: [],
          error: '問題別集計の取得に失敗しました'
        });
        setReportFilterAnalyticsLoading(false);
      });

      return function(){
        cancelled = true;
      };
    }, [mode, selectedReportTest, selectedReportTestId, selectedReportRowsKey, averageReportPercent]);

    function makeSortHandler(key){
      return function(){
        if(reportsSortKey === key){ setReportsSortDir(reportsSortDir === 'asc' ? 'desc' : 'asc'); }
        else { setReportsSortKey(key); setReportsSortDir('asc'); }
        setReportsPage(1);
      };
    }

    function renderSortLabel(label, key){
      const arrow = reportsSortKey === key ? (reportsSortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return e('button', { onClick: makeSortHandler(key), className: 'sort-button', type: 'button', style: { background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' } }, label + arrow);
    }

    function renderReportFilterAnalytics(){
      if(!selectedReportTest){
        return null;
      }

      if(reportFilterAnalyticsLoading){
        return e('div', { className: 'report-filter-analytics report-filter-analytics--loading' }, 'テスト集計を読み込み中...');
      }

      if(!reportFilterAnalytics){
        return null;
      }

      const donutPercent = Math.max(0, Math.min(100, Number(reportFilterAnalytics.averagePercent || 0)));
      const donutStyle = {
        background: 'conic-gradient(var(--color-accent) 0 ' + donutPercent + '%, #dfe8f2 ' + donutPercent + '% 100%)'
      };

      return e('div', { className: 'report-filter-analytics' },
        e('div', { className: 'report-filter-analytics__header' },
          e('strong', null, '選択中テストの集計'),
          e('span', { className: 'small' }, (reportFilterAnalytics.testName || 'テスト') + ' / ' + String(reportFilterAnalytics.sampleSize || 0) + '件')
        ),
        e('div', { className: 'report-filter-analytics__grid' },
          e('section', { className: 'report-chart-card' },
            e('div', { className: 'report-chart-card__title' }, '平均正答率'),
            e('div', { className: 'report-donut-chart', style: donutStyle, role: 'img', 'aria-label': '平均正答率 ' + donutPercent + 'パーセント' },
              e('div', { className: 'report-donut-chart__center' },
                e('strong', null, donutPercent + '%'),
                e('span', null, '平均')
              )
            )
          ),
          e('section', { className: 'report-chart-card report-chart-card--bars' },
            e('div', { className: 'report-chart-card__title' }, '問題別の回答率'),
            reportFilterAnalytics.error
              ? e('div', { className: 'small' }, reportFilterAnalytics.error)
              : e(React.Fragment, null,
                  reportFilterAnalytics.partialError
                    ? e('div', { className: 'small report-filter-analytics__note' }, reportFilterAnalytics.partialError)
                    : null,
                  !(reportFilterAnalytics.questionRates || []).length
                    ? e('div', { className: 'small' }, '対象データがありません')
                    : e('div', { className: 'report-bars' },
                        reportFilterAnalytics.questionRates.map(function(item){
                          return e('div', { key: item.questionId, className: 'report-bars__row' },
                            e('div', { className: 'report-bars__meta' },
                              e('span', { className: 'report-bars__label' }, item.label),
                              e('span', { className: 'report-bars__text', title: item.text }, item.text),
                              e('span', { className: 'report-bars__value' }, item.rate + '%')
                            ),
                            e('div', { className: 'report-bars__track', 'aria-hidden': true },
                              e('div', { className: 'report-bars__fill', style: { width: item.rate + '%' } })
                            )
                          );
                        })
                      )
                )
          )
        )
      );
    }

    const reportsNode = e('section', { className: 'task-page' },
      e('div', { className: 'task-page-hero compact' },
        e('div', null,
          e('p', { className: 'eyebrow' }, '成績管理'),
          e('h1', null, '成績分析'),
          e('p', { className: 'lead' }, '受験結果の確認、絞り込み、詳細表示を行えます。')
        )
      ),
      e('div', { className: 'task-stat-grid compact' }, [
        e('article', { key: 'report-total', className: 'task-stat-card' },
          e('span', { className: 'task-stat-card__label' }, '対象件数'),
          e('strong', { className: 'task-stat-card__value' }, String(totalReports)),
          e('span', { className: 'task-stat-card__note' }, '現在の絞り込み結果')
        ),
        e('article', { key: 'report-avg', className: 'task-stat-card' },
          e('span', { className: 'task-stat-card__label' }, '平均正答率'),
          e('strong', { className: 'task-stat-card__value' }, averageReportPercent + '%'),
          e('span', { className: 'task-stat-card__note' }, '表示中データの平均')
        ),
        e('article', { key: 'report-students', className: 'task-stat-card' },
          e('span', { className: 'task-stat-card__label' }, '受験者'),
          e('strong', { className: 'task-stat-card__value' }, String(uniqueStudentsCount)),
          e('span', { className: 'task-stat-card__note' }, 'ユニーク人数')
        )
      ]),
      e('section', { className: 'task-section-card' },
        e('div', { className: 'task-section-heading' },
          e('div', { 'data-title-icon': 'filter' },
            e('h2', null, '絞り込み'),
            e('p', { className: 'section-note' }, 'テスト名、生徒名、期間で絞り込みます。')
          )
        ),
        e('div', { className: 'controls' },
          // テスト名は既存のテスト一覧から選べるようにする
          e('select', { value: reportFilterTest, onChange: ev => { setReportFilterTest(ev.target.value); setReportsPage(1); } },
            e('option', { value: '' }, 'テスト名でフィルタ（すべて）'),
            (tests || []).map(function(t){ return e('option', { key: t.id, value: t.name || '' }, t.name || ('テスト ' + t.id)); })
          ),
          e('input', { placeholder: '生徒名で検索', value: reportFilterUser, onChange: ev => { setReportFilterUser(ev.target.value); setReportsPage(1); } }),
          e('select', { value: reportDatePreset, onChange: ev => { setReportDatePreset(ev.target.value); setReportsPage(1); } },
            e('option', { value: 'all' }, '全期間'),
            e('option', { value: '7' }, '過去1週間'),
            e('option', { value: '30' }, '過去30日'),
            e('option', { value: 'range' }, '期間指定')
          ),
          reportDatePreset === 'range' ? e('input', { type: 'date', value: reportDateFrom, onChange: ev => { setReportDateFrom(ev.target.value); setReportsPage(1); } }) : null,
          reportDatePreset === 'range' ? e('input', { type: 'date', value: reportDateTo, onChange: ev => { setReportDateTo(ev.target.value); setReportsPage(1); } }) : null,
          e('button', { onClick: fetchReports, className: 'btn btn-primary', type: 'button' }, '更新'),
          e('button', { onClick: exportReportsCSV, className: 'btn btn-ghost', type: 'button' }, 'CSV出力')
        ),
        renderReportFilterAnalytics()
      ),
      e('section', { className: 'task-section-card' },
        e('div', { className: 'task-section-heading' },
          e('div', { 'data-title-icon': 'reports' },
            e('h2', null, '結果一覧'),
            e('p', { className: 'section-note' }, '詳細から設問ごとの結果を確認できます。')
          )
        ),
        e('div', { className: 'reports-layout' },
          e('div', { className: 'reports-main', style: { width: '100%' } },
            e('table', { className: 'reports-table' },
              e('thead', null, e('tr', null, e('th', null, renderSortLabel('日時','finished_at')), e('th', null, renderSortLabel('生徒名','studentName')), e('th', null, renderSortLabel('テスト名','testName')), e('th', null, renderSortLabel('得点','score')), e('th', null, e('span', null, '満点')), e('th', null, renderSortLabel('正答率','percent')), e('th', null, '操作'))),
              e('tbody', null,
                pageSlice.length === 0 ? e('tr', null, e('td', { colSpan: 7, className: 'small' }, reportsLoading ? '読み込み中...' : '該当するテストがありません')) : pageSlice.map(function(row, idx){
                  const keyId = (row.studentId||'')+'-'+(row.testId||'')+'-'+idx;
                  const pct = Math.round((row.percent||0)*100)/100;
                  const pctClass = pct >= 70 ? 'score high' : (pct >= 40 ? 'score' : 'score low');
                  const dtRaw = row.finished_at || row.started_at || '';
                  let dtDisp = '記録なし';
                  try{ if(dtRaw) dtDisp = new Date(dtRaw).toLocaleString(); }catch(e){ dtDisp = dtRaw || '記録なし'; }
                  return e('tr', { key: keyId },
                    e('td', null, dtDisp),
                    e('td', null, e('span', null, row.studentName || '—')),
                    e('td', null, e('div', { className: 'testName' }, row.testName || '—')),
                    e('td', null, e('span', { className: 'mono' }, String(row.score || 0))),
                    e('td', null, e('span', { className: 'mono' }, String(row.maxScore || 0))),
                    e('td', null, e('span', { className: pctClass }, pct + '%')),
                    e('td', null, e('button', { 'data-student': row.studentId||'', 'data-test': row.testId||'', onClick: function(){ showReportSummary(row); }, className: 'btn btn-small btn-ghost', type: 'button' }, '詳細'))
                  );
                })
              )
            ),
            e('div', { className: 'pagination small' },
              e('div', null, '表示: ' + ((currentPage-1)*reportsPerPage+1) + '-' + Math.min(currentPage*reportsPerPage, totalReports) + ' / ' + totalReports),
              e('div', { style: { marginLeft: 12 } }, e('button', { onClick: ()=> setReportsPage(Math.max(1, currentPage-1)), disabled: currentPage<=1, className: 'btn btn-small btn-ghost', type: 'button' }, '< 前'), e('button', { onClick: ()=> setReportsPage(Math.min(pages, currentPage+1)), disabled: currentPage>=pages, style: { marginLeft: 8 }, className: 'btn btn-small btn-ghost', type: 'button' }, '次 >'))
            )
          )
        )
      )
    );

    // render modal for selected report
    let summaryModal = null;
    if(reportSummaryOpen && reportSummaryData){
      const modalChildren = [];
      modalChildren.push(e('h2', null, 'テストサマリー'));
      if(reportSummaryData.loading){
        modalChildren.push(e('div', null, '読み込み中...'));
      } else if(reportSummaryData.error){
        modalChildren.push(e('div', null, reportSummaryData.error));
      } else {
        modalChildren.push(e('div', null, e('strong', null, (reportSummaryData.meta && reportSummaryData.meta.testName) || '—')));
        modalChildren.push(e('div', null, '生徒名: ' + ((reportSummaryData.meta && reportSummaryData.meta.studentName) || '—')));
        modalChildren.push(e('div', null, '得点: ' + (reportSummaryData.earned_points != null ? reportSummaryData.earned_points : (reportSummaryData.meta && reportSummaryData.meta.score) || 0) + ' / ' + (reportSummaryData.total_points != null ? reportSummaryData.total_points : (reportSummaryData.meta && reportSummaryData.meta.maxScore) || '—')));
        modalChildren.push(e('div', null, '正答率: ' + (reportSummaryData.meta && typeof reportSummaryData.meta.percent !== 'undefined' ? (Math.round((reportSummaryData.meta.percent||0)*100)/100 + '%') : (reportSummaryData.total_points ? (Math.round((reportSummaryData.earned_points || 0) / reportSummaryData.total_points * 10000)/100 + '%') : '—'))));
        modalChildren.push(e('hr'));
        modalChildren.push(e('div', null, e('strong', null, '設問ごとの内訳')));
        if(!(reportSummaryData.details || []).length){
          modalChildren.push(e('div', null, '設問データがありません'));
        } else {
          modalChildren.push(e('ol', null, (reportSummaryData.details || []).map(function(d){
            return e('li', { key: d.question_id, style: { marginBottom: 12 } },
              e('div', null, e('strong', null, d.text || '（無題）')),
              e('div', null, '配点: ' + (d.points || 0) + ' — ', d.correct ? e('span', { style: { color: '#157a3b', fontWeight: 700 } }, '正解') : e('span', { style: { color: '#b33', fontWeight: 700 } }, '不正解')),
              e('div', null, 'あなたの回答: ' + ((d.given_texts && d.given_texts.length) ? d.given_texts.join(', ') : '未回答')),
              e('div', null, '正答: ' + ((d.correct_texts && d.correct_texts.length) ? d.correct_texts.join(', ') : ''))
            );
          })));
        }
        modalChildren.push(e('div', { style: { marginTop: 12, textAlign: 'right' } }, e('button', { onClick: function(){ closeReportSummary(); }, className: 'btn' }, '閉じる')));
      }
      summaryModal = e('div', { id: 'modal-overlay', role: 'dialog', 'aria-modal': true }, e('div', { id: 'modal-content', tabIndex: -1 }, modalChildren));
    }

    let qrShareNode = null;
    if(qrShareModal.open){
      qrShareNode = e('div', { id: 'modal-overlay', role: 'dialog', 'aria-modal': true },
        e('div', { id: 'modal-content', tabIndex: -1 },
          e('div', { className: 'share-qr-modal' },
            e('div', { className: 'share-qr-modal__meta' },
              e('p', { className: 'student-preview-kicker student-preview-kicker-muted' }, '共有URL'),
              e('h2', null, qrShareModal.testName + ' の共有QR'),
              e('p', { className: 'section-note' }, qrShareModal.className + ' の生徒がこのURLからテストに参加できます。')
            ),
            e('div', { className: 'share-qr-modal__grid' },
              e('div', { className: 'share-qr-modal__code' },
                qrShareModal.loading
                  ? e('div', { className: 'share-qr-modal__placeholder' }, 'QRコードを生成中...')
                  : (qrShareModal.qrDataUrl
                      ? e('img', { src: qrShareModal.qrDataUrl, alt: qrShareModal.testName + ' のQRコード' })
                      : e('div', { className: 'share-qr-modal__placeholder' }, qrShareModal.error || 'QRコードを表示できません'))
              ),
              e('div', { className: 'share-qr-modal__details' },
                e('label', null,
                  e('span', { className: 'student-field-label' }, 'アクセスURL'),
                  e('input', { value: qrShareModal.url, readOnly: true, 'aria-label': 'アクセスURL' })
                ),
                e('p', { className: 'share-qr-modal__hint' }, '生徒はこのQRコードまたはURLから、生徒向けテスト画面にアクセスできます。'),
                qrShareModal.error ? e('p', { className: 'share-qr-modal__error' }, qrShareModal.error) : null,
                e('div', { className: 'hero-actions' },
                  e('button', { onClick: function(){ copySharedUrl(qrShareModal.url); }, className: 'btn btn-primary', type: 'button' }, 'URLをコピー'),
                  e('a', { href: qrShareModal.url, target: '_blank', rel: 'noreferrer', className: 'btn btn-ghost', onClick: function(){ closeQrShareModal(); } }, '別タブで確認')
                )
              )
            ),
            e('div', { className: 'share-qr-modal__actions' },
              e('button', { onClick: closeQrShareModal, className: 'btn btn-ghost', type: 'button' }, '閉じる')
            )
          )
        )
      );
    }

    const workspaceMeta = mode === 'reports'
      ? { eyebrow: '教員メニュー', title: '成績分析', description: '受験結果の確認' }
      : (mode === 'student'
        ? { eyebrow: '教員メニュー', title: '生徒画面プレビュー', description: '配布前の表示確認' }
        : { eyebrow: '教員メニュー', title: 'テスト準備', description: 'テストの作成と管理' });
    const teacherDisplayName = teacherUser && typeof teacherUser.display_name === 'string'
      ? teacherUser.display_name.trim()
      : '';
    const teacherUsername = teacherUser && typeof teacherUser.username === 'string'
      ? teacherUser.username.trim()
      : '';
    const teacherHeaderName = teacherDisplayName || teacherUsername;

    if(sharedStudentAccess){
      return e('main', { id: 'main-content', className: 'app-shell', role: 'main' },
        message ? e('div', { className: 'app-status', 'aria-live': 'polite' }, message) : null,
        studentNode,
        summaryModal,
        qrShareNode
      );
    }

    // Top-level container with teacher-centered navigation
    return e('main', { id: 'main-content', className: 'app-shell', role: 'main' },
      e('header', { className: 'app-topbar' },
        e('div', { className: 'app-topbar-main' },
          e('div', { className: 'app-brand-stack' },
            e('div', { className: 'app-brand' },
              e('div', { className: 'app-brand-mark' }, 'IT'),
              e('div', { className: 'app-brand-copy' },
                e('strong', null, 'InstantTest'),
                  e('span', null, 'テスト作成・配布・採点')
              )
            ),
            teacherHeaderName ? e('div', { className: 'app-brand-teacher', 'aria-label': 'ログイン中の教師' },
              e('span', { className: 'app-brand-teacher__label' }, '担当教師'),
              e('strong', { className: 'app-brand-teacher__name' }, teacherHeaderName),
              teacherDisplayName && teacherUsername && teacherDisplayName !== teacherUsername
                ? e('span', { className: 'app-brand-teacher__meta' }, '@' + teacherUsername)
                : null
            ) : null
          ),
          e('div', { className: 'app-workspace-context' },
            e('span', { className: 'app-workspace-context__eyebrow' }, workspaceMeta.eyebrow),
            e('div', { className: 'app-workspace-context__heading' },
              e('strong', { className: 'app-workspace-context__title' }, workspaceMeta.title)
            ),
            e('span', { className: 'app-workspace-context__description' }, workspaceMeta.description)
          )
        ),
        e('div', { className: 'app-topbar-actions' },
          e('nav', { className: 'mode-tabs', 'aria-label': '先生向け主導線' },
            e('div', { className: 'mode-tab-group' },
              e('button', { onClick: ()=> setMode('teacher'), className: mode==='teacher' ? 'mode-tab is-active' : 'mode-tab', type: 'button' }, 'ダッシュボード'),
              e('button', { onClick: ()=> setMode('reports'), className: mode==='reports' ? 'mode-tab is-active' : 'mode-tab', type: 'button' }, '成績分析')
            ),
            e('div', { className: 'mode-tab-group mode-tab-group-utility' },
              e('button', { onClick: ()=> setMode('student'), className: mode==='student' ? 'mode-tab mode-tab-utility is-active' : 'mode-tab mode-tab-utility', type: 'button' }, 'テスト画面プレビュー'),
              e('button', { onClick: logoutTeacher, className: 'mode-tab mode-tab-utility', type: 'button' }, 'ログアウト')
            )
          )
        )
      ),
      message ? e('div', { className: 'app-status', 'aria-live': 'polite' }, message) : null,
      mode === 'teacher' ? teacherNode : (mode === 'student' ? studentNode : reportsNode),
      summaryModal,
      qrShareNode
    );
  }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();
