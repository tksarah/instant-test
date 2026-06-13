(function(){
  const e = React.createElement;
  function renderRichQuestionContent(question, options){
    const config = options || {};
    const html = question && typeof question.content_html === 'string' ? question.content_html.trim() : '';
    const className = config.className || 'rich-question-content';
    if(html){
      return e('div', { className: className, dangerouslySetInnerHTML: { __html: html } });
    }
    return e(config.fallbackTag || 'div', { className: className }, (question && (question.text || question.question_text)) || config.fallbackText || '');
  }

  function renderQuestionList(items){
    if(!items || items.length === 0){
      return e('p', null, '（問題がありません）');
    }
    return e('ol', null, items.map(function(q){
      return e('li', { key: q.id },
        renderRichQuestionContent(q, { className: 'rich-question-content rich-question-content--compact' }),
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
                q.content_html ? renderRichQuestionContent(q, { className: 'rich-question-content rich-question-content--compact' }) : null,
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

  const ANSWER_MODE_OPTIONS = [
    { value: 'immediate_feedback', label: '毎問フィードバック', description: '回答ごとに正解と解説を確認できます。' },
    { value: 'deferred_summary', label: '最後にふりかえり', description: '最後にまとめて採点し、振り返りページで見直します。' },
    { value: 'exam_mode', label: '試験モード', description: '全問回答後は試験終了だけを表示します。' }
  ];

  function getAnswerModeValue(source){
    const value = source && typeof source === 'object' ? source.answer_mode : source;
    if(value === 'immediate_feedback') return 'immediate_feedback';
    if(value === 'exam_mode') return 'exam_mode';
    return 'deferred_summary';
  }

  function isImmediateFeedbackMode(source){
    return getAnswerModeValue(source) === 'immediate_feedback';
  }

  function isExamMode(source){
    return getAnswerModeValue(source) === 'exam_mode';
  }

  function normalizeTimeLimitMinutes(value, answerMode){
    if(getAnswerModeValue(answerMode) !== 'exam_mode') return null;
    if(value === null || typeof value === 'undefined' || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function getTimeLimitMinutes(source){
    if(!isExamMode(source)) return null;
    return normalizeTimeLimitMinutes(source && typeof source === 'object' ? source.time_limit_minutes : source, 'exam_mode');
  }

  function formatTimeLimitLabel(source){
    const minutes = getTimeLimitMinutes(source);
    return minutes ? ('制限 ' + minutes + '分') : '制限なし';
  }

  function formatRemainingTime(totalSeconds){
    const safeSeconds = Math.max(0, parseInt(totalSeconds, 10) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  function computeRemainingSeconds(deadlineAt, serverOffsetMs){
    if(!deadlineAt) return null;
    const deadlineMs = Date.parse(deadlineAt);
    if(!Number.isFinite(deadlineMs)) return null;
    const remainingMs = deadlineMs - (Date.now() + (Number(serverOffsetMs) || 0));
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  function getAnswerModeLabel(source){
    const value = getAnswerModeValue(source);
    const option = ANSWER_MODE_OPTIONS.find(function(item){ return item.value === value; });
    return option ? option.label : ANSWER_MODE_OPTIONS[1].label;
  }

  function getAnswerModeDescription(source){
    const value = getAnswerModeValue(source);
    const option = ANSWER_MODE_OPTIONS.find(function(item){ return item.value === value; });
    return option ? option.description : ANSWER_MODE_OPTIONS[1].description;
  }

  function getTeacherTestManagementState(test, questionCount){
    if(test && test.archived){
      return {
        label: 'アーカイブ済み',
        detail: '通常一覧から外しています。必要なときだけ表示して復元できます。',
        tone: 'muted'
      };
    }
    const normalizedQuestionCount = Number(questionCount || 0);
    if(!normalizedQuestionCount){
      return {
        label: '要問題作成',
        detail: 'まずは問題を追加すると、配布準備を進めやすくなります。',
        tone: 'warning'
      };
    }
    if(!getTestClassIds(test).length){
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

  function getTestClassIds(test){
    const ids = Array.isArray(test && test.class_ids)
      ? test.class_ids
      : (test && test.class_id ? [test.class_id] : []);
    return Array.from(new Set(ids.map(function(id){ return String(id); }).filter(Boolean)));
  }

  function isTestAssignedToClass(test, classId){
    if(!classId) return false;
    return getTestClassIds(test).indexOf(String(classId)) !== -1;
  }

  function getAssignedClasses(test, classes){
    if(Array.isArray(test && test.assigned_classes) && test.assigned_classes.length){
      return test.assigned_classes;
    }
    const ids = getTestClassIds(test);
    return (classes || []).filter(function(c){ return ids.indexOf(String(c.id)) !== -1; });
  }

  function getAssignmentLabel(test, classes){
    const assigned = getAssignedClasses(test, classes);
    if(assigned.length === 0) return '未割当';
    if(assigned.length === 1) return assigned[0].name || '1クラス';
    return assigned.length + 'クラス';
  }

  function getSetClassIds(testSet){
    const ids = Array.isArray(testSet && testSet.class_ids) ? testSet.class_ids : [];
    return Array.from(new Set(ids.map(function(id){ return String(id); }).filter(Boolean)));
  }

  function getSetAssignedClasses(testSet, classes){
    if(Array.isArray(testSet && testSet.assigned_classes) && testSet.assigned_classes.length){
      return testSet.assigned_classes;
    }
    const ids = getSetClassIds(testSet);
    return (classes || []).filter(function(c){ return ids.indexOf(String(c.id)) !== -1; });
  }

  function getSetAssignmentLabel(testSet, classes){
    const assigned = getSetAssignedClasses(testSet, classes);
    if(assigned.length === 0) return '未割当';
    if(assigned.length === 1) return assigned[0].name || '1クラス';
    return assigned.length + 'クラス';
  }

  function getInitialRouteState(){
    const params = new URLSearchParams(window.location.search || '');
    const sharedTestId = (params.get('test_id') || '').trim();
    const sharedSetId = (params.get('set_id') || '').trim();
    const sharedClassId = (params.get('class_id') || '').trim();
    return {
      sharedStudentAccess: params.get('access') === 'student' && (!!sharedTestId || !!sharedSetId),
      sharedTestId: sharedTestId,
      sharedSetId: sharedSetId,
      sharedClassId: sharedClassId
    };
  }

  function buildStudentAccessUrl(test, classId){
    const url = new URL(window.location.pathname || '/', window.location.origin);
    url.searchParams.set('access', 'student');
    url.searchParams.set('test_id', String(test.id));
    const resolvedClassId = classId || (getTestClassIds(test)[0] || '');
    if(resolvedClassId){
      url.searchParams.set('class_id', String(resolvedClassId));
    }
    return url.toString();
  }

  function buildStudentSetAccessUrl(testSet, classId){
    const url = new URL(window.location.pathname || '/', window.location.origin);
    url.searchParams.set('access', 'student');
    url.searchParams.set('set_id', String(testSet.id));
    const resolvedClassId = classId || (getSetClassIds(testSet)[0] || '');
    if(resolvedClassId){
      url.searchParams.set('class_id', String(resolvedClassId));
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
    const sharedStudentSetId = initialRoute.current.sharedSetId;
    const sharedStudentClassId = initialRoute.current.sharedClassId;
    const [teacherUser, setTeacherUser] = React.useState(null);
    const [classes, setClasses] = React.useState([]);
    const [tests, setTests] = React.useState([]);
    const [testSets, setTestSets] = React.useState([]);
      const [testQuestionCounts, setTestQuestionCounts] = React.useState({});
    const [className, setClassName] = React.useState('');
    const [selectedClass, setSelectedClass] = React.useState(null);
    const [testName, setTestName] = React.useState('');
    const [testPublic, setTestPublic] = React.useState(false);
    const [testRandomize, setTestRandomize] = React.useState(false);
    const [testAnswerMode, setTestAnswerMode] = React.useState('deferred_summary');
    const [testTimeLimitMinutes, setTestTimeLimitMinutes] = React.useState('');
    const [setName, setSetName] = React.useState('');
    const [setDescription, setSetDescription] = React.useState('');
    const [setPublic, setSetPublic] = React.useState(false);
    const [setClassIds, setSetClassIds] = React.useState([]);
    const [setTestIds, setSetTestIds] = React.useState([]);
    const [setTestSourceTab, setSetTestSourceTab] = React.useState('public');
    const [textForAI, setTextForAI] = React.useState('');
    const [message, setMessage] = React.useState('');
    const [questions, setQuestions] = React.useState([]);
    const [modalOpen, setModalOpen] = React.useState(false);
    const [modalQuestions, setModalQuestions] = React.useState([]);
    const [mode, setMode] = React.useState(sharedStudentAccess ? 'student' : 'teacher');
    const [teacherTestQuery, setTeacherTestQuery] = React.useState('');
    const [teacherFilterClassId, setTeacherFilterClassId] = React.useState('');
    const [teacherArchiveView, setTeacherArchiveView] = React.useState('active');
    const [teacherActiveClassViewId, setTeacherActiveClassViewId] = React.useState('');
    const [teacherArchivedClassViewId, setTeacherArchivedClassViewId] = React.useState('');
    const [teacherTestViewMode, setTeacherTestViewMode] = React.useState('compact');
    const [expandedTeacherTests, setExpandedTeacherTests] = React.useState({});
    const [editingTestId, setEditingTestId] = React.useState(null);
    const [editingTestName, setEditingTestName] = React.useState('');
    const [editingTestBusy, setEditingTestBusy] = React.useState(false);
    const [teacherNoteDrafts, setTeacherNoteDrafts] = React.useState({});
    const [teacherNoteSavingId, setTeacherNoteSavingId] = React.useState(null);
    const [assignmentModal, setAssignmentModal] = React.useState({
      open: false,
      test: null,
      classIds: [],
      saving: false
    });
    const [qrShareModal, setQrShareModal] = React.useState({
      open: false,
      loading: false,
      kind: 'test',
      test: null,
      testName: '',
      className: '',
      classId: '',
      url: '',
      qrDataUrl: '',
      error: ''
    });
    const [testDeleteModal, setTestDeleteModal] = React.useState({
      open: false,
      test: null,
      cascade: false,
      loading: false,
      dependencyInfo: null
    });
    const [classDeleteModal, setClassDeleteModal] = React.useState({
      open: false,
      classItem: null,
      cascade: false,
      loading: false,
      dependencyInfo: null
    });
    const [testSetDeleteModal, setTestSetDeleteModal] = React.useState({
      open: false,
      testSet: null,
      loading: false
    });

    // Student states
    const [studentName, setStudentName] = React.useState('');
    const [studentClassId, setStudentClassId] = React.useState('');
    const [student, setStudent] = React.useState(null);
    const [studentTests, setStudentTests] = React.useState([]);
    const [studentSets, setStudentSets] = React.useState([]);
    const [selectedStudentSet, setSelectedStudentSet] = React.useState(null);
    const [currentTest, setCurrentTest] = React.useState(null);
    const [currentQuestions, setCurrentQuestions] = React.useState([]);
    const [currentIndex, setCurrentIndex] = React.useState(0);
    const [currentSelection, setCurrentSelection] = React.useState([]);
    const [lastResult, setLastResult] = React.useState(null);
    const [resultsSummary, setResultsSummary] = React.useState([]);
    const [summaryMeta, setSummaryMeta] = React.useState(null);
    const [examCompletionMeta, setExamCompletionMeta] = React.useState(null);
    const [examCloseHintVisible, setExamCloseHintVisible] = React.useState(false);
    const [currentSessionId, setCurrentSessionId] = React.useState(null);
    const [examDeadlineAt, setExamDeadlineAt] = React.useState(null);
    const [examServerOffsetMs, setExamServerOffsetMs] = React.useState(0);
    const [examRemainingSeconds, setExamRemainingSeconds] = React.useState(null);
    const [answersByQuestionId, setAnswersByQuestionId] = React.useState({});
    const [examReviewVisible, setExamReviewVisible] = React.useState(false);
    const [reviewingQuestionIndex, setReviewingQuestionIndex] = React.useState(null);
    // Reports (integrated) state
    const [reports, setReports] = React.useState([]);
    const [reportsLoading, setReportsLoading] = React.useState(false);
    const [reportsPage, setReportsPage] = React.useState(1);
    const [reportsPerPage] = React.useState(10);
    const [reportsSortKey, setReportsSortKey] = React.useState('finished_at');
    const [reportsSortDir, setReportsSortDir] = React.useState('desc'); // 'asc' or 'desc'
    const [reportFilterTest, setReportFilterTest] = React.useState('');
    const [reportFilterClassId, setReportFilterClassId] = React.useState('');
    const [reportFilterUser, setReportFilterUser] = React.useState('');
    const [reportDatePreset, setReportDatePreset] = React.useState('all');
    const [reportDateFrom, setReportDateFrom] = React.useState('');
    const [reportDateTo, setReportDateTo] = React.useState('');
    const [reportSummaryOpen, setReportSummaryOpen] = React.useState(false);
    const [reportSummaryData, setReportSummaryData] = React.useState(null);
    const [reportFilterAnalytics, setReportFilterAnalytics] = React.useState(null);
    const [reportFilterAnalyticsLoading, setReportFilterAnalyticsLoading] = React.useState(false);
    const [testSetSummaries, setTestSetSummaries] = React.useState([]);
    const [testSetSummariesLoading, setTestSetSummariesLoading] = React.useState(false);
    const [initialDataLoading, setInitialDataLoading] = React.useState(true);
    const [studentBusyLabel, setStudentBusyLabel] = React.useState('');
    const reportSummaryCacheRef = React.useRef({});
    const examAutoSubmitRef = React.useRef(false);
    // selectedUserId / selectedUserSummary removed (side-card feature disabled)
    React.useEffect(()=>{
      setInitialDataLoading(true);

      if(sharedStudentAccess){
        Promise.all([
          fetch('/api/classes').then(function(r){ return r.json(); }),
          fetch('/api/tests').then(function(r){ return r.json(); }),
          fetch('/api/test-sets').then(function(r){ return r.json(); })
        ]).then(function(results){
          setClasses(results[0] || []);
          setTests(results[1] || []);
          setTestSets(results[2] || []);
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
          fetch('/api/tests?include_archived=1').then(function(r){ return r.json(); }),
          fetch('/api/test-sets?include_archived=1').then(function(r){ return r.json(); })
        ]);
      }).then(function(results){
        if(!results) return;
        setClasses(results[0] || []);
        setTests(results[1] || []);
        setTestSets(results[2] || []);
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
      if(!sharedStudentAccess) return;
      const matchedTest = tests.find(function(t){ return String(t.id) === String(sharedStudentTestId); }) || null;
      const matchedSet = testSets.find(function(s){ return String(s.id) === String(sharedStudentSetId); }) || null;
      if(sharedStudentTestId) setStudentTests(matchedTest ? [matchedTest] : []);
      if(sharedStudentSetId){
        setStudentSets(matchedSet ? [matchedSet] : []);
        setSelectedStudentSet(matchedSet || null);
      }
      if(sharedStudentClassId){
        setStudentClassId(String(sharedStudentClassId));
      } else if(matchedTest && matchedTest.class_id){
        setStudentClassId(String(matchedTest.class_id));
      } else if(matchedSet){
        const ids = getSetClassIds(matchedSet);
        if(ids.length) setStudentClassId(String(ids[0]));
      }
    }, [sharedStudentAccess, sharedStudentTestId, sharedStudentSetId, sharedStudentClassId, tests, testSets]);
    React.useEffect(function(){
      if(modalOpen){
        setTimeout(function(){ var mc = document.getElementById('modal-content'); if(mc) mc.focus(); }, 0);
      }
    }, [modalOpen]);
    React.useEffect(function(){
      if(!currentTest || !currentSessionId || !isExamMode(currentTest) || !examDeadlineAt){
        setExamRemainingSeconds(null);
        return;
      }
      function tick(){
        const remaining = computeRemainingSeconds(examDeadlineAt, examServerOffsetMs);
        setExamRemainingSeconds(remaining);
        if(remaining === 0 && !examAutoSubmitRef.current){
          examAutoSubmitRef.current = true;
          finalizeCurrentTest('time_limit');
        }
      }
      tick();
      const timerId = window.setInterval(tick, 1000);
      return function(){ window.clearInterval(timerId); };
    }, [currentTest, currentSessionId, examDeadlineAt, examServerOffsetMs, currentIndex, currentSelection, examReviewVisible, reviewingQuestionIndex]);
    React.useEffect(function(){
      if(!testDeleteModal.open) return;
      function onKeyDown(event){
        if(event.key === 'Escape' && !testDeleteModal.loading){
          closeTestDeleteModal();
        }
      }
      document.addEventListener('keydown', onKeyDown);
      return function(){ document.removeEventListener('keydown', onKeyDown); };
    }, [testDeleteModal.open, testDeleteModal.loading]);
    React.useEffect(function(){
      if(!classDeleteModal.open) return;
      function onKeyDown(event){
        if(event.key === 'Escape' && !classDeleteModal.loading){
          closeClassDeleteModal();
        }
      }
      document.addEventListener('keydown', onKeyDown);
      return function(){ document.removeEventListener('keydown', onKeyDown); };
    }, [classDeleteModal.open, classDeleteModal.loading]);
    React.useEffect(function(){
      if(!testSetDeleteModal.open) return;
      function onKeyDown(event){
        if(event.key === 'Escape' && !testSetDeleteModal.loading){
          closeTestSetDeleteModal();
        }
      }
      document.addEventListener('keydown', onKeyDown);
      return function(){ document.removeEventListener('keydown', onKeyDown); };
    }, [testSetDeleteModal.open, testSetDeleteModal.loading]);
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
    function openClassDeleteModal(c){
      if(!c) return;
      setClassDeleteModal({
        open: true,
        classItem: c,
        cascade: false,
        loading: false,
        dependencyInfo: null
      });
    }
    function closeClassDeleteModal(){
      setClassDeleteModal({
        open: false,
        classItem: null,
        cascade: false,
        loading: false,
        dependencyInfo: null
      });
    }
    function confirmClassDelete(){
      const modal = classDeleteModal;
      const c = modal.classItem;
      if(!c || modal.loading) return;
      setClassDeleteModal(function(prev){ return Object.assign({}, prev, { loading: true }); });
      const url = '/api/classes/' + c.id + (modal.cascade ? '?cascade=1' : '');
      fetch(url, { method: 'DELETE' }).then(async r=>{
        if(r.ok){
          setClasses(prev=> prev.filter(x=> x.id !== c.id));
          if(selectedClass && selectedClass.id === c.id) setSelectedClass(null);
          setMessage(modal.cascade ? '関連データを含め削除しました' : '削除しました');
          closeClassDeleteModal();
        } else {
          const json = await r.json().catch(()=> ({ error: '削除失敗' }));
          if(json && json.error === 'has_dependencies' && !modal.cascade){
            setClassDeleteModal(function(prev){
              return Object.assign({}, prev, {
                cascade: true,
                loading: false,
                dependencyInfo: {
                  tests: json.tests || 0,
                  students: json.students || 0
                }
              });
            });
          } else { setMessage(json && json.error ? json.error : '削除エラー'); }
        }
      }).catch(()=> setMessage('通信エラー')).finally(function(){
        setClassDeleteModal(function(prev){
          return prev.open ? Object.assign({}, prev, { loading: false }) : prev;
        });
      });
    }
    function deleteClass(c){
      openClassDeleteModal(c);
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
      const selectedClassIds = selectedClass ? [selectedClass.id] : [];
      const timeLimitMinutes = normalizeTimeLimitMinutes(testTimeLimitMinutes, testAnswerMode);
      fetch('/api/tests',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({class_ids:selectedClassIds, class_id:selectedClass?selectedClass.id:null, name:testName, public: testPublic, randomize: testRandomize, answer_mode: testAnswerMode, time_limit_minutes: timeLimitMinutes, teacher_note: ''})}).then(r=>r.json()).then(n=>{ setTests(prev=>prev.concat(Object.assign({id:n.id, name:testName, class_id:selectedClass?selectedClass.id:null, class_ids:selectedClassIds, assigned_classes:selectedClass ? [{ id: selectedClass.id, name: selectedClass.name }] : [], public: testPublic?1:0, randomize: testRandomize?1:0, answer_mode: n && n.answer_mode ? n.answer_mode : testAnswerMode, time_limit_minutes: n && typeof n.time_limit_minutes !== 'undefined' ? n.time_limit_minutes : timeLimitMinutes, archived: 0, teacher_note: ''}, n || {}))); setTestName(''); setTestPublic(false); setTestRandomize(false); setTestAnswerMode('deferred_summary'); setTestTimeLimitMinutes(''); });
    }
    function toggleSetClassId(classId){
      const id = String(classId);
      setSetClassIds(function(prev){
        return prev.indexOf(id) === -1 ? prev.concat(id) : prev.filter(function(x){ return x !== id; });
      });
    }
    function toggleSetTestId(testId){
      const id = String(testId);
      setSetTestIds(function(prev){
        return prev.indexOf(id) === -1 ? prev.concat(id) : prev.filter(function(x){ return x !== id; });
      });
    }
    function createTestSet(){
      const name = (setName || '').trim();
      if(!name){
        window.alert('まとめ名を入力してください');
        return;
      }
      if(!setClassIds.length){
        window.alert('配布先クラスを1つ以上選んでください');
        return;
      }
      if(!setTestIds.length){
        window.alert('含めるテストを1つ以上選んでください');
        return;
      }
      fetch('/api/test-sets', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          name: name,
          description: setDescription || '',
          public: setPublic ? 1 : 0,
          class_ids: setClassIds,
          test_ids: setTestIds
        })
      }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); }).then(function(result){
        if(!result.ok || result.body.error){
          setMessage(result.body && result.body.error ? result.body.error : 'まとめ配布の作成に失敗しました');
          return;
        }
        setTestSets(function(prev){ return prev.concat(result.body); });
        setSetName('');
        setSetDescription('');
        setSetPublic(false);
        setSetClassIds([]);
        setSetTestIds([]);
        setMessage('まとめ配布を作成しました');
      }).catch(function(){
        setMessage('まとめ配布の作成に失敗しました');
      });
    }
    function toggleTestSetPublic(testSet){
      fetch('/api/test-sets/' + encodeURIComponent(testSet.id), {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ public: testSet.public ? 0 : 1 })
      }).then(function(r){ return r.json(); }).then(function(updated){
        if(updated && updated.error){ setMessage(updated.error); return; }
        setTestSets(function(prev){ return prev.map(function(item){ return item.id === updated.id ? updated : item; }); });
      }).catch(function(){ setMessage('まとめ配布の公開設定を更新できませんでした'); });
    }
    function archiveTestSet(testSet){
      fetch('/api/test-sets/' + encodeURIComponent(testSet.id), {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ archived: testSet.archived ? 0 : 1, public: testSet.archived ? testSet.public : 0 })
      }).then(function(r){ return r.json(); }).then(function(updated){
        if(updated && updated.error){ setMessage(updated.error); return; }
        setTestSets(function(prev){ return prev.map(function(item){ return item.id === updated.id ? updated : item; }); });
      }).catch(function(){ setMessage('まとめ配布を更新できませんでした'); });
    }
    function openTestSetDeleteModal(testSet){
      if(!testSet) return;
      setTestSetDeleteModal({
        open: true,
        testSet: testSet,
        loading: false
      });
    }
    function closeTestSetDeleteModal(){
      setTestSetDeleteModal({
        open: false,
        testSet: null,
        loading: false
      });
    }
    function confirmTestSetDelete(){
      const modal = testSetDeleteModal;
      const testSet = modal.testSet;
      if(!testSet || modal.loading) return;
      setTestSetDeleteModal(function(prev){ return Object.assign({}, prev, { loading: true }); });
      fetch('/api/test-sets/' + encodeURIComponent(testSet.id), { method: 'DELETE' }).then(function(r){
        if(!r.ok) throw new Error('delete_failed');
        setTestSets(function(prev){ return prev.filter(function(item){ return item.id !== testSet.id; }); });
        setMessage('まとめ配布を削除しました');
        closeTestSetDeleteModal();
      }).catch(function(){
        setMessage('まとめ配布を削除できませんでした');
      }).finally(function(){
        setTestSetDeleteModal(function(prev){
          return prev.open ? Object.assign({}, prev, { loading: false }) : prev;
        });
      });
    }
    function deleteTestSet(testSet){
      openTestSetDeleteModal(testSet);
    }
    function startInlineTestRename(t){
      setEditingTestId(t.id);
      setEditingTestName(t.name || '');
    }
    function cancelInlineTestRename(){
      if(editingTestBusy) return;
      setEditingTestId(null);
      setEditingTestName('');
    }
    function submitInlineTestRename(t){
      const trimmedName = (editingTestName || '').trim();
      if(editingTestBusy) return;
      if(!trimmedName){
        setMessage('テスト名を入力してください');
        return;
      }
      if(trimmedName === (t.name || '').trim()){
        cancelInlineTestRename();
        return;
      }
      if(tests.some(function(item){ return item.id !== t.id && (item.name || '').trim() === trimmedName; })){
        setMessage('そのテスト名は既に使われています。別の名前を指定してください');
        return;
      }
      setEditingTestBusy(true);
      updateTestRecord(t, { name: trimmedName }, 'テスト更新エラー', 'テスト名を更新しました').then(function(updated){
        setEditingTestBusy(false);
        if(updated){
          setEditingTestId(null);
          setEditingTestName('');
        }
      });
    }

    function openTestDeleteModal(t){
      if(!t) return;
      setTestDeleteModal({
        open: true,
        test: t,
        cascade: false,
        loading: false,
        dependencyInfo: null
      });
    }
    function closeTestDeleteModal(){
      setTestDeleteModal({
        open: false,
        test: null,
        cascade: false,
        loading: false,
        dependencyInfo: null
      });
    }
    function confirmTestDelete(){
      const modal = testDeleteModal;
      const t = modal.test;
      if(!t || modal.loading) return;
      setTestDeleteModal(function(prev){ return Object.assign({}, prev, { loading: true }); });
      const url = '/api/tests/' + t.id + (modal.cascade ? '?cascade=1' : '');
      fetch(url, { method: 'DELETE' }).then(async r=>{
        if(r.ok){
          setTests(prev=> prev.filter(x=> x.id !== t.id));
          setMessage(modal.cascade ? '関連データを含め削除しました' : '削除しました');
          closeTestDeleteModal();
        } else {
          const json = await r.json().catch(()=> ({ error: '削除失敗' }));
          if(json && json.error === 'has_dependencies' && !modal.cascade){
            setTestDeleteModal(function(prev){
              return Object.assign({}, prev, {
                cascade: true,
                loading: false,
                dependencyInfo: {
                  questions: json.questions || 0,
                  answers: json.answers || 0
                }
              });
            });
          } else { setMessage(json && json.error ? json.error : '削除エラー'); }
        }
      }).catch(()=> setMessage('通信エラー')).finally(function(){
        setTestDeleteModal(function(prev){
          return prev.open ? Object.assign({}, prev, { loading: false }) : prev;
        });
      });
    }
    function deleteTest(t){
      openTestDeleteModal(t);
    }
    function fetchQuestions(testId){ if(!testId) return Promise.resolve([]); return fetch('/api/tests/'+testId+'/questions').then(r=>r.json()).then(j=>{ setQuestions(j); return j; }).catch(()=>{ setMessage('問題取得エラー'); return []; }); }

    // Fetch reports (uses /api/exams)
    async function fetchReports(){
      setReportsLoading(true);
      setTestSetSummariesLoading(true);
      try{
        const [res, setRes] = await Promise.all([
          fetch('/api/exams'),
          fetch('/api/test-sets?include_archived=1')
        ]);
        const j = await res.json();
        const arr = Array.isArray(j) ? j : (j && j.value) ? j.value : [];
        setReports(arr || []);
        const sets = await setRes.json().catch(function(){ return []; });
        const activeSets = (Array.isArray(sets) ? sets : []).filter(function(s){ return !s.archived; });
        const summaries = await Promise.all(activeSets.map(function(s){
          return fetch('/api/test-sets/' + encodeURIComponent(s.id) + '/summary')
            .then(function(r){ return r.ok ? r.json() : null; })
            .catch(function(){ return null; });
        }));
        setTestSetSummaries(summaries.filter(Boolean));
        setReportsPage(1);
      }catch(e){ setMessage('レポート取得エラー'); setReports([]); setTestSetSummaries([]); }
      setReportsLoading(false);
      setTestSetSummariesLoading(false);
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
      const sessionId = r.sessionId || r.session_id;
      try{
        // fetch per-question summary (which contains choice ids) and questions (to get choice texts)
        const summaryUrl = '/api/tests/' + encodeURIComponent(testId) + '/summary?student_id=' + encodeURIComponent(studentId)
          + (sessionId ? '&session_id=' + encodeURIComponent(sessionId) : '');
        const [sumRes, qRes] = await Promise.all([
          fetch(summaryUrl),
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
          content_html: d.content_html || '',
          content_format: d.content_format || (d.content_html ? 'html' : 'plain'),
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

    async function deleteReport(row){
      const sessionId = row && (row.sessionId || row.session_id);
      if(!sessionId){ setMessage('この記録は削除できません'); return; }
      const dtRaw = row.finished_at || row.started_at || '';
      let dtDisp = '日時不明';
      try{ if(dtRaw) dtDisp = new Date(dtRaw).toLocaleString(); }catch(e){ dtDisp = dtRaw || '日時不明'; }
      const label = (row.studentName || '不明な生徒') + ' / ' + (row.testName || '不明なテスト') + ' / ' + dtDisp;
      if(!confirm('次の受験記録を削除しますか？\n\n' + label + '\n\nこの操作は元に戻せません。')) return;
      try{
        const res = await fetch('/api/exam-sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
        const json = await res.json().catch(() => null);
        if(!res.ok){
          setMessage((json && json.error) ? json.error : '受験記録の削除に失敗しました');
          return;
        }
        setReports(prev => prev.filter(function(item){
          const itemSessionId = item && (item.sessionId || item.session_id);
          return String(itemSessionId) !== String(sessionId);
        }));
        setTotalReportsByStudent(null);
        if(reportSummaryData && reportSummaryData.meta){
          const openSessionId = reportSummaryData.meta.sessionId || reportSummaryData.meta.session_id;
          if(String(openSessionId) === String(sessionId)) closeReportSummary();
        }
        setMessage('受験記録を削除しました');
      }catch(e){
        setMessage('受験記録の削除に失敗しました');
      }
    }

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
        ops.push(fetch('/api/questions/'+q.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: q.text, content_html: q.content_html || '', content_format: q.content_html ? 'html' : 'plain', type: q.type||'single', points: q.points||1, explanation: q.explanation || '' }) }));
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
    function toggleTestArchived(test){
      const nextArchived = test.archived ? 0 : 1;
      const nextPublic = nextArchived ? 0 : (test.public || 0);
      updateTestRecord(
        test,
        { archived: nextArchived, public: nextPublic },
        nextArchived ? 'アーカイブ更新エラー' : '復元エラー',
        nextArchived ? 'アーカイブしました' : '通常一覧に戻しました'
      );
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
        kind: 'test',
        test: null,
        testName: '',
        className: '',
        classId: '',
        url: '',
        qrDataUrl: '',
        error: ''
      });
    }
    async function openClassQrShareModal(test){
      if(!test || !test.id) return;
      if(!Number(testQuestionCounts[test.id] || 0)){
        setMessage('問題が1問もないテストは共有QRを表示できません');
        return;
      }
      if(!test.public){
        setMessage('公開前のテストは共有QRを表示できません');
        return;
      }
      const classIds = getTestClassIds(test);
      if(!classIds.length){
        setMessage('配布先クラスを設定すると共有URLを作成できます');
        return;
      }
      const assigned = getAssignedClasses(test, classes);
      const selectedClass = assigned[0] || classes.find(function(c){ return String(c.id) === String(classIds[0]); }) || null;
      const selectedClassId = selectedClass ? selectedClass.id : classIds[0];
      await updateQrShareForClass(test, selectedClassId, true);
    }
    async function updateQrShareForClass(test, classId, shouldOpen){
      const classNameForTest = (classes.find(function(c){ return String(c.id) === String(classId); }) || {}).name || '未割当';
      const url = buildStudentAccessUrl(test, classId);
      setQrShareModal(function(prev){
        return Object.assign({}, prev, {
          open: shouldOpen || prev.open,
          loading: true,
          kind: 'test',
          test: test,
          testName: test.name || 'テスト',
          className: classNameForTest,
          classId: String(classId || ''),
          url: url,
          qrDataUrl: '',
          error: ''
        });
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
    async function openSetQrShareModal(testSet){
      if(!testSet || !testSet.id) return;
      if(!testSet.public){
        setMessage('公開前のまとめ配布は共有できません');
        return;
      }
      const classIds = getSetClassIds(testSet);
      if(!classIds.length){
        setMessage('配布先クラスを設定すると共有URLを作成できます');
        return;
      }
      const assigned = getSetAssignedClasses(testSet, classes);
      const selectedClass = assigned[0] || classes.find(function(c){ return String(c.id) === String(classIds[0]); }) || null;
      const selectedClassId = selectedClass ? selectedClass.id : classIds[0];
      await updateSetQrShareForClass(testSet, selectedClassId, true);
    }
    async function updateSetQrShareForClass(testSet, classId, shouldOpen){
      const classNameForSet = (classes.find(function(c){ return String(c.id) === String(classId); }) || {}).name || '未割当';
      const url = buildStudentSetAccessUrl(testSet, classId);
      setQrShareModal(function(prev){
        return Object.assign({}, prev, {
          open: shouldOpen || prev.open,
          loading: true,
          kind: 'set',
          test: testSet,
          testName: testSet.name || 'まとめ配布',
          className: classNameForSet,
          classId: String(classId || ''),
          url: url,
          qrDataUrl: '',
          error: ''
        });
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
    function copySharedUrl(url){
      copyTextToClipboard(url).then(function(){
        setMessage('アクセスURLをコピーしました');
      }).catch(function(){
        setMessage('URLのコピーに失敗しました');
      });
    }
    function updateTestRecord(test, overrides, errorMessage, successMessage){
      const nextAnswerMode = Object.prototype.hasOwnProperty.call(overrides || {}, 'answer_mode') ? overrides.answer_mode : getAnswerModeValue(test);
      const payload = {
        name: Object.prototype.hasOwnProperty.call(overrides || {}, 'name') ? overrides.name : test.name,
        description: Object.prototype.hasOwnProperty.call(overrides || {}, 'description') ? overrides.description : (test.description || ''),
        public: Object.prototype.hasOwnProperty.call(overrides || {}, 'public') ? overrides.public : (test.public || 0),
        randomize: Object.prototype.hasOwnProperty.call(overrides || {}, 'randomize') ? overrides.randomize : (test.randomize || 0),
        answer_mode: nextAnswerMode,
        time_limit_minutes: Object.prototype.hasOwnProperty.call(overrides || {}, 'time_limit_minutes') ? normalizeTimeLimitMinutes(overrides.time_limit_minutes, nextAnswerMode) : normalizeTimeLimitMinutes(test && test.time_limit_minutes, nextAnswerMode),
        class_id: Object.prototype.hasOwnProperty.call(overrides || {}, 'class_id') ? overrides.class_id : (test.class_id || null),
        class_ids: Object.prototype.hasOwnProperty.call(overrides || {}, 'class_ids') ? overrides.class_ids : getTestClassIds(test),
        archived: Object.prototype.hasOwnProperty.call(overrides || {}, 'archived') ? overrides.archived : (test.archived || 0),
        teacher_note: Object.prototype.hasOwnProperty.call(overrides || {}, 'teacher_note') ? overrides.teacher_note : (test.teacher_note || '')
      };
      return fetch('/api/tests/'+test.id, {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      }).then(r=>r.json()).then(updated=>{
        const merged = Object.assign({}, test, updated, { archived: payload.archived, answer_mode: payload.answer_mode, time_limit_minutes: payload.time_limit_minutes, teacher_note: payload.teacher_note });
        setTests(prev => prev.map(t => t.id===test.id ? merged : t));
        if(successMessage) setMessage(successMessage);
        return merged;
      }).catch(()=>{
        setMessage(errorMessage || '更新エラー');
        return null;
      });
    }

    function openAssignmentModal(test){
      setAssignmentModal({
        open: true,
        test: test,
        classIds: getTestClassIds(test),
        saving: false
      });
    }
    function closeAssignmentModal(){
      if(assignmentModal.saving) return;
      setAssignmentModal({ open: false, test: null, classIds: [], saving: false });
    }
    function toggleAssignmentClass(classId){
      setAssignmentModal(function(prev){
        const id = String(classId);
        const hasId = prev.classIds.indexOf(id) !== -1;
        return Object.assign({}, prev, {
          classIds: hasId ? prev.classIds.filter(function(x){ return x !== id; }) : prev.classIds.concat(id)
        });
      });
    }
    function saveAssignmentModal(){
      const test = assignmentModal.test;
      if(!test || assignmentModal.saving) return;
      const classIds = assignmentModal.classIds.map(function(id){ return parseInt(id, 10); }).filter(Boolean);
      setAssignmentModal(function(prev){ return Object.assign({}, prev, { saving: true }); });
      updateTestRecord(test, { class_ids: classIds, class_id: classIds[0] || null }, '配布先の保存に失敗しました', '配布先を更新しました').then(function(updated){
        if(updated){
          setAssignmentModal({ open: false, test: null, classIds: [], saving: false });
        } else {
          setAssignmentModal(function(prev){ return Object.assign({}, prev, { saving: false }); });
        }
      });
    }

    const classItems = classes.map(function(c){
      const linkedTests = tests.filter(function(t){ return isTestAssignedToClass(t, c.id); }).length;
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

    function getTeacherNoteDraft(test){
      if(Object.prototype.hasOwnProperty.call(teacherNoteDrafts, test.id)){
        return teacherNoteDrafts[test.id];
      }
      return test.teacher_note || '';
    }

    function setTeacherNoteDraft(testId, value){
      setTeacherNoteDrafts(function(prev){
        const next = Object.assign({}, prev);
        next[testId] = String(value || '').slice(0, 1000);
        return next;
      });
    }

    function cancelTeacherNoteEdit(test){
      setTeacherNoteDrafts(function(prev){
        const next = Object.assign({}, prev);
        delete next[test.id];
        return next;
      });
    }

    function saveTeacherNote(test){
      if(teacherNoteSavingId) return;
      const nextNote = getTeacherNoteDraft(test);
      setTeacherNoteSavingId(test.id);
      updateTestRecord(test, { teacher_note: nextNote }, 'メモの保存に失敗しました', 'メモを保存しました').then(function(updated){
        setTeacherNoteSavingId(null);
        if(updated){
          cancelTeacherNoteEdit(updated);
        }
      });
    }

    // build list of test item elements from data (keep data->UI mapping pure)
    const normalizedTeacherQuery = (teacherTestQuery || '').trim().toLowerCase();
    const activeTests = tests.filter(function(t){ return !t.archived; });
    const activeTestsCount = activeTests.length;
    const archivedTests = tests.filter(function(t){ return !!t.archived; });
    const archivedTestsCount = archivedTests.length;
    const publicSetCandidateTests = tests.filter(function(t){ return !!t.public && !t.archived; });
    const archivedSetCandidateTests = tests.filter(function(t){ return !!t.archived; });
    const visibleSetCandidateTests = setTestSourceTab === 'archived' ? archivedSetCandidateTests : publicSetCandidateTests;
    const unassignedClassViewKey = '__unassigned';
    const activeScopeTests = teacherArchiveView === 'archived' ? archivedTests : activeTests;
    const activeScopeClassViewId = teacherArchiveView === 'archived' ? teacherArchivedClassViewId : teacherActiveClassViewId;
    const isClassOverview = !activeScopeClassViewId;
    const isClassDetail = !!activeScopeClassViewId;
    const isArchivedClassOverview = teacherArchiveView === 'archived' && !teacherArchivedClassViewId;
    const isArchivedClassDetail = teacherArchiveView === 'archived' && !!teacherArchivedClassViewId;
    const isActiveClassOverview = teacherArchiveView === 'active' && !teacherActiveClassViewId;
    const isActiveClassDetail = teacherArchiveView === 'active' && !!teacherActiveClassViewId;
    const displayedTests = tests.filter(function(t){
      const matchesArchive = teacherArchiveView === 'archived' ? !!t.archived : !t.archived;
      const matchesQuery = !normalizedTeacherQuery || (t.name || '').toLowerCase().includes(normalizedTeacherQuery);
      const matchesClass = !activeScopeClassViewId
        ? false
        : (activeScopeClassViewId === unassignedClassViewKey ? getTestClassIds(t).length === 0 : isTestAssignedToClass(t, activeScopeClassViewId));
      return matchesArchive && matchesQuery && matchesClass;
    });
    const scopeClassCards = classes.map(function(c){
      return {
        id: String(c.id),
        name: c.name,
        count: activeScopeTests.filter(function(t){ return isTestAssignedToClass(t, c.id); }).length,
        empty: false
      };
    }).concat([{
      id: unassignedClassViewKey,
      name: '未割当',
      count: activeScopeTests.filter(function(t){ return getTestClassIds(t).length === 0; }).length,
      empty: true
    }]);
    const archivedClassCards = scopeClassCards;
    const selectedScopeClassCard = scopeClassCards.find(function(card){ return String(card.id) === String(activeScopeClassViewId); }) || null;
    const selectedArchivedClassCard = selectedScopeClassCard;

    function renderTeacherSetCard(){
      return e('section', { id: 'teacher-set-card', className: 'task-section-card teacher-set-card' },
        e('div', { className: 'task-section-heading' },
          e('div', { 'data-title-icon': 'assign' },
            e('h2', null, 'まとめ配布を作成'),
            e('p', { className: 'section-note' }, '複数のテストを1つの学習メニューとして配布します。')
          ),
          e('span', { className: 'task-chip task-chip-muted' }, testSets.filter(function(s){ return !s.archived; }).length + '件')
        ),
        e('div', { className: 'task-form-stack teacher-set-form' },
          e('input', { value: setName, onChange: function(ev){ setSetName(ev.target.value); }, placeholder: '例: 1学期まとめ', 'aria-label': 'まとめ配布名' }),
          e('textarea', { value: setDescription, onChange: function(ev){ setSetDescription(ev.target.value); }, rows: 2, maxLength: 1000, placeholder: '説明（任意）', 'aria-label': 'まとめ配布説明' }),
          e('label', { className: 'task-toggle' }, e('input', { type: 'checkbox', checked: setPublic, onChange: function(ev){ setSetPublic(!!ev.target.checked); } }), e('span', null, '公開する')),
          e('div', { className: 'teacher-set-pickers' },
            e('div', { className: 'teacher-set-picker' },
              e('div', { className: 'teacher-set-picker__header' },
                e('strong', null, '配布先クラス'),
                classes.length ? e('span', { className: 'section-note' }, setClassIds.length ? (setClassIds.length + '件選択中') : '未選択') : null
              ),
              classes.length
                ? e('div', { className: 'teacher-set-choice-grid', role: 'group', 'aria-label': '配布先クラス' }, classes.map(function(c){
                    const checked = setClassIds.indexOf(String(c.id)) !== -1;
                    return e('button', {
                      key: c.id,
                      type: 'button',
                      className: checked ? 'teacher-set-choice-button is-selected' : 'teacher-set-choice-button',
                      onClick: function(){ toggleSetClassId(c.id); },
                      'aria-pressed': checked
                    },
                      e('span', { className: 'teacher-set-choice-button__title' }, c.name),
                      e('span', { className: 'teacher-set-choice-button__meta' }, checked ? '選択中' : '押して追加')
                    );
                  }))
                : e('p', { className: 'section-note' }, '先にクラスを作成してください。')
            ),
            e('div', { className: 'teacher-set-picker' },
              e('div', { className: 'teacher-set-picker__header' },
                e('strong', null, '含めるテスト'),
                e('span', { className: 'section-note' }, setTestIds.length ? (setTestIds.length + '件選択中') : '未選択')
              ),
              e('div', { className: 'teacher-set-tabs', role: 'tablist', 'aria-label': '含めるテストの表示切替' },
                e('button', {
                  type: 'button',
                  role: 'tab',
                  className: setTestSourceTab === 'public' ? 'mode-tab is-active' : 'mode-tab',
                  onClick: function(){ setSetTestSourceTab('public'); },
                  'aria-selected': setTestSourceTab === 'public'
                }, '公開中'),
                e('button', {
                  type: 'button',
                  role: 'tab',
                  className: setTestSourceTab === 'archived' ? 'mode-tab is-active' : 'mode-tab',
                  onClick: function(){ setSetTestSourceTab('archived'); },
                  'aria-selected': setTestSourceTab === 'archived'
                }, 'アーカイブ済み')
              ),
              visibleSetCandidateTests.length
                ? e('div', { className: 'teacher-set-choice-grid teacher-set-choice-grid--tests' }, visibleSetCandidateTests.map(function(t){
                    const checked = setTestIds.indexOf(String(t.id)) !== -1;
                    return e('button', {
                      key: t.id,
                      type: 'button',
                      className: checked ? 'teacher-set-choice-button is-selected' : 'teacher-set-choice-button',
                      onClick: function(){ toggleSetTestId(t.id); },
                      'aria-pressed': checked
                    },
                      e('span', { className: 'teacher-set-choice-button__title' }, t.name),
                      e('span', { className: 'teacher-set-choice-button__meta' }, getAssignmentLabel(t, classes) + ' / ' + (testQuestionCounts[t.id] || 0) + '問'),
                      e('span', { className: 'teacher-set-choice-button__badges' },
                        setTestSourceTab === 'archived'
                          ? e('span', { className: 'badge badge-muted' }, 'アーカイブ済み')
                          : e('span', { className: 'badge badge-success' }, '公開中')
                      )
                    );
                  }))
                : e('p', { className: 'section-note' }, setTestSourceTab === 'archived' ? 'アーカイブ済みテストはありません。' : '公開中のテストはありません。')
            )
          ),
          e('button', { onClick: createTestSet, className: 'btn btn-primary', type: 'button' }, 'まとめ配布を作成')
        ),
        testSets.length ? e('div', { className: 'teacher-set-list' }, testSets.filter(function(s){ return !s.archived; }).map(function(s){
          return e('article', { key: s.id, className: 'teacher-set-row' },
            e('div', null,
              e('strong', null, s.name),
              e('p', { className: 'section-note' }, getSetAssignmentLabel(s, classes) + ' / ' + ((s.items || []).length) + 'テスト')
            ),
            e('div', { className: 'teacher-set-row__actions' },
              e('button', { className: 'btn btn-small btn-ghost', type: 'button', onClick: function(){ toggleTestSetPublic(s); } }, s.public ? '下書きへ' : '公開'),
              e('button', { className: 'btn btn-small btn-secondary', type: 'button', onClick: function(){ openSetQrShareModal(s); }, disabled: !s.public || !getSetClassIds(s).length }, '共有QR'),
              e('button', { className: 'btn btn-small btn-ghost', type: 'button', onClick: function(){ archiveTestSet(s); } }, 'アーカイブ'),
              e('button', { className: 'btn btn-small btn-ghost', type: 'button', onClick: function(){ deleteTestSet(s); } }, '削除')
            )
          );
        })) : e('div', { className: 'task-empty' }, 'まとめ配布はまだありません')
      );
    }
    const publicTestsCount = tests.filter(function(t){ return !!t.public; }).length;
    const draftTestsCount = tests.filter(function(t){ return !t.public; }).length;
    const assignedTestsCount = tests.filter(function(t){ return getTestClassIds(t).length > 0; }).length;
    const readyToShareTestsCount = activeTests.filter(function(t){
      return !!t.public && getTestClassIds(t).length > 0 && Number(testQuestionCounts[t.id] || 0) > 0;
    }).length;
    const attentionTestsCount = activeTests.filter(function(t){
      return !t.public || getTestClassIds(t).length === 0 || Number(testQuestionCounts[t.id] || 0) === 0;
    }).length;
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

    const teacherNode = e('section', { className: 'task-page teacher-dashboard-page' },
      e('div', { className: 'task-page-hero compact teacher-page-hero teacher-operations-header' },
        e('div', { className: 'teacher-page-hero__intro' },
          e('p', { className: 'eyebrow' }, '教員メニュー'),
          e('h1', null, 'テスト準備ダッシュボード'),
          e('p', { className: 'lead' }, '準備フローを参考に、テストの準備・配布を行います。')
        ),
        e('div', { className: 'teacher-operations-header__actions' },
          e('a', { href: '#teacher-tests-card', className: 'btn btn-primary' }, 'テスト運用へ'),
          e('a', { href: '#teacher-create-card', className: 'btn btn-ghost' }, '新規作成')
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
      e('div', { className: 'task-stat-grid compact teacher-dashboard-stat-grid' }, [
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
        ),
        e('article', { key: 'teacher-stat-ready', className: 'task-stat-card teacher-stat-card--ready' },
          e('span', { className: 'task-stat-card__label' }, '共有可能'),
          e('strong', { className: 'task-stat-card__value' }, String(readyToShareTestsCount)),
          e('span', { className: 'task-stat-card__note' }, '公開・配布先・問題が揃ったテスト')
        ),
        e('article', { key: 'teacher-stat-attention', className: 'task-stat-card teacher-stat-card--attention' },
          e('span', { className: 'task-stat-card__label' }, '要確認'),
          e('strong', { className: 'task-stat-card__value' }, String(attentionTestsCount)),
          e('span', { className: 'task-stat-card__note' }, '公開前・未配布・問題未作成')
        ),
        e('article', { key: 'teacher-stat-archived', className: 'task-stat-card' },
          e('span', { className: 'task-stat-card__label' }, 'アーカイブ済み'),
          e('strong', { className: 'task-stat-card__value' }, String(archivedTestsCount)),
          e('span', { className: 'task-stat-card__note' }, '通常一覧から外して保管中のテスト')
        )
      ]),
      initialDataLoading ? e('div', { className: 'teacher-status-strip', role: 'status' }, 'クラスとテストの一覧を読み込んでいます。') : null,
      e('div', { className: 'teacher-workspace-grid' },
        e('section', { className: 'teacher-workspace-main' },
          e('section', { id: 'teacher-class-card', className: 'task-section-card teacher-class-card' },
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
          e('section', { id: 'teacher-tests-card', className: 'task-section-card teacher-tests-card' },
            e('div', { className: 'task-section-heading' },
              e('div', { 'data-title-icon': 'list' },
                e('h2', null, 'テストの管理')
              ),
              e('span', { className: 'task-chip task-chip-muted' }, isClassOverview ? (teacherArchiveView === 'archived' ? 'クラスを選択してアーカイブ済みテストを確認' : 'クラスを選択して運用中テストを確認') : '共有 QR は1問以上作成・公開・クラス割当後に有効')
            ),
            isClassOverview ? null : e('div', { className: 'task-filter-bar' },
              e('input', {
                value: teacherTestQuery,
                onChange: function(ev){ setTeacherTestQuery(ev.target.value); },
                placeholder: 'テスト名で検索',
                'aria-label': 'テスト名で検索'
              }),
              isClassDetail
                ? e('button', {
                    onClick: function(){
                      if(teacherArchiveView === 'archived') setTeacherArchivedClassViewId('');
                      else setTeacherActiveClassViewId('');
                      setTeacherTestQuery('');
                    },
                    className: 'btn btn-ghost',
                    type: 'button'
                  }, 'クラス一覧へ戻る')
                : e('select', {
                    value: teacherFilterClassId,
                    onChange: function(ev){ setTeacherFilterClassId(ev.target.value); },
                    'aria-label': 'クラスで絞り込み'
                  }, [
                    e('option', { key: '__all_filter', value: '' }, 'すべてのクラス')
                  ].concat(classes.map(function(c){
                    return e('option', { key: c.id, value: c.id }, c.name);
                  }))),
              e('button', {
                onClick: function(){
                  setTeacherTestQuery('');
                  if(isClassDetail){
                    if(teacherArchiveView === 'archived') setTeacherArchivedClassViewId('');
                    else setTeacherActiveClassViewId('');
                  } else {
                    setTeacherFilterClassId('');
                  }
                },
                className: 'btn btn-ghost',
                type: 'button'
              }, '条件をクリア')
            ),
            e('div', { className: 'teacher-test-toolbar' },
              e('div', { className: 'task-results-meta' },
                isClassOverview
                  ? (teacherArchiveView === 'archived' ? 'クラスを選択してアーカイブ済みテストを確認' : 'クラスを選択して運用中テストを確認')
                  : (isClassDetail
                      ? ((selectedScopeClassCard ? selectedScopeClassCard.name : '選択中クラス') + ' の' + (teacherArchiveView === 'archived' ? 'アーカイブ済み ' : '運用中 ') + displayedTests.length + '件' + (teacherTestQuery ? ' / 条件あり' : ''))
                      : (displayedTests.length + '件を表示中 / 運用中 ' + activeTestsCount + '件 / アーカイブ済み ' + archivedTestsCount + '件' + (teacherTestQuery || teacherFilterClassId ? ' / 条件あり' : '')))
              ),
              e('div', { className: 'teacher-test-toolbar__actions' },
                e('div', { className: 'teacher-test-scope-switch', role: 'group', 'aria-label': '表示するテスト範囲' },
                  e('button', {
                    onClick: function(){ setTeacherArchiveView('active'); setTeacherArchivedClassViewId(''); setTeacherActiveClassViewId(''); setTeacherTestQuery(''); },
                    className: teacherArchiveView === 'active' ? 'mode-tab is-active' : 'mode-tab',
                    type: 'button',
                    'aria-pressed': teacherArchiveView === 'active'
                  }, '運用中'),
                  e('button', {
                    onClick: function(){ setTeacherArchiveView('archived'); setTeacherArchivedClassViewId(''); setTeacherActiveClassViewId(''); setTeacherFilterClassId(''); setTeacherTestQuery(''); },
                    className: teacherArchiveView === 'archived' ? 'mode-tab is-active' : 'mode-tab',
                    type: 'button',
                    'aria-pressed': teacherArchiveView === 'archived'
                  }, 'アーカイブ済み')
                ),
                true ? null : e('div', { className: 'teacher-test-view-switch', role: 'group', 'aria-label': 'テストカード表示切替' },
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
              )
            ),
            isClassOverview ? e('div', { className: 'archive-class-grid' }, scopeClassCards.map(function(card){
              return e('button', {
                key: card.id,
                className: cx('archive-class-card', card.count === 0 && 'is-empty', card.empty && 'is-unassigned'),
                type: 'button',
                onClick: function(){
                  if(teacherArchiveView === 'archived') setTeacherArchivedClassViewId(card.id);
                  else setTeacherActiveClassViewId(card.id);
                  setTeacherTestQuery('');
                }
              },
                e('span', { className: 'archive-class-card__main' },
                  e('span', { className: 'archive-class-card__label' }, card.empty ? '配布先なし' : 'クラス'),
                  e('strong', { className: 'archive-class-card__name' }, card.name)
                ),
                e('span', { className: 'archive-class-card__count' }, card.count + '件'),
                e('span', { className: 'archive-class-card__status' },
                  e('span', { className: 'archive-class-card__hint' }, card.count ? '一覧を確認できます' : (teacherArchiveView === 'archived' ? 'アーカイブ済みなし' : '運用中なし')),
                  e('span', { className: 'archive-class-card__action' }, '開く')
                )
              );
            })) : displayedTests.length ? e('div', { className: 'teacher-test-list' }, displayedTests.map(function(t){
              const questionCount = testQuestionCounts[t.id] || 0;
              const classNameForTest = (classes.find(function(c){ return c.id === t.class_id; }) || {}).name || '未割当';
              const canShareTest = Number(questionCount) > 0 && !!t.public && !!t.class_id && !t.archived;
              const assignedClassIds = getTestClassIds(t);
              const assignedClasses = getAssignedClasses(t, classes);
              const displayClassNameForTest = getAssignmentLabel(t, classes);
              const canShareByAssignments = Number(questionCount) > 0 && !!t.public && assignedClassIds.length > 0 && !t.archived;
              const managementState = getTeacherTestManagementState(t, questionCount);
              const isDetailedCard = !!expandedTeacherTests[t.id];
              const isRenamingTest = editingTestId === t.id;
              const teacherNote = (t.teacher_note || '').trim();
              const teacherNoteDraft = getTeacherNoteDraft(t);
              const hasTeacherNoteDraft = Object.prototype.hasOwnProperty.call(teacherNoteDrafts, t.id);
              const isTeacherNoteDirty = hasTeacherNoteDraft && teacherNoteDraft !== (t.teacher_note || '');
              const isTeacherNoteSaving = teacherNoteSavingId === t.id;
              return e('article', {
                key: t.id,
                draggable: false,
                onDragStart: function(ev){ onDragStartTest(ev, t); },
                className: cx(
                  'teacher-test-row',
                  'teacher-test-card',
                  'teacher-test-card--' + managementState.tone,
                  isDetailedCard && 'is-detailed',
                  questionCount === 0 && 'needs-questions',
                  assignedClassIds.length === 0 && 'is-unassigned',
                  canShareByAssignments && 'is-share-ready',
                  !!t.public && 'is-public',
                  !t.public && 'is-draft'
                )
              },
                e('div', { className: 'teacher-test-row__main' },
                  e('div', { className: 'teacher-test-card__title-block' },
                    isRenamingTest
                      ? e('form', {
                          className: 'teacher-test-card__title-editor task-card-title',
                          'data-title-icon': 'test',
                          onSubmit: function(ev){
                            ev.preventDefault();
                            submitInlineTestRename(t);
                          }
                        },
                          e('input', {
                            value: editingTestName,
                            onChange: function(ev){ setEditingTestName(ev.target.value); },
                            onKeyDown: function(ev){
                              if(ev.key === 'Escape'){
                                ev.preventDefault();
                                cancelInlineTestRename();
                              }
                            },
                            className: 'teacher-test-card__title-input',
                            disabled: editingTestBusy,
                            autoFocus: true,
                            'aria-label': 'テスト名を編集'
                          }),
                          e('div', { className: 'teacher-test-card__title-actions' },
                            e('button', { className: 'btn btn-small btn-primary', type: 'submit', disabled: editingTestBusy }, editingTestBusy ? '保存中...' : '保存'),
                            e('button', { className: 'btn btn-small btn-ghost', type: 'button', onClick: cancelInlineTestRename, disabled: editingTestBusy }, 'キャンセル')
                          )
                        )
                      : e('h4', { className: 'task-card-title', 'data-title-icon': 'test' },
                          e('button', {
                            type: 'button',
                            className: 'teacher-test-card__title-button',
                            onClick: function(){ startInlineTestRename(t); },
                            title: 'クリックして名称変更',
                            'aria-label': 'テスト名を編集'
                          }, t.name)
                        ),
                    e('div', { className: 'teacher-test-card__overview' },
                      e('span', { className: 'teacher-test-state is-' + managementState.tone }, managementState.label),
                      e('p', { className: 'teacher-test-card__helper' }, managementState.detail)
                    )
                  ),
                  e('div', { className: 'task-badges teacher-test-card__badges' },
                    teacherNote ? e('span', { className: 'badge badge-note' }, 'メモあり') : null,
                    t.archived ? e('span', { className: 'badge badge-muted' }, 'アーカイブ済み') : null,
                    e('span', { className: !!t.public ? 'badge badge-success' : 'badge' }, !!t.public ? '公開中' : '下書き'),
                    e('span', { className: !!t.randomize ? 'badge badge-accent' : 'badge badge-muted' }, !!t.randomize ? 'ランダム' : '固定順'),
                    e('span', { className: isImmediateFeedbackMode(t) ? 'badge badge-accent' : 'badge badge-muted' }, getAnswerModeLabel(t))
                  )
                ),
                e('div', { className: 'teacher-test-row__meta' },
                  e('div', { className: 'teacher-test-card__summary-grid' },
                  e('div', { className: 'teacher-test-meta' },
                    e('span', { className: 'teacher-test-meta__label' }, 'クラス'),
                    e('strong', { className: 'teacher-test-meta__value' }, displayClassNameForTest)
                  ),
                  e('div', { className: cx('teacher-test-meta', questionCount === 0 && 'is-warning') },
                    e('span', { className: 'teacher-test-meta__label' }, '問題数'),
                    e('strong', { className: 'teacher-test-meta__value' }, questionCount + '問')
                  )
                  )
                ),
                e('div', { className: 'teacher-test-row__actions teacher-test-card__primary-actions' },
                  e('a', { href: '/create_test.html?class_id=' + encodeURIComponent(t.class_id || '') + '&name=' + encodeURIComponent(t.name || '') + '&test_id=' + encodeURIComponent(t.id), className: 'btn btn-small btn-primary teacher-test-action teacher-test-action--primary' }, '問題管理'),
                  e('button', { onClick: function(){ openAssignmentModal(t); }, className: 'btn btn-small btn-ghost teacher-test-action teacher-test-action--secondary', type: 'button' }, '配布先'),
                  t.archived ? null : e('button', { onClick: function(){ openClassQrShareModal(t); }, className: 'btn btn-small btn-secondary teacher-test-action teacher-test-action--secondary', type: 'button', disabled: !canShareByAssignments }, '共有 QR'),
                  t.archived ? e('button', { onClick: function(){ toggleTestArchived(t); }, className: 'btn btn-small btn-ghost teacher-test-action teacher-test-action--secondary', type: 'button' }, '復元') : null,
                  e('button', {
                    onClick: function(){ toggleTeacherTestExpanded(t.id); },
                    className: cx('btn btn-small btn-ghost teacher-test-action teacher-test-action--secondary teacher-test-action--expand', isDetailedCard && 'is-active'),
                    type: 'button',
                    'aria-expanded': isDetailedCard,
                    'aria-pressed': isDetailedCard
                  }, isDetailedCard ? '詳細を隠す' : '詳細')
                ),
                isDetailedCard ? e('div', { className: 'teacher-test-card__details' },
                  e('div', { className: 'teacher-assignment-chips' },
                    assignedClasses.length
                      ? assignedClasses.map(function(c){ return e('span', { key: c.id, className: 'teacher-assignment-chip' }, c.name); })
                      : e('span', { className: 'teacher-assignment-chip is-empty' }, '未割当')
                  ),
                  e('div', { className: 'teacher-test-note-editor' },
                    e('div', { className: 'teacher-test-note-editor__header' },
                      e('label', { htmlFor: 'teacher-note-' + t.id }, '教師メモ'),
                      e('span', { className: 'teacher-test-note-editor__count' }, String(teacherNoteDraft.length) + '/1000')
                    ),
                    e('textarea', {
                      id: 'teacher-note-' + t.id,
                      className: 'teacher-test-note-editor__textarea',
                      value: teacherNoteDraft,
                      maxLength: 1000,
                      rows: 3,
                      placeholder: '準備物、配布タイミング、注意点などを記録',
                      disabled: isTeacherNoteSaving,
                      onChange: function(ev){ setTeacherNoteDraft(t.id, ev.target.value); }
                    }),
                    e('div', { className: 'teacher-test-note-editor__actions' },
                      isTeacherNoteDirty ? e('span', { className: 'teacher-test-note-editor__status' }, '未保存の変更があります') : e('span', { className: 'teacher-test-note-editor__status' }, teacherNote ? '保存済みメモ' : 'メモは未記入です'),
                      e('button', { className: 'btn btn-small btn-primary', type: 'button', onClick: function(){ saveTeacherNote(t); }, disabled: isTeacherNoteSaving || !isTeacherNoteDirty }, isTeacherNoteSaving ? '保存中...' : '保存'),
                      e('button', { className: 'btn btn-small btn-ghost', type: 'button', onClick: function(){ cancelTeacherNoteEdit(t); }, disabled: isTeacherNoteSaving || !isTeacherNoteDirty }, 'キャンセル')
                    )
                  ),
                  e('div', { className: 'task-card-controls teacher-test-card__controls' },
                    e('label', { className: 'task-toggle compact' }, e('input', { type: 'checkbox', checked: !!t.public, onChange: function(){ toggleTestPublic(t); }, disabled: !!t.archived }), e('span', null, '公開')),
                    e('label', { className: 'task-toggle compact' }, e('input', { type: 'checkbox', checked: !!t.randomize, onChange: function(){ updateTestRecord(t, { randomize: t.randomize ? 0 : 1 }, 'ランダム設定更新エラー'); } }), e('span', null, 'ランダム')),
                    e('label', { className: 'task-toggle compact' },
                      e('span', null, '出題モード'),
                      e('select', {
                        value: getAnswerModeValue(t),
                        onChange: function(ev){ updateTestRecord(t, { answer_mode: ev.target.value }, '出題モード更新エラー'); },
                        disabled: !!t.archived,
                        'aria-label': '出題モード'
                      }, ANSWER_MODE_OPTIONS.map(function(option){
                        return e('option', { key: option.value, value: option.value }, option.label);
                      }))
                    ),
                    e('label', { className: 'task-toggle compact teacher-time-limit-control' },
                      e('span', null, '制限時間（分）'),
                      e('input', {
                        type: 'number',
                        min: '1',
                        step: '1',
                        value: getTimeLimitMinutes(t) || '',
                        placeholder: 'なし',
                        disabled: !!t.archived || !isExamMode(t),
                        onChange: function(ev){ updateTestRecord(t, { time_limit_minutes: ev.target.value }, '制限時間更新エラー'); },
                        'aria-label': '制限時間（分）'
                      })
                    )
                  ),
                  e('p', { className: 'teacher-inline-note teacher-test-card__detail-note' }, managementState.detail),
                  e('div', { className: 'task-card-footer teacher-card-footer teacher-test-card__secondary-actions' },
                    e('button', { onClick: function(){ toggleTestArchived(t); }, className: 'btn btn-small btn-ghost', type: 'button' }, t.archived ? '復元' : 'アーカイブ'),
                    e('button', { onClick: function(){ deleteTest(t); }, className: 'btn btn-small btn-ghost', type: 'button' }, '削除')
                  )
                ) : null
              );
            })) : e('div', { className: 'task-empty' }, teacherTestQuery ? '条件に一致するテストがありません' : (teacherArchiveView === 'archived' ? 'このクラスのアーカイブ済みテストはありません' : 'このクラスの運用中テストはありません'))
          ),
          renderTeacherSetCard()
        ),
        e('aside', { className: 'teacher-workspace-side' },
          e('section', { id: 'teacher-create-card', className: 'task-section-card teacher-create-card' },
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
                e('label', { className: 'task-toggle' }, e('input', { type: 'checkbox', checked: testRandomize, onChange: function(ev){ setTestRandomize(!!ev.target.checked); } }), e('span', null, '問題順をランダム化')),
                e('label', { className: 'task-toggle' },
                  e('span', null, '出題モード'),
                  e('select', {
                    value: testAnswerMode,
                    onChange: function(ev){
                      const nextMode = getAnswerModeValue(ev.target.value);
                      setTestAnswerMode(nextMode);
                      if(nextMode !== 'exam_mode') setTestTimeLimitMinutes('');
                    },
                    'aria-label': '出題モード'
                  }, ANSWER_MODE_OPTIONS.map(function(option){
                    return e('option', { key: option.value, value: option.value }, option.label);
                  }))
                ),
                e('label', { className: 'task-toggle teacher-time-limit-control' },
                  e('span', null, '制限時間（分）'),
                  e('input', {
                    type: 'number',
                    min: '1',
                    step: '1',
                    value: testTimeLimitMinutes,
                    placeholder: 'なし',
                    disabled: testAnswerMode !== 'exam_mode',
                    onChange: function(ev){ setTestTimeLimitMinutes(ev.target.value); },
                    'aria-label': '制限時間（分）'
                  })
                )
              ),
              e('div', { className: 'task-inline-actions' },
                e('button', { onClick: createTest, className: 'btn btn-primary', type: 'button' }, '作成'),
                e('span', { className: 'teacher-inline-note' }, '作成後に問題を編集できます。')
              )
            )
          ),
          null && e('section', { className: 'task-section-card' },
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

      testDeleteModal.open ? e('div', {
        className: 'modal modal-centered',
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'test-delete-modal-title',
        style: { background: 'rgba(9,16,26,0.56)' },
        onClick: function(event){ if(event.target === event.currentTarget && !testDeleteModal.loading) closeTestDeleteModal(); }
      },
        e('div', { className: 'modal-panel', onClick: function(event){ event.stopPropagation(); } },
          e('h3', { id: 'test-delete-modal-title' }, testDeleteModal.cascade ? '関連データも削除しますか？' : 'テストを削除しますか？'),
          e('p', null,
            testDeleteModal.cascade
              ? 'このテストには ' + ((testDeleteModal.dependencyInfo && testDeleteModal.dependencyInfo.questions) || 0) + ' 件の問題と ' + ((testDeleteModal.dependencyInfo && testDeleteModal.dependencyInfo.answers) || 0) + ' 件の回答があります。関連データも削除します。'
              : '「' + ((testDeleteModal.test && testDeleteModal.test.name) || 'テスト') + '」を削除します。'
          ),
          e('p', { className: 'task-helper-text', style: { marginTop: 8 } }, 'この操作は元に戻せません。'),
          e('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 } },
            e('button', { className: 'btn btn-ghost', type: 'button', onClick: closeTestDeleteModal, disabled: testDeleteModal.loading }, 'キャンセル'),
            e('button', { className: 'btn btn-primary', type: 'button', onClick: confirmTestDelete, disabled: testDeleteModal.loading }, testDeleteModal.loading ? '削除中...' : '削除する')
          )
        )
      ) : null,

      classDeleteModal.open ? e('div', {
        className: 'modal modal-centered',
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'class-delete-modal-title',
        style: { background: 'rgba(9,16,26,0.56)' },
        onClick: function(event){ if(event.target === event.currentTarget && !classDeleteModal.loading) closeClassDeleteModal(); }
      },
        e('div', { className: 'modal-panel', onClick: function(event){ event.stopPropagation(); } },
          e('h3', { id: 'class-delete-modal-title' }, classDeleteModal.cascade ? '関連データも削除しますか？' : 'クラスを削除しますか？'),
          e('p', null,
            classDeleteModal.cascade
              ? 'このクラスには ' + ((classDeleteModal.dependencyInfo && classDeleteModal.dependencyInfo.tests) || 0) + ' 件のテストと ' + ((classDeleteModal.dependencyInfo && classDeleteModal.dependencyInfo.students) || 0) + ' 名の生徒がいます。関連データも削除します。'
              : '「' + ((classDeleteModal.classItem && classDeleteModal.classItem.name) || 'クラス') + '」を削除します。'
          ),
          e('p', { className: 'task-helper-text', style: { marginTop: 8 } }, 'この操作は元に戻せません。'),
          e('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 } },
            e('button', { className: 'btn btn-ghost', type: 'button', onClick: closeClassDeleteModal, disabled: classDeleteModal.loading }, 'キャンセル'),
            e('button', { className: 'btn btn-primary', type: 'button', onClick: confirmClassDelete, disabled: classDeleteModal.loading }, classDeleteModal.loading ? '削除中...' : '削除する')
          )
        )
      ) : null,

      testSetDeleteModal.open ? e('div', {
        className: 'modal modal-centered',
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': 'test-set-delete-modal-title',
        style: { background: 'rgba(9,16,26,0.56)' },
        onClick: function(event){ if(event.target === event.currentTarget && !testSetDeleteModal.loading) closeTestSetDeleteModal(); }
      },
        e('div', { className: 'modal-panel', onClick: function(event){ event.stopPropagation(); } },
          e('h3', { id: 'test-set-delete-modal-title' }, 'まとめ配布を削除しますか？'),
          e('p', null, '「' + ((testSetDeleteModal.testSet && testSetDeleteModal.testSet.name) || 'まとめ配布') + '」を削除します。'),
          e('p', { className: 'task-helper-text', style: { marginTop: 8 } }, 'この操作は元に戻せません。'),
          e('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 } },
            e('button', { className: 'btn btn-ghost', type: 'button', onClick: closeTestSetDeleteModal, disabled: testSetDeleteModal.loading }, 'キャンセル'),
            e('button', { className: 'btn btn-primary', type: 'button', onClick: confirmTestSetDelete, disabled: testSetDeleteModal.loading }, testSetDeleteModal.loading ? '削除中...' : '削除する')
          )
        )
      ) : null,

      assignmentModal.open ? e('div', { className: 'modal-backdrop', role: 'dialog', 'aria-modal': true },
        e('div', { className: 'assignment-modal' },
          e('div', { className: 'assignment-modal__header' },
            e('div', null,
              e('p', { className: 'eyebrow' }, '配布先'),
              e('h2', null, assignmentModal.test ? assignmentModal.test.name : 'テスト'),
              e('p', { className: 'assignment-modal__description' }, 'このテストを受験できるクラスを選択します。複数のクラスを同時に選べます。')
            ),
            e('button', { className: 'btn btn-small btn-ghost', type: 'button', onClick: closeAssignmentModal, disabled: assignmentModal.saving }, '閉じる')
          ),
          e('div', { className: 'assignment-modal__list' },
            classes.length
              ? classes.map(function(c){
                  const checked = assignmentModal.classIds.indexOf(String(c.id)) !== -1;
                  return e('label', { key: c.id, className: checked ? 'assignment-class-option is-selected' : 'assignment-class-option' },
                    e('input', { type: 'checkbox', checked: checked, onChange: function(){ toggleAssignmentClass(c.id); }, disabled: assignmentModal.saving }),
                    e('span', { className: 'assignment-class-option__check', 'aria-hidden': true }, checked ? '✓' : ''),
                    e('span', { className: 'assignment-class-option__body' },
                      e('strong', null, c.name),
                      e('span', null, checked ? '配布先に含まれています' : 'クリックして配布先に追加')
                    )
                  );
                })
              : e('p', { className: 'section-note' }, '先にクラスを作成してください。')
          ),
          e('div', { className: 'assignment-modal__actions' },
            e('span', { className: 'section-note' }, assignmentModal.classIds.length + 'クラスを選択中'),
            e('button', { className: 'btn btn-primary', type: 'button', onClick: saveAssignmentModal, disabled: assignmentModal.saving }, assignmentModal.saving ? '保存中...' : '保存')
          )
        )
      ) : null,

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
      const activeClassId = studentClassId || sharedStudentClassId || (getTestClassIds(t)[0] || '');
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
            fetch('/api/test-sets?class_id='+j.class_id+'&public=1').then(r=>r.json()).then(ss=>{ setStudentSets(ss || []); }).catch(()=>{});
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
      setSummaryMeta(null);
      setExamCompletionMeta(null);
      setExamCloseHintVisible(false);
      setExamDeadlineAt(null);
      setExamServerOffsetMs(0);
      setExamRemainingSeconds(null);
      examAutoSubmitRef.current = false;
      setCurrentSelection([]);
      setLastResult(null);
      setAnswersByQuestionId({});
      setExamReviewVisible(false);
      setReviewingQuestionIndex(null);
      // Prefer explicitStudent (passed from caller) otherwise fall back to state `student`.
      const useStudent = explicitStudent && explicitStudent.id ? explicitStudent : student;
      if(!useStudent || !useStudent.id){
        setCurrentSessionId(null);
        setCurrentTest(null);
        setStudentBusyLabel('');
        setMessage('参加情報が不足しています');
        return;
      }

      let createdSessionId = null;
      try{
        const resp = await fetch('/api/exam-sessions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ student_id: useStudent.id, test_id: t.id }) });
        const js = await resp.json().catch(function(){ return {}; });
        if(!resp.ok || !js || !js.id){
          setCurrentSessionId(null);
          setCurrentTest(null);
          setStudentBusyLabel('');
          setMessage(js && js.error ? js.error : 'セッション作成エラー');
          return;
        }
        createdSessionId = js.id;
        setCurrentSessionId(createdSessionId);
        const serverNowMs = js.server_now ? Date.parse(js.server_now) : NaN;
        const serverOffset = Number.isFinite(serverNowMs) ? serverNowMs - Date.now() : 0;
        const deadlineAt = js.deadline_at || null;
        const sessionTimeLimit = normalizeTimeLimitMinutes(js.time_limit_minutes, 'exam_mode');
        setExamServerOffsetMs(serverOffset);
        setExamDeadlineAt(deadlineAt);
        setExamRemainingSeconds(computeRemainingSeconds(deadlineAt, serverOffset));
        setCurrentTest(Object.assign({}, t, {
          time_limit_minutes: sessionTimeLimit || getTimeLimitMinutes(t),
          deadline_at: deadlineAt
        }));
        const qres = await fetch('/api/exam-sessions/' + encodeURIComponent(createdSessionId) + '/questions');
        const qs = await qres.json().catch(function(){ return []; });
        if(!qres.ok){
          setCurrentSessionId(null);
          setCurrentTest(null);
          setStudentBusyLabel('');
          setMessage(qs && qs.error ? qs.error : '問題取得エラー');
          return;
        }
        setCurrentQuestions(qs || []);
        setCurrentSelection([]);
      }catch(e){
        setCurrentSessionId(null);
        setCurrentTest(null);
        setMessage('セッション作成エラー');
      }finally{
        setStudentBusyLabel('');
      }
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

    function rememberCurrentSelection(questionId, selection){
      if(!questionId) return;
      const normalized = Array.isArray(selection) ? selection.slice() : [];
      setAnswersByQuestionId(function(prev){
        const next = Object.assign({}, prev);
        next[questionId] = normalized;
        return next;
      });
    }

    function getStoredSelection(question){
      if(!question) return [];
      const stored = answersByQuestionId[question.id];
      return Array.isArray(stored) ? stored : [];
    }

    function formatChoiceTextsForQuestion(question, selection){
      const selectedIds = Array.isArray(selection) ? selection : [];
      const choiceMap = {};
      (question && question.choices || []).forEach(function(choice){
        choiceMap[choice.id] = choice.text;
      });
      const texts = selectedIds.map(function(id){ return choiceMap[id] || String(id); }).filter(Boolean);
      return formatAnswerTexts(texts, '未回答');
    }

    function openExamReview(){
      setExamReviewVisible(true);
      setReviewingQuestionIndex(null);
      setLastResult(null);
      setCurrentSelection([]);
    }

    function reviewExamQuestion(index){
      const q = currentQuestions[index];
      if(!q) return;
      setReviewingQuestionIndex(index);
      setCurrentIndex(index);
      setCurrentSelection(getStoredSelection(q));
      setLastResult(null);
    }

    async function saveReviewedAnswer(){
      const q = currentQuestions[currentIndex];
      if(!q || !currentSessionId || !student || !currentTest) return;
      if(isExamMode(currentTest) && examRemainingSeconds === 0){
        if(!examAutoSubmitRef.current){
          examAutoSubmitRef.current = true;
          finalizeCurrentTest('time_limit');
        }
        return;
      }
      setStudentBusyLabel('回答を更新しています');
      const payload = { student_id: student.id, test_id: currentTest.id };
      if(q.type === 'multiple') payload.choice_ids = currentSelection;
      else payload.choice_id = currentSelection && currentSelection[0] ? currentSelection[0] : null;
      try{
        const res = await fetch('/api/exam-sessions/' + encodeURIComponent(currentSessionId) + '/answers/' + encodeURIComponent(q.id), {
          method: 'PUT',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(payload)
        });
        const json = await res.json().catch(function(){ return {}; });
        if(!res.ok || (json && json.error)){
          if(json && json.error === 'time_limit_exceeded'){
            if(!examAutoSubmitRef.current){
              examAutoSubmitRef.current = true;
              finalizeCurrentTest('time_limit');
            }
            return;
          }
          setMessage(json && json.error ? json.error : '回答更新エラー');
          return;
        }
        rememberCurrentSelection(q.id, currentSelection);
        openExamReview();
      }catch(_err){
        setMessage('回答更新エラー');
      }finally{
        setStudentBusyLabel('');
      }
    }

    function buildCurrentAnswerForTimeout(){
      if(!currentQuestions || !currentQuestions.length) return null;
      const q = currentQuestions[currentIndex];
      if(!q || !currentSelection || !currentSelection.length) return null;
      const answer = { question_id: q.id };
      if(q.type === 'multiple') answer.choice_ids = currentSelection;
      else answer.choice_id = currentSelection[0];
      return answer;
    }

    async function finalizeCurrentTest(reason){
      const isTimeLimitFinish = reason === 'time_limit';
      setStudentBusyLabel(isTimeLimitFinish ? '時間切れのため提出しています' : '結果をまとめています');
      try{
        if(!currentSessionId){
          throw new Error('session_id required');
        }
        const finishPayload = isTimeLimitFinish ? {
          reason: 'time_limit',
          current_answer: buildCurrentAnswerForTimeout()
        } : null;
        const finishOptions = finishPayload ? {
          method: 'PUT',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify(finishPayload)
        } : { method: 'PUT' };
        const finishRes = await fetch('/api/exam-sessions/'+currentSessionId+'/finish', finishOptions);
        const finishJson = await finishRes.json().catch(function(){ return {}; });
        if(!finishRes.ok){
          throw new Error(finishJson && finishJson.error ? finishJson.error : 'finish_failed');
        }
        if(isExamMode(currentTest)){
          setResultsSummary([]);
          setSummaryMeta(null);
          setExamCompletionMeta({
            testName: currentTest ? currentTest.name : '',
            score: finishJson && typeof finishJson.score !== 'undefined' ? finishJson.score : 0,
            maxScore: finishJson && typeof finishJson.max_score !== 'undefined' ? finishJson.max_score : 0,
            timedOut: isTimeLimitFinish || (finishJson && finishJson.finish_reason === 'time_limit')
          });
          setExamCloseHintVisible(false);
          setExamReviewVisible(false);
          setReviewingQuestionIndex(null);
          setExamDeadlineAt(null);
          setExamRemainingSeconds(null);
          setMessage('試験終了');
          setCurrentTest(null);
          setCurrentSessionId(null);
          return;
        }
        let summaryUrl = '/api/tests/'+currentTest.id+'/summary?student_id='+student.id;
        if(currentSessionId) summaryUrl += '&session_id=' + encodeURIComponent(currentSessionId);
        const res = await fetch(summaryUrl);
        const j = await res.json().catch(function(){ return {}; });
        if(!res.ok){
          throw new Error(j && j.error ? j.error : 'summary_fetch_failed');
        }
        if(j && j.details){
          const qres = await fetch('/api/exam-sessions/' + encodeURIComponent(currentSessionId) + '/questions');
          const questions = await qres.json().catch(()=>[]);
          const details = j.details.map(d => {
            const summaryQuestion = (questions || []).find(x => x.id === d.question_id) || { choices: [] };
            const choiceMap = {};
            (summaryQuestion.choices || []).forEach(c => { choiceMap[c.id] = c.text; });
            const given_texts = (d.given_choice_ids || []).map(id => choiceMap[id] || String(id)).filter(Boolean);
            const correct_texts = (d.correct_choice_ids || []).map(id => choiceMap[id] || String(id)).filter(Boolean);
            return {
            questionId: d.question_id,
            text: d.text,
            content_html: d.content_html || '',
            content_format: d.content_format || (d.content_html ? 'html' : 'plain'),
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
        setExamDeadlineAt(null);
        setExamRemainingSeconds(null);
      }catch(e){
        setMessage('採点結果の取得に失敗しました');
      }finally{
        setStudentBusyLabel('');
      }
    }

    function submitCurrentAnswer(){
      const q = currentQuestions[currentIndex];
      if(!q) return;
      if(isExamMode(currentTest) && examRemainingSeconds === 0){
        if(!examAutoSubmitRef.current){
          examAutoSubmitRef.current = true;
          finalizeCurrentTest('time_limit');
        }
        return;
      }
      setStudentBusyLabel('回答を送信しています');
      const payload = { student_id: student.id, test_id: currentTest.id, question_id: q.id, session_id: currentSessionId };
      if(q.type === 'multiple') payload.choice_ids = currentSelection;
      else payload.choice_id = currentSelection && currentSelection[0] ? currentSelection[0] : null;
      fetch('/api/submit-answer', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) }).then(r=>r.json()).then(j=>{
        if(j && j.error){
          if(j.error === 'time_limit_exceeded'){
            if(!examAutoSubmitRef.current){
              examAutoSubmitRef.current = true;
              finalizeCurrentTest('time_limit');
            }
            return;
          }
          setMessage(j.error);
          return;
        }
        if(isExamMode(currentTest)){
          rememberCurrentSelection(q.id, currentSelection);
        }
        if(isImmediateFeedbackMode(currentTest) && j && j.feedback){
          setLastResult({
            questionId: j.feedback.question_id || q.id,
            text: j.feedback.question_text || q.text,
            content_html: j.feedback.content_html || q.content_html || '',
            content_format: j.feedback.content_format || q.content_format || (j.feedback.content_html || q.content_html ? 'html' : 'plain'),
            points: q.points || 1,
            correct: !!j.feedback.correct,
            given_choice_ids: j.feedback.given_choice_ids || [],
            given_texts: j.feedback.given_texts || [],
            correct_choice_ids: j.feedback.correct_choice_ids || [],
            correct_texts: j.feedback.correct_texts || [],
            explanation: j.feedback.explanation || ''
          });
          return;
        }
        nextQuestion();
      }).catch(()=> setMessage('送信エラー')).finally(function(){ setStudentBusyLabel(''); });
    }

    function nextQuestion(){
      setCurrentSelection([]);
      setLastResult(null);
      if(currentIndex+1 < currentQuestions.length){
        setCurrentIndex(currentIndex+1);
        return;
      }
      if(isExamMode(currentTest)){
        openExamReview();
        return;
      }
      finalizeCurrentTest();
    }

    function goToStudentStart(){
      const sharedTest = sharedStudentAccess
        ? (tests.find(function(t){ return String(t.id) === String(sharedStudentTestId); }) || null)
        : null;
      const sharedSet = sharedStudentAccess
        ? (testSets.find(function(s){ return String(s.id) === String(sharedStudentSetId); }) || null)
        : null;
      setResultsSummary([]);
      setSummaryMeta(null);
      setExamCompletionMeta(null);
      setExamCloseHintVisible(false);
      setExamDeadlineAt(null);
      setExamServerOffsetMs(0);
      setExamRemainingSeconds(null);
      examAutoSubmitRef.current = false;
      setAnswersByQuestionId({});
      setExamReviewVisible(false);
      setReviewingQuestionIndex(null);
      setStudent(null);
      setStudentName('');
      setStudentClassId(sharedStudentClassId || (getTestClassIds(sharedTest)[0] || getSetClassIds(sharedSet)[0] || ''));
      setStudentTests(sharedTest ? [sharedTest] : []);
      setStudentSets(sharedSet ? [sharedSet] : []);
      setSelectedStudentSet(sharedSet || null);
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
      setExamCompletionMeta(null);
      setExamCloseHintVisible(false);
      setExamDeadlineAt(null);
      setExamServerOffsetMs(0);
      setExamRemainingSeconds(null);
      examAutoSubmitRef.current = false;
      setAnswersByQuestionId({});
      setExamReviewVisible(false);
      setReviewingQuestionIndex(null);
      setMessage('');
    }

    function closeExamWindow(){
      setExamCloseHintVisible(false);
      try{
        window.close();
      }catch(_err){
        // Some browsers block window.close() for tabs not opened by script.
      }
      window.setTimeout(function(){
        if(!window.closed){
          setExamCloseHintVisible(true);
        }
      }, 250);
    }

    function renderStudent(){
      const sharedTest = sharedStudentAccess
        ? ((studentTests || []).find(function(t){ return String(t.id) === String(sharedStudentTestId); }) || tests.find(function(t){ return String(t.id) === String(sharedStudentTestId); }) || null)
        : null;
      const sharedSet = sharedStudentAccess
        ? ((studentSets || []).find(function(s){ return String(s.id) === String(sharedStudentSetId); }) || testSets.find(function(s){ return String(s.id) === String(sharedStudentSetId); }) || null)
        : null;
      const activeStudentSet = selectedStudentSet || sharedSet || null;
      const resolvedClassId = studentClassId || sharedStudentClassId || (getTestClassIds(sharedTest)[0] || getSetClassIds(sharedSet)[0] || '');
      const availableTests = activeStudentSet
        ? (activeStudentSet.items || [])
        : (sharedStudentAccess
        ? (sharedTest ? [sharedTest] : [])
        : (studentTests || []));
      const availableSets = sharedStudentAccess ? (sharedSet ? [sharedSet] : []) : (studentSets || []);
      const currentClass = classes.find(function(c){ return String(c.id) === String(resolvedClassId); }) || null;
      const classLabel = currentClass ? currentClass.name : (sharedStudentAccess ? '配布テスト' : 'クラス未選択');
      const sharedAccessUnavailable = sharedStudentAccess && !sharedTest && !sharedSet;
      const sharedAccessNeedsClass = sharedStudentAccess && !resolvedClassId;
      const hasStudentName = !!(studentName && studentName.trim());
      const examFinished = !currentTest && !!examCompletionMeta;
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
          const latestSession = t.latest_session || null;
          const completed = latestSession && (latestSession.status === 'completed' || latestSession.finished_at);
          return e('article', { key: t.id, className: cx('student-test-card', !hasStudentName && 'is-disabled') },
            e('div', { className: 'student-test-card__top' },
              e('span', { className: 'student-pill' }, (t.question_count != null ? t.question_count : questionCount) != null ? ((t.question_count != null ? t.question_count : questionCount) + '問') : '問題確認中'),
              completed ? e('span', { className: 'student-pill student-pill-soft' }, '受験済み') : (latestSession ? e('span', { className: 'student-pill student-pill-muted' }, '途中') : null),
              e('span', { className: 'student-pill student-pill-muted' }, getAnswerModeLabel(t)),
              isExamMode(t) && getTimeLimitMinutes(t) ? e('span', { className: 'student-pill student-pill-muted' }, formatTimeLimitLabel(t)) : null,
              t.randomize ? e('span', { className: 'student-pill student-pill-muted' }, 'ランダム出題') : null,
              t.public ? e('span', { className: 'student-pill student-pill-soft' }, '公開中') : null
            ),
            e('h3', null, t.name),
            e('p', { className: 'student-test-card__meta' }, classLabel + ' / ' + getAnswerModeDescription(t)),
            e('div', { className: cx('student-test-card__footer', sharedStudentAccess && 'student-test-card__footer-centered') },
              e('span', { className: 'student-test-card__helper' }, hasStudentName ? getAnswerModeDescription(t) : '表示名を入力すると始められます。'),
              e('button', { onClick: function(){ handler(t); }, className: 'btn btn-primary', type: 'button', disabled: !hasStudentName || !!studentBusyLabel }, studentBusyLabel ? '準備中...' : buttonText)
            )
          );
        }));
      }

      function renderSetCatalog(){
        if(activeStudentSet){
          return e('div', null,
            e('div', { className: 'student-preview-inline-note is-strong' },
              e('strong', null, activeStudentSet.name),
              e('span', null, '受けるテストを選んで開始できます。全て終わっていなくても進捗は保存されます。')
            ),
            e('div', { className: 'hero-actions' },
              sharedStudentAccess ? null : e('button', { className: 'btn btn-ghost', type: 'button', onClick: function(){ setSelectedStudentSet(null); } }, 'まとめ一覧へ戻る')
            ),
            renderTestCatalog('このテストを始める', attemptStartTest)
          );
        }
        if(!availableSets.length){
          return renderTestCatalog(sharedStudentAccess ? 'テストを始める' : '学習をはじめる', attemptStartTest);
        }
        return e('div', { className: 'student-test-grid' }, availableSets.map(function(testSet){
          const items = testSet.items || [];
          const completedCount = items.filter(function(item){
            const session = item.latest_session;
            return session && (session.status === 'completed' || session.finished_at);
          }).length;
          return e('article', { key: 'set-' + testSet.id, className: cx('student-test-card', !hasStudentName && 'is-disabled') },
            e('div', { className: 'student-test-card__top' },
              e('span', { className: 'student-pill student-pill-soft' }, 'まとめ'),
              e('span', { className: 'student-pill' }, items.length + 'テスト'),
              e('span', { className: 'student-pill student-pill-muted' }, completedCount + '/' + items.length + '完了')
            ),
            e('h3', null, testSet.name),
            e('p', { className: 'student-test-card__meta' }, testSet.description || (classLabel + ' / まとめ配布')),
            e('div', { className: cx('student-test-card__footer', sharedStudentAccess && 'student-test-card__footer-centered') },
              e('span', { className: 'student-test-card__helper' }, hasStudentName ? '中のテストを好きな順番で受けられます。' : '表示名を入力すると開けます。'),
              e('button', { onClick: function(){ setSelectedStudentSet(testSet); }, className: 'btn btn-primary', type: 'button', disabled: !hasStudentName || !!studentBusyLabel }, 'まとめを開く')
            )
          );
        }).concat((studentTests || []).map(function(t){
          const questionCount = testQuestionCounts[t.id];
          return e('article', { key: 'test-' + t.id, className: cx('student-test-card', !hasStudentName && 'is-disabled') },
            e('div', { className: 'student-test-card__top' },
              e('span', { className: 'student-pill' }, questionCount != null ? (questionCount + '問') : '問題確認中'),
              e('span', { className: 'student-pill student-pill-muted' }, getAnswerModeLabel(t)),
              isExamMode(t) && getTimeLimitMinutes(t) ? e('span', { className: 'student-pill student-pill-muted' }, formatTimeLimitLabel(t)) : null
            ),
            e('h3', null, t.name),
            e('p', { className: 'student-test-card__meta' }, classLabel + ' / ' + getAnswerModeDescription(t)),
            e('div', { className: 'student-test-card__footer' },
              e('span', { className: 'student-test-card__helper' }, hasStudentName ? 'このテストだけを開始します。' : '表示名を入力すると始められます。'),
              e('button', { onClick: function(){ attemptStartTest(t); }, className: 'btn btn-primary', type: 'button', disabled: !hasStudentName || !!studentBusyLabel }, '学習をはじめる')
            )
          );
        })));
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
                      e('select', { value: studentClassId, onChange: ev => { const cid = ev.target.value; setStudentClassId(cid); setSelectedStudentSet(null); if(cid){ fetch('/api/tests?class_id='+cid+'&public=1').then(r=>r.json()).then(ts=>{ setStudentTests(ts || []); }).catch(()=> setMessage('テスト取得エラー')); fetch('/api/test-sets?class_id='+cid+'&public=1').then(r=>r.json()).then(ss=>{ setStudentSets(ss || []); }).catch(()=> setMessage('まとめ配布取得エラー')); } else { setStudentTests([]); setStudentSets([]); } }, 'aria-label': 'クラス選択' }, [ e('option', { key: '__empty2', value: '' }, 'クラス選択') ].concat(classes.map(c=> e('option', { key: c.id, value: c.id }, c.name) )))
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
              renderSetCatalog()
            )
          )
        );
      }
      if(!currentTest){
        if(examFinished){
          return e('div', { className: 'student-preview-shell' },
            studentBusyLabel ? e('div', { className: 'student-status-strip', role: 'status' }, studentBusyLabel) : null,
            e('section', { className: 'student-preview-banner student-preview-banner-loggedin' },
              e('div', { className: 'student-preview-banner__body' },
                e('p', { className: 'student-preview-kicker' }, '試験終了'),
                e('h2', null, '試験終了'),
                e('p', { className: 'student-preview-lead' }, ((examCompletionMeta && examCompletionMeta.testName) || 'このテスト') + ' の回答を送信しました。'),
                examCompletionMeta && examCompletionMeta.timedOut ? e('p', { className: 'student-action-hint' }, '制限時間に達したため、そこまでの回答を提出しました。') : null,
                e('div', { className: 'student-summary-stats' },
                  e('article', { className: 'student-preview-stat' },
                    e('span', { className: 'student-preview-stat__label' }, '合計得点'),
                    e('strong', { className: 'student-preview-stat__value' }, ((examCompletionMeta && typeof examCompletionMeta.score !== 'undefined') ? examCompletionMeta.score : 0) + ' / ' + ((examCompletionMeta && typeof examCompletionMeta.maxScore !== 'undefined') ? examCompletionMeta.maxScore : 0) + '点')
                  )
                ),
                examCloseHintVisible ? e('p', { className: 'student-action-hint', role: 'status' }, '閉じられない場合は、このタブを手動で閉じてください。') : null,
                e('div', { className: 'hero-actions student-summary-hero__actions' },
                  e('button', { onClick: closeExamWindow, className: 'btn btn-primary', type: 'button' }, '閉じる')
                )
              )
            )
          );
        }
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
                      renderRichQuestionContent(r, { className: 'rich-question-content student-summary-question', fallbackText: '（無題）' })
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
              renderSetCatalog()
            )
          )
        );
      }
      if(examReviewVisible && reviewingQuestionIndex === null){
        const answeredTotal = currentQuestions.filter(function(question){
          return getStoredSelection(question).length > 0;
        }).length;
        const reviewRemaining = examRemainingSeconds !== null ? formatRemainingTime(examRemainingSeconds) : null;
        return e('div', { className: 'student-preview-shell' },
          studentBusyLabel ? e('div', { className: 'student-status-strip', role: 'status' }, studentBusyLabel) : null,
          e('section', { className: 'student-preview-banner student-preview-banner-loggedin' },
            e('div', { className: 'student-preview-banner__body' },
              e('p', { className: 'student-preview-kicker' }, '見直し'),
              e('h2', null, (currentTest && currentTest.name ? currentTest.name : 'このテスト') + ' の回答確認'),
              e('p', { className: 'student-preview-lead' }, '提出前に、全問題の回答内容を確認できます。必要な問題は見直してから提出してください。'),
              reviewRemaining ? e('p', { className: 'student-action-hint' }, '残り ' + reviewRemaining) : null,
              e('div', { className: 'hero-actions student-summary-hero__actions' },
                e('button', { onClick: function(){ finalizeCurrentTest(); }, className: 'btn btn-primary', type: 'button', disabled: !!studentBusyLabel || answeredTotal < currentQuestions.length || examRemainingSeconds === 0 }, studentBusyLabel ? '提出中...' : '回答を提出')
              )
            )
          ),
          e('section', { className: 'student-preview-panel' },
            e('div', { className: 'student-preview-panel__header' },
              e('div', null,
                e('p', { className: 'student-preview-kicker student-preview-kicker-muted' }, '回答リスト'),
                e('h3', null, '全問題のチェック内容')
              ),
              e('span', { className: 'student-preview-caption' }, answeredTotal + ' / ' + currentQuestions.length + ' 問回答済み')
            ),
            e('div', { className: 'student-summary-list' }, currentQuestions.map(function(question, index){
              const selection = getStoredSelection(question);
              const points = Number(question.points || 0);
              return e('article', { key: question.id || index, className: 'student-summary-card' },
                e('div', { className: 'student-summary-card__header' },
                  e('div', null,
                    e('span', { className: 'student-summary-card__index' }, 'Q' + (index + 1)),
                    renderRichQuestionContent(question, { className: 'rich-question-content student-summary-question', fallbackText: '（無題）' })
                  ),
                  e('span', { className: 'student-status-pill is-neutral' }, selection.length ? '回答済み' : '未回答')
                ),
                e('div', { className: 'student-summary-card__meta' },
                  e('span', null, '配点 ' + points + ' 点')
                ),
                e('div', { className: 'student-summary-card__rows' },
                  e('div', { className: 'student-summary-row' },
                    e('span', { className: 'student-summary-row__label' }, '選択した回答'),
                    e('strong', null, formatChoiceTextsForQuestion(question, selection))
                  )
                ),
                e('div', { className: 'student-exam-actions' },
                  e('button', { onClick: function(){ reviewExamQuestion(index); }, className: 'btn btn-ghost', type: 'button', disabled: !!studentBusyLabel }, '見直す')
                )
              );
            }))
          )
        );
      }
      // Test in progress
      const q = currentQuestions[currentIndex];
      if(!q) return e('div', { className: 'task-empty' }, '問題がありません');

      const showingFeedback = !!lastResult && isImmediateFeedbackMode(currentTest);
      const reviewingExamQuestion = isExamMode(currentTest) && examReviewVisible && reviewingQuestionIndex !== null;
      const answeredCount = reviewingExamQuestion ? currentQuestions.length : currentIndex + (showingFeedback ? 1 : 0);
      const progressPercent = currentQuestions.length ? Math.round(answeredCount / currentQuestions.length * 100) : 0;
      const remainingLabel = examRemainingSeconds !== null ? formatRemainingTime(examRemainingSeconds) : null;
      const examTimeIsUp = isExamMode(currentTest) && examRemainingSeconds === 0;

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
              e('div', { className: 'student-exam-progress-panel__badges' },
                remainingLabel ? e('span', { className: cx('student-status-pill', examRemainingSeconds <= 60 ? 'is-warning' : 'is-neutral') }, '残り ' + remainingLabel) : null,
                e('span', { className: 'student-status-pill is-neutral' }, '進捗 ' + progressPercent + '%')
              )
            ),
            e('p', { className: 'student-exam-progress-panel__lead' }, (student && student.name ? student.name : studentName || '学習者') + ' として学習中'),
            e('div', { className: 'student-exam-progress-bar' }, e('span', { style: { width: progressPercent + '%' } })),
            e('div', { className: 'student-exam-panel__meta' },
              e('span', null, '解答済み ' + answeredCount + ' / ' + currentQuestions.length),
              e('span', null, '残り ' + Math.max(currentQuestions.length - answeredCount, 0) + ' 問')
            )
          ),
          showingFeedback
            ? e('article', { className: cx('student-feedback-card', lastResult.correct ? 'is-correct' : 'is-incorrect') },
                e('div', { className: 'student-feedback-card__header' },
                  e('div', null,
                    e('span', { className: 'student-question-card__type-label' }, '回答結果'),
                    renderRichQuestionContent(lastResult, { className: 'rich-question-content student-question-rich' })
                  ),
                  e('span', { className: cx('student-status-pill', lastResult.correct ? 'is-correct' : 'is-incorrect') }, lastResult.correct ? '正解' : '不正解')
                ),
                e('div', { className: 'student-feedback-card__body' },
                  e('div', { className: 'student-summary-row' },
                    e('span', { className: 'student-summary-row__label' }, 'あなたの回答'),
                    e('strong', null, formatAnswerTexts(lastResult.given_texts, '未回答'))
                  ),
                  e('div', { className: 'student-summary-row' },
                    e('span', { className: 'student-summary-row__label' }, '正答'),
                    e('strong', null, formatAnswerTexts(lastResult.correct_texts, '設定なし'))
                  ),
                  lastResult.explanation ? e('div', { className: 'student-summary-row student-summary-row-note' },
                    e('span', { className: 'student-summary-row__label' }, '解説'),
                    e('span', null, lastResult.explanation)
                  ) : null
                )
              )
            : e('article', { className: 'student-question-card' },
                e('div', { className: 'student-question-card__header' },
                    e('span', { className: 'student-question-card__type-label' }, q && q.type === 'multiple' ? '複数選択' : '１つ選択')
                  ),
                renderRichQuestionContent(q, { className: 'rich-question-content student-question-rich' }),
                e('p', { className: 'student-question-card__hint' }, ''),
                e('div', { className: 'student-choice-list' }, (q.choices || []).map(function(c){
                  const selected = currentSelection.includes(c.id);
                  const inputType = q.type === 'multiple' ? 'checkbox' : 'radio';
                  return e('label', { key: c.id, className: cx('student-choice-option', selected && 'is-selected') },
                    e('input', { type: inputType, name: 'q' + q.id, checked: selected, disabled: !!studentBusyLabel || examTimeIsUp, onChange: function(ev){ selectChoice(q, c.id, q.type === 'multiple' ? ev.target.checked : true); } }),
                    e('span', { className: 'student-choice-option__marker' }),
                    e('span', { className: 'student-choice-option__text' }, c.text)
                  );
                }))
              ),
          e('div', { className: 'student-exam-actions' },
            reviewingExamQuestion
              ? e('button', { onClick: saveReviewedAnswer, className: 'btn btn-primary', type: 'button', disabled: !currentSelection.length || !!studentBusyLabel || examTimeIsUp }, studentBusyLabel ? '更新中...' : '見直しリストへ戻る')
              : showingFeedback
              ? e('button', { onClick: nextQuestion, className: 'btn btn-primary', type: 'button', disabled: !!studentBusyLabel }, currentIndex + 1 < currentQuestions.length ? '次の問題へ' : '振り返りを見る')
              : e('button', { onClick: submitCurrentAnswer, className: 'btn btn-primary', type: 'button', disabled: !currentSelection.length || !!studentBusyLabel || examTimeIsUp }, studentBusyLabel ? '送信中...' : '回答を送信'),
            reviewingExamQuestion ? e('span', { className: 'student-action-hint' }, '正答や得点は提出後まで表示されません。') : (showingFeedback ? e('span', { className: 'student-action-hint' }, '得点は最後の振り返りページで表示します。') : null)
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
    function getReportClassId(row){
      return row && (row.studentClassId || row.student_class_id || row.classId || row.class_id || '');
    }

    function getReportClassName(row){
      const directName = row && (row.studentClassName || row.student_class_name || row.className || row.class_name || '');
      if(directName) return directName;
      const classId = getReportClassId(row);
      const matchedClass = classId ? (classes || []).find(function(c){ return String(c.id) === String(classId); }) : null;
      return matchedClass ? matchedClass.name : '';
    }

    function getReportStudentKey(row){
      return row && (row.studentId || row.student_id || row.studentName || '');
    }

      const filteredReports = (reports || []).filter(r => {
        const tn = (r.testName || '').toLowerCase();
      const un = (r.studentName || '').toLowerCase();
      const rowClassId = getReportClassId(r);
        // If a test is selected from the dropdown, match exact test name (case-insensitive)
        if(reportFilterTest && tn !== (reportFilterTest||'').toLowerCase()) return false;
      if(reportFilterClassId && String(rowClassId) !== String(reportFilterClassId)) return false;
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
        if(key === 'className'){
          va = String(getReportClassName(a) || '').toLowerCase();
          vb = String(getReportClassName(b) || '').toLowerCase();
        } else if(key === 'studentName' || key === 'testName'){
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
      // CSV columns aligned with visible table: 日時, studentName, className, testName, score, maxScore, percent
      const rows = [['日時','studentName','className','testName','score','maxScore','percent']];
      filteredReports.forEach(r=> {
        const dt = r.finished_at || r.started_at || '';
        rows.push([dt || '記録なし', r.studentName||'', getReportClassName(r) || '', r.testName||'', r.score||0, r.maxScore||0, Math.round((r.percent||0)*100)/100]);
      });
      const csv = rows.map(r=> r.map(c=> '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'reports.csv'; a.click(); URL.revokeObjectURL(url);
    }

    function getAverageReportPercent(rows){
      return rows.length
        ? Math.round(rows.reduce(function(sum, r){ return sum + Number(r.percent || 0); }, 0) / rows.length)
        : 0;
    }

    function buildReportClassTestSummaries(rows){
      const byTest = {};
      (rows || []).forEach(function(row){
        const testId = row.testId || row.test_id || '';
        const testName = row.testName || '不明なテスト';
        const key = testId ? ('id:' + testId) : ('name:' + testName);
        byTest[key] = byTest[key] || {
          key: key,
          testId: testId,
          testName: testName,
          count: 0,
          score: 0,
          maxScore: 0,
          percentTotal: 0,
          students: new Set()
        };
        byTest[key].count += 1;
        byTest[key].score += Number(row.score || 0);
        byTest[key].maxScore += Number(row.maxScore || row.max_score || 0);
        byTest[key].percentTotal += Number(row.percent || 0);
        const studentKey = getReportStudentKey(row);
        if(studentKey) byTest[key].students.add(String(studentKey));
      });
      return Object.keys(byTest).map(function(key){
        const item = byTest[key];
        return {
          key: item.key,
          testId: item.testId,
          testName: item.testName,
          count: item.count,
          studentCount: item.students.size,
          score: item.score,
          maxScore: item.maxScore,
          averagePercent: item.count ? Math.round(item.percentTotal / item.count) : 0
        };
      }).sort(function(a, b){
        return String(a.testName || '').localeCompare(String(b.testName || ''), 'ja');
      });
    }

    const averageReportPercent = getAverageReportPercent(filteredReports);
    const uniqueStudentsCount = Array.from(new Set(filteredReports.map(function(r){ return getReportStudentKey(r); }).filter(Boolean))).length;
    const selectedReportClass = reportFilterClassId
      ? (classes || []).find(function(c){ return String(c.id || '') === String(reportFilterClassId || ''); })
      : null;
    const selectedReportClassName = selectedReportClass ? selectedReportClass.name : '';
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
    const selectedClassTestSummaries = (selectedReportClass && !selectedReportTest)
      ? buildReportClassTestSummaries(filteredReports)
      : [];

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
          classId: selectedReportClass ? selectedReportClass.id : '',
          className: selectedReportClassName,
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
          classId: selectedReportClass ? selectedReportClass.id : '',
          className: selectedReportClassName,
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
    }, [mode, selectedReportTest, selectedReportTestId, selectedReportRowsKey, averageReportPercent, reportFilterClassId, selectedReportClassName]);

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
      const analyticsScopeLabel = [
        reportFilterAnalytics.testName || 'テスト',
        reportFilterAnalytics.className || ''
      ].filter(Boolean).join(' / ');

      return e('div', { className: 'report-filter-analytics' },
        e('div', { className: 'report-filter-analytics__header' },
          e('strong', null, reportFilterAnalytics.className ? '選択中テスト・クラスの集計' : '選択中テストの集計'),
          e('span', { className: 'small' }, analyticsScopeLabel + ' / ' + String(reportFilterAnalytics.sampleSize || 0) + '件')
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

    function renderClassSummaryMetric(label, value, note){
      return e('div', { key: label, className: 'report-class-summary__metric' },
        e('span', null, label),
        e('strong', null, value),
        note ? e('small', null, note) : null
      );
    }

    function renderReportClassSummary(){
      if(!selectedReportClass || selectedReportTest){
        return null;
      }

      return e('div', { className: 'report-filter-analytics report-class-summary' },
        e('div', { className: 'report-filter-analytics__header' },
          e('strong', null, '選択中クラスの集計'),
          e('span', { className: 'small' }, (selectedReportClassName || 'クラス') + ' / ' + String(totalReports) + '件')
        ),
        e('div', { className: 'report-class-summary__metrics' }, [
          renderClassSummaryMetric('対象件数', String(totalReports), '現在の絞り込み結果'),
          renderClassSummaryMetric('平均正答率', averageReportPercent + '%', '受験記録ごとの平均'),
          renderClassSummaryMetric('受験者', String(uniqueStudentsCount), 'ユニーク人数'),
          renderClassSummaryMetric('対象テスト', String(selectedClassTestSummaries.length), 'テスト別内訳')
        ]),
        e('section', { className: 'report-chart-card report-class-summary__tests' },
          e('div', { className: 'report-chart-card__title' }, 'テスト別内訳'),
          selectedClassTestSummaries.length
            ? e('div', { className: 'report-class-summary__table-wrap' },
                e('table', { className: 'report-class-summary__table' },
                  e('thead', null,
                    e('tr', null,
                      e('th', null, 'テスト名'),
                      e('th', null, '件数'),
                      e('th', null, '受験者'),
                      e('th', null, '平均正答率'),
                      e('th', null, '得点')
                    )
                  ),
                  e('tbody', null,
                    selectedClassTestSummaries.map(function(item){
                      return e('tr', { key: item.key },
                        e('td', null, e('span', { className: 'report-class-summary__test-name' }, item.testName || '不明なテスト')),
                        e('td', null, String(item.count)),
                        e('td', null, String(item.studentCount)),
                        e('td', null, e('span', { className: 'report-class-summary__percent' }, item.averagePercent + '%')),
                        e('td', null, String(item.score) + ' / ' + String(item.maxScore))
                      );
                    })
                  )
                )
              )
            : e('div', { className: 'small' }, '対象データがありません')
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
      e('section', { className: 'task-section-card teacher-set-summary-card' },
        e('div', { className: 'task-section-heading' },
          e('div', { 'data-title-icon': 'reports' },
            e('h2', null, 'まとめ配布の集計'),
            e('p', { className: 'section-note' }, 'セット単位で、受験済みテスト数と合計点を確認できます。')
          ),
          e('span', { className: 'task-chip task-chip-muted' }, testSetSummariesLoading ? '読込中' : (testSetSummaries.length + '件'))
        ),
        testSetSummaries.length
          ? e('div', { className: 'teacher-set-summary-grid' }, testSetSummaries.map(function(summary){
              const totals = summary.totals || {};
              const set = summary.set || {};
              const percent = Math.round((totals.percent || 0) * 10) / 10;
              return e('article', { key: set.id, className: 'teacher-set-summary-row' },
                e('div', null,
                  e('strong', null, set.name || 'まとめ配布'),
                  e('p', { className: 'section-note' }, getSetAssignmentLabel(set, classes) + ' / ' + ((set.items || []).length) + 'テスト')
                ),
                e('div', { className: 'teacher-set-summary-row__stats' },
                  e('span', null, '生徒 ' + (totals.students || 0)),
                  e('span', null, '受験済み ' + (totals.completed_tests || 0) + ' / ' + (totals.possible_tests || 0)),
                  e('span', null, '得点 ' + (totals.score || 0) + ' / ' + (totals.max_score || 0)),
                  e('strong', null, percent + '%')
                )
              );
            }))
          : e('div', { className: 'task-empty' }, testSetSummariesLoading ? 'まとめ配布の集計を読み込んでいます' : '集計できるまとめ配布はまだありません')
      ),
      e('section', { className: 'task-section-card' },
        e('div', { className: 'task-section-heading' },
          e('div', { 'data-title-icon': 'filter' },
            e('h2', null, '絞り込み'),
            e('p', { className: 'section-note' }, 'テスト名、クラス、生徒名、期間で絞り込みます。')
          )
        ),
        e('div', { className: 'controls' },
          // テスト名は既存のテスト一覧から選べるようにする
          e('select', { value: reportFilterTest, onChange: ev => { setReportFilterTest(ev.target.value); setReportsPage(1); } },
            e('option', { value: '' }, 'テスト名でフィルタ（すべて）'),
            (tests || []).map(function(t){ return e('option', { key: t.id, value: t.name || '' }, t.name || ('テスト ' + t.id)); })
          ),
          e('select', { value: reportFilterClassId, onChange: ev => { setReportFilterClassId(ev.target.value); setReportsPage(1); } },
            e('option', { value: '' }, 'クラスでフィルタ（すべて）'),
            (classes || []).map(function(c){ return e('option', { key: c.id, value: String(c.id) }, c.name || ('クラス ' + c.id)); })
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
        renderReportFilterAnalytics(),
        renderReportClassSummary()
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
              e('thead', null, e('tr', null, e('th', null, renderSortLabel('日時','finished_at')), e('th', null, renderSortLabel('生徒名','studentName')), e('th', null, renderSortLabel('クラス','className')), e('th', null, renderSortLabel('テスト名','testName')), e('th', null, renderSortLabel('得点','score')), e('th', null, e('span', null, '満点')), e('th', null, renderSortLabel('正答率','percent')), e('th', null, '操作'))),
              e('tbody', null,
                pageSlice.length === 0 ? e('tr', null, e('td', { colSpan: 8, className: 'small' }, reportsLoading ? '読み込み中...' : '該当するテストがありません')) : pageSlice.map(function(row, idx){
                  const keyId = (row.studentId||'')+'-'+(row.testId||'')+'-'+idx;
                  const pct = Math.round((row.percent||0)*100)/100;
                  const pctClass = pct >= 70 ? 'score high' : (pct >= 40 ? 'score' : 'score low');
                  const dtRaw = row.finished_at || row.started_at || '';
                  let dtDisp = '記録なし';
                  try{ if(dtRaw) dtDisp = new Date(dtRaw).toLocaleString(); }catch(e){ dtDisp = dtRaw || '記録なし'; }
                  const rowClassName = getReportClassName(row) || '—';
                  return e('tr', { key: keyId },
                    e('td', null, dtDisp),
                    e('td', null, e('span', null, row.studentName || '—')),
                    e('td', null, e('span', { className: 'report-class-name' }, rowClassName)),
                    e('td', null, e('div', { className: 'testName' }, row.testName || '—')),
                    e('td', null, e('span', { className: 'mono' }, String(row.score || 0))),
                    e('td', null, e('span', { className: 'mono' }, String(row.maxScore || 0))),
                    e('td', null, e('span', { className: pctClass }, pct + '%')),
                    e('td', null,
                      e('button', { 'data-student': row.studentId||'', 'data-test': row.testId||'', onClick: function(){ showReportSummary(row); }, className: 'btn btn-small btn-ghost', type: 'button' }, '詳細'),
                      e('button', { onClick: function(){ deleteReport(row); }, className: 'btn btn-small btn-ghost', type: 'button', style: { marginLeft: 8 } }, '削除')
                    )
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
              renderRichQuestionContent(d, { className: 'rich-question-content rich-question-content--compact', fallbackText: '（無題）' }),
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
      const qrAssignedClasses = qrShareModal.kind === 'set'
        ? getSetAssignedClasses(qrShareModal.test, classes)
        : getAssignedClasses(qrShareModal.test, classes);
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
                qrAssignedClasses.length > 1 ? e('label', null,
                  e('span', { className: 'student-field-label' }, '配布先クラス'),
                  e('select', {
                    value: qrShareModal.classId || '',
                    onChange: function(ev){ qrShareModal.kind === 'set' ? updateSetQrShareForClass(qrShareModal.test, ev.target.value, false) : updateQrShareForClass(qrShareModal.test, ev.target.value, false); },
                    disabled: qrShareModal.loading,
                    'aria-label': '配布先クラス'
                  }, qrAssignedClasses.map(function(c){
                    return e('option', { key: c.id, value: String(c.id) }, c.name);
                  }))
                ) : null,
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
      mode === 'teacher' ? teacherNode : (mode === 'student' ? studentNode : reportsNode),
      summaryModal,
      qrShareNode
    );
  }
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
})();
