(function(){
  // helper to get element
  function el(id){ return document.getElementById(id); }
  function setStatus(msg, isError){ const s = el('status'); s.textContent = msg; s.style.color = isError ? '#900' : ''; }
  function createEmptyChoice(){ return { text: '', is_correct: false }; }
  function nextFrame(fn){ window.requestAnimationFrame(fn); }

  const state = { questions: [], editingIndex: -1, editorChoices: [], page: 0 };
  let isDirty = false;
  let lastSavedClassId = '';
  let lastSavedQuestions = [];
  let editingTestId = null;
  let editingTestMeta = { description: '', public: 0, randomize: 0 };
  const persistedDeletedQuestionIds = new Set();
  const MAX_QUESTIONS = 100;
  const MIN_CHOICES = 2;
  const PAGE_SIZE = 5;

  function cloneQuestions(questions){
    return JSON.parse(JSON.stringify(questions || []));
  }

  function normalizeChoice(choice){
    return {
      text: String((choice && choice.text) || '').trim(),
      is_correct: !!(choice && choice.is_correct)
    };
  }

  function normalizeQuestion(question){
    return {
      text: String((question && question.text) || '').trim(),
      type: question && question.type ? question.type : 'single',
      points: question && question.points ? question.points : 1,
      explanation: String((question && question.explanation) || '').trim(),
      choices: ((question && question.choices) || []).map(normalizeChoice)
    };
  }

  function getCurrentClassId(){
    const classSelect = el('class-select');
    return classSelect ? String(classSelect.value || '') : '';
  }

  function getCurrentQuestionsSnapshot(){
    return JSON.stringify(state.questions.map(normalizeQuestion));
  }

  function getSavedQuestionsSnapshot(){
    return JSON.stringify(
      lastSavedQuestions
        .filter(function(question){
          return !(question && question.id && persistedDeletedQuestionIds.has(question.id));
        })
        .map(normalizeQuestion)
    );
  }

  function hasPendingEditorChanges(){
    const questionField = el('question-text');
    const draft = {
      text: String(questionField ? questionField.value : '').trim(),
      choices: state.editorChoices.map(normalizeChoice).filter(function(choice){
        return choice.text || choice.is_correct;
      })
    };

    if(state.editingIndex >= 0){
      const source = state.questions[state.editingIndex];
      const original = {
        text: String((source && source.text) || '').trim(),
        choices: ((source && source.choices) || []).map(normalizeChoice).filter(function(choice){
          return choice.text || choice.is_correct;
        })
      };
      return JSON.stringify(draft) !== JSON.stringify(original);
    }

    return draft.text !== '' || draft.choices.length > 0;
  }

  function refreshDirtyState(){
    isDirty = getCurrentClassId() !== lastSavedClassId || getCurrentQuestionsSnapshot() !== getSavedQuestionsSnapshot() || hasPendingEditorChanges();
  }

  function markSavedState(){
    lastSavedClassId = getCurrentClassId();
    lastSavedQuestions = cloneQuestions(state.questions);
    persistedDeletedQuestionIds.clear();
    isDirty = false;
  }

  function focusQuestionField(){
    nextFrame(function(){
      const field = el('question-text');
      if(field) field.focus();
    });
  }

  function focusChoiceInput(index){
    nextFrame(function(){
      const field = document.querySelector('[data-choice-input="' + index + '"]');
      if(field) field.focus();
    });
  }

  function syncEditorMeta(){
    const modeChip = el('editor-mode-chip');
    const questionCount = el('editor-question-count');
    const choiceCount = el('editor-choice-count');
    if(modeChip) modeChip.textContent = state.editingIndex >= 0 ? '編集中' : '新規作成';
    if(questionCount) questionCount.textContent = state.questions.length + ' / ' + MAX_QUESTIONS + '問';
    if(choiceCount) choiceCount.textContent = '選択肢 ' + state.editorChoices.length + '件';
  }

  function mapGeneratedQuestion(question){
    const choices = ((question && question.choices) || []).map(function(choice){
      return {
        text: String((choice && choice.text) || '').trim(),
        is_correct: !!(choice && choice.is_correct)
      };
    });
    const correctCount = choices.filter(function(choice){ return choice.is_correct; }).length;
    return {
      text: String((question && question.text) || '').trim(),
      choices: choices,
      type: question && question.type ? question.type : (correctCount > 1 ? 'multiple' : 'single'),
      points: question && question.points ? question.points : 1,
      explanation: String((question && question.explanation) || '').trim()
    };
  }

  function syncAutoGenerationOptions(){
    const choiceCountField = el('auto-choice-count');
    const multipleToggle = el('auto-multiple-toggle');
    const multipleField = el('auto-allow-multiple');
    if(!choiceCountField || !multipleToggle || !multipleField) return;
    const choiceCount = parseInt(choiceCountField.value, 10) || 2;
    const enabled = choiceCount === 4;
    multipleToggle.style.display = enabled ? 'flex' : 'none';
    multipleField.disabled = !enabled;
    if(!enabled) multipleField.checked = false;
  }

  function setChoiceCount(count){
    const target = Math.max(MIN_CHOICES, count);
    const nextChoices = state.editorChoices.slice(0, target);
    while(nextChoices.length < target){
      nextChoices.push(createEmptyChoice());
    }
    state.editorChoices = nextChoices;
    renderChoicesEditor();
  }

  async function loadClasses(){
    try{
      const res = await fetch('/api/classes');
      const classes = await res.json();
      const sel = el('class-select');
      (classes || []).forEach(c => {
        const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.name; sel.appendChild(opt);
      });
      return classes || [];
    }catch(e){ setStatus('クラス取得エラー', true); return []; }
  }

  function renderChoicesEditor(){
    const list = el('choices-list'); list.innerHTML = '';
    syncEditorMeta();
    state.editorChoices.forEach((c, idx) => {
      const row = document.createElement('div'); row.className = 'choice-editor-row';
      const indexBadge = document.createElement('span'); indexBadge.className = 'choice-editor-row__index'; indexBadge.textContent = String.fromCharCode(65 + idx);
      const input = document.createElement('input'); input.type = 'text'; input.value = c.text || ''; input.className = 'choice-editor-input'; input.placeholder = '選択肢を入力'; input.setAttribute('data-choice-input', idx);
      input.addEventListener('input', function(e){ state.editorChoices[idx].text = e.target.value; refreshDirtyState(); });
      input.addEventListener('keydown', function(e){
        if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){
          e.preventDefault();
          addQuestionFromEditor();
          return;
        }
        if(e.key === 'Enter' && !e.shiftKey){
          e.preventDefault();
          if(idx === state.editorChoices.length - 1){
            state.editorChoices.push(createEmptyChoice());
            renderChoicesEditor();
            focusChoiceInput(idx + 1);
            return;
          }
          focusChoiceInput(idx + 1);
        }
      });
      const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = !!c.is_correct;
      chk.addEventListener('change', function(){ state.editorChoices[idx].is_correct = chk.checked; renderChoicesEditor(); refreshDirtyState(); });
      const label = document.createElement('label'); label.className = 'task-toggle compact'; label.appendChild(chk); label.appendChild(document.createTextNode(' 正解'));
      const del = document.createElement('button'); del.className = 'btn btn-small btn-ghost'; del.type = 'button'; del.textContent = '削除';
      del.disabled = state.editorChoices.length <= MIN_CHOICES;
      del.addEventListener('click', function(){ state.editorChoices.splice(idx,1); renderChoicesEditor(); refreshDirtyState(); });
      row.appendChild(indexBadge); row.appendChild(input); row.appendChild(label); row.appendChild(del);
      list.appendChild(row);
    });
  }

  function resetEditor(options){
    const config = options || {};
    el('question-text').value = '';
    state.editorChoices = [ createEmptyChoice(), createEmptyChoice() ];
    state.editingIndex = -1;
    el('editor-title').textContent = '問題を作成';
    renderChoicesEditor();
    if(config.focusQuestion !== false) focusQuestionField();
  }

  function goToPage(p){
    const pageCount = Math.max(1, Math.ceil((state.questions || []).length / PAGE_SIZE));
    state.page = Math.max(0, Math.min(p, pageCount - 1));
    renderQuestionsList();
  }

  function renderQuestionsList(){
    const container = el('questions-list'); container.innerHTML = '';
    syncEditorMeta();
    if(!state.questions || state.questions.length === 0){ container.textContent = '問題はまだありません'; return; }

    const pageCount = Math.max(1, Math.ceil(state.questions.length / PAGE_SIZE));
    if(state.page >= pageCount) state.page = Math.max(0, pageCount - 1);
    const start = state.page * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, state.questions.length);

    const ol = document.createElement('ol');
    for(let i = start; i < end; i++){
      const q = state.questions[i];
      const idx = i; // global index in state.questions
      const li = document.createElement('li');
      const qdiv = document.createElement('div'); qdiv.className = 'question-list-card__title';
      // 表示は先頭20文字のみ（末尾に省略記号）。フルテキストはツールチップとクリックで確認可能。
      const maxLen = 15;
      const rawText = String(q.text || '');
      const displayText = rawText.length > maxLen ? rawText.slice(0, maxLen) + '…' : rawText;
      qdiv.textContent = displayText;
      // title属性でホバー時に全文を表示
      qdiv.title = rawText;
      // クリックで全文をモーダルまたはダイアログで表示（簡易実装：alert）
      qdiv.style.cursor = 'pointer';
      qdiv.addEventListener('click', function(){ if(rawText) { alert(rawText); } });
      const meta = document.createElement('div'); meta.className = 'task-helper-text'; meta.appendChild(document.createTextNode('選択肢: ' + (q.choices ? q.choices.length : 0) + ' / ' + ((q.type || 'single') === 'multiple' ? '複数正解' : '単一正解')));
      const btnEdit = document.createElement('button'); btnEdit.className='btn btn-small btn-primary'; btnEdit.type='button'; btnEdit.textContent='編集'; btnEdit.addEventListener('click', function(){ editQuestion(idx); });
      const btnDel = document.createElement('button'); btnDel.className='btn btn-small btn-ghost'; btnDel.type='button'; btnDel.textContent='削除'; btnDel.addEventListener('click', function(){ deleteQuestion(idx); });
      const btnDup = document.createElement('button'); btnDup.className='btn btn-small btn-secondary'; btnDup.type='button'; btnDup.textContent='複製'; btnDup.title = 'この問題を複製して次に追加';
      btnDup.addEventListener('click', function(){ duplicateQuestion(idx); });
      const actions = document.createElement('div'); actions.className = 'task-inline-actions';
      actions.appendChild(btnEdit); actions.appendChild(btnDup); actions.appendChild(btnDel);
      li.appendChild(qdiv); li.appendChild(meta); li.appendChild(actions); ol.appendChild(li);
    }
    container.appendChild(ol);

    // pagination controls
    if(pageCount > 1){
      const pager = document.createElement('div'); pager.className = 'questions-pagination'; pager.style.display = 'flex'; pager.style.gap = '8px'; pager.style.alignItems = 'center'; pager.style.marginTop = '8px';
      const btnPrev = document.createElement('button'); btnPrev.className = 'btn btn-ghost'; btnPrev.type = 'button'; btnPrev.textContent = '前へ'; btnPrev.disabled = state.page <= 0;
      btnPrev.addEventListener('click', function(){ if(state.page > 0){ state.page -= 1; renderQuestionsList(); } });
      const pageIndicator = document.createElement('span'); pageIndicator.textContent = (state.page + 1) + ' / ' + pageCount + 'ページ'; pageIndicator.style.margin = '0 8px';
      const btnNext = document.createElement('button'); btnNext.className = 'btn btn-ghost'; btnNext.type = 'button'; btnNext.textContent = '次へ'; btnNext.disabled = state.page >= pageCount - 1;
      btnNext.addEventListener('click', function(){ if(state.page < pageCount - 1){ state.page += 1; renderQuestionsList(); } });
      pager.appendChild(btnPrev);
      // page number buttons
      const pagesWrap = document.createElement('div'); pagesWrap.style.display = 'flex'; pagesWrap.style.gap = '4px';
      for(let p = 0; p < pageCount; p++){
        const pbtn = document.createElement('button'); pbtn.className = p === state.page ? 'btn btn-small btn-primary' : 'btn btn-small btn-ghost'; pbtn.type = 'button'; pbtn.textContent = String(p + 1);
        (function(pp){ pbtn.addEventListener('click', function(){ state.page = pp; renderQuestionsList(); }); })(p);
        pagesWrap.appendChild(pbtn);
      }
      pager.appendChild(pageIndicator);
      pager.appendChild(pagesWrap);
      pager.appendChild(btnNext);
      container.appendChild(pager);
    }
  }

  function removeQuestionAtIndex(index){
    state.questions.splice(index, 1);
    if(state.editingIndex === index){
      resetEditor({ focusQuestion: false });
      return;
    }
    if(state.editingIndex > index){
      state.editingIndex -= 1;
    }
  }

  async function requestJson(url, options, fallbackMessage){
    const response = await fetch(url, options);
    const payload = await response.json().catch(function(){ return null; });
    if(!response.ok){
      throw new Error((payload && payload.error) || fallbackMessage || '通信に失敗しました');
    }
    return payload;
  }

  async function deleteQuestion(index){
    const question = state.questions[index];
    if(!question) return;

    const confirmed = confirm('この問題を削除してよいですか？\n削除すると元に戻せません。');
    if(!confirmed) return;

    if(editingTestId && question.id){
      setStatus('問題を削除しています...');
      try{
        await requestJson('/api/questions/' + encodeURIComponent(question.id), { method: 'DELETE' }, '問題の削除に失敗しました');
        persistedDeletedQuestionIds.add(question.id);
        removeQuestionAtIndex(index);
        renderQuestionsList();
        refreshDirtyState();
        setStatus('問題を削除しました');
      }catch(error){
        console.error(error);
        setStatus(error.message || '問題の削除に失敗しました', true);
      }
      return;
    }

    removeQuestionAtIndex(index);
    renderQuestionsList();
    refreshDirtyState();
    setStatus('問題を削除しました');
  }

  function duplicateQuestion(index){
    const src = state.questions[index]; if(!src) return;
    // deep clone the question structure but omit DB ids so it becomes a new local question
    const clone = {
      text: src.text || '',
      choices: (src.choices || []).map(c => ({ text: c.text || '', is_correct: !!c.is_correct })),
      type: src.type || ((src.choices||[]).filter(c=>c.is_correct).length>1 ? 'multiple' : 'single'),
      points: src.points || 1,
      explanation: src.explanation || ''
    };
    // insert after the source index
    state.questions.splice(index + 1, 0, clone);
    // move to the page that contains the newly inserted question so it's visible
    state.page = Math.floor((index + 1) / PAGE_SIZE);
    renderQuestionsList();
    refreshDirtyState();
    // open editor for the newly inserted question
    editQuestion(index + 1);
    setStatus('問題を複製しました。編集モードになっています。');
  }

  function editQuestion(index){
    const q = state.questions[index]; if(!q) return;
    el('editor-title').textContent = '問題を編集'; el('question-text').value = q.text || '';
    state.editorChoices = (q.choices || []).map(c => ({ id: c.id, text: c.text || '', is_correct: !!c.is_correct }));
    state.editingIndex = index; renderChoicesEditor(); refreshDirtyState(); focusQuestionField();
  }

  function addQuestionFromEditor(){
    const text = el('question-text').value.trim(); if(!text){ setStatus('問題文を入力してください', true); return; }
    if(state.editingIndex < 0 && state.questions.length >= MAX_QUESTIONS){ setStatus('問題は最大100問までです', true); return; }
    const choices = state.editorChoices.map(c=>({ id: c.id, text: (c.text||'').trim(), is_correct: !!c.is_correct })).filter(c=>c.text);
    if(choices.length < 2){ setStatus('選択肢を2つ以上用意してください', true); return; }
    const correctCount = choices.filter(c=>c.is_correct).length;
    if(correctCount === 0){ setStatus('少なくとも1つの選択肢を正解に設定してください', true); return; }
    const type = correctCount > 1 ? 'multiple' : 'single';
    const q = { text: text, choices: choices, type: type, points: 1 };
    if(state.editingIndex >= 0){
      // preserve id if editing existing question
      const orig = state.questions[state.editingIndex];
      if(orig && orig.id) q.id = orig.id;
      state.questions[state.editingIndex] = q; state.editingIndex = -1; el('editor-title').textContent = '問題を作成';
    }
    else { state.questions.push(q); }
      renderQuestionsList(); resetEditor(); refreshDirtyState(); setStatus('問題を追加しました。続けて入力できます。');
  }

  async function saveTest(){
    const name = el('test-name').value.trim(); if(!name){ setStatus('テスト名を入力してください', true); return; }
    if(state.questions.length === 0){ setStatus('少なくとも1問追加してください', true); return; }
    if(state.questions.length > MAX_QUESTIONS){
      setStatus('エラー: 問題は最大100問までです。不要な問題を削除してください。', true);
      return;
    }
    let classId = el('class-select').value || null;
    if(!classId){
      const ok = confirm('クラスが選択されていません。後でクラスを設定しますか？\n「キャンセル」を選ぶとクラス選択に戻れます。');
      if(!ok){ el('class-select').focus(); setStatus('クラスを選択してください', true); return; }
      // proceed with null classId
    }
    const btn = el('save-test'); btn.disabled = true; setStatus('保存中...');
    try{
      if(editingTestId){
        // update existing test
        await requestJson('/api/tests/' + encodeURIComponent(editingTestId), { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: name, description: editingTestMeta.description || '', public: editingTestMeta.public ? 1 : 0, randomize: editingTestMeta.randomize ? 1 : 0, class_id: classId || null }) }, 'テスト更新に失敗しました');
        // process questions: update existing ones, create new ones
        for(const q of state.questions){
          if(q.id){
            // update question
            await requestJson('/api/questions/' + q.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: q.text, type: q.type || 'single', points: q.points || 1, explanation: q.explanation || '' }) }, '問題更新に失敗しました');
            // process choices
            for(const c of q.choices || []){
              if(c.id){
                await requestJson('/api/choices/' + c.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: c.text, is_correct: c.is_correct?1:0 }) }, '選択肢更新に失敗しました');
              } else {
                await requestJson('/api/questions/' + q.id + '/choices', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: c.text, is_correct: c.is_correct?1:0 }) }, '選択肢追加に失敗しました');
              }
            }
          } else {
            // new question
            await requestJson('/api/tests/' + editingTestId + '/questions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: q.text, type: q.type || 'single', points: q.points || 1, choices: q.choices, explanation: q.explanation || '' }) }, '問題追加に失敗しました');
          }
        }
        markSavedState();
        setStatus('テストを更新しました');
        setTimeout(function(){ window.location.href = '/app.html'; }, 1500);
      } else {
        // create new test
        const j = await requestJson('/api/tests', { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ class_id: classId || null, name: name, public: 0, randomize: 0 }) }, 'テスト作成に失敗しました');
        if(!j || !j.id){ setStatus('テスト作成に失敗しました', true); btn.disabled=false; return; }
        const testId = j.id;
        for(const q of state.questions){
          await requestJson('/api/tests/' + testId + '/questions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: q.text, type: q.type || 'single', points: q.points || 1, choices: q.choices, explanation: q.explanation || '' }) }, '問題追加に失敗しました');
        }
        markSavedState();
        setStatus('テストを作成しました（ID: ' + testId + '）。2秒後にダッシュボードへ戻ります。');
        setTimeout(function(){ window.location.href = '/app.html'; }, 2000);
      }
    }catch(e){ console.error(e); setStatus('保存中にエラーが発生しました', true); }
    finally{ btn.disabled = false; }
  }

  // Unsaved changes / navigation guard
  function showUnsavedModal(){
    const modal = el('unsaved-modal'); if(!modal) return;
    modal.style.display = 'flex';
  }
  function hideUnsavedModal(){ const modal = el('unsaved-modal'); if(modal) modal.style.display = 'none'; }

  function handleNavigate(href){
    if(!isDirty) { window.location.href = href; return; }
    showUnsavedModal();
  }

  function setupUnsavedHandlers(){
    // beforeunload native prompt
    window.addEventListener('beforeunload', function(e){ if(isDirty){ e.preventDefault(); e.returnValue = ''; return ''; } });

    // modal buttons
    const btnOk = el('unsaved-ok');
    if(btnOk) btnOk.addEventListener('click', function(){ hideUnsavedModal(); });

    const dashboardLink = el('dashboard-link');
    if(dashboardLink){
      dashboardLink.addEventListener('click', function(ev){
        const href = dashboardLink.getAttribute('href');
        if(!href || href.startsWith('#') || href.startsWith('javascript:')) return;
        ev.preventDefault();
        handleNavigate(href);
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    el('add-choice').addEventListener('click', function(e){ e.preventDefault(); state.editorChoices.push(createEmptyChoice()); renderChoicesEditor(); refreshDirtyState(); focusChoiceInput(state.editorChoices.length - 1); });
    el('set-two-choices').addEventListener('click', function(e){ e.preventDefault(); setChoiceCount(2); refreshDirtyState(); setStatus('選択肢を2件に整えました'); focusChoiceInput(0); });
    el('set-four-choices').addEventListener('click', function(e){ e.preventDefault(); setChoiceCount(4); refreshDirtyState(); setStatus('選択肢を4件に整えました'); focusChoiceInput(2); });
    el('add-question').addEventListener('click', function(e){ e.preventDefault(); addQuestionFromEditor(); });
    el('clear-editor').addEventListener('click', function(e){ e.preventDefault(); resetEditor(); refreshDirtyState(); setStatus('エディタをクリアしました'); });
    el('save-test').addEventListener('click', function(e){ e.preventDefault(); saveTest(); });
    el('question-text').addEventListener('keydown', function(e){ if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); addQuestionFromEditor(); } });
    el('question-text').addEventListener('input', refreshDirtyState);
    el('class-select').addEventListener('change', refreshDirtyState);

    // setup unsaved handlers
    setupUnsavedHandlers();

    // initialize editor and classes, and prefill from query params if provided
    resetEditor(); renderQuestionsList();
    (async function(){
      const classes = await loadClasses();
      // parse query params
      const params = new URLSearchParams(window.location.search);
      const presetName = params.get('name');
      const presetClass = params.get('class_id');
      const presetTestId = params.get('test_id');
      if(presetName){ el('test-name').value = decodeURIComponent(presetName); }
      if(presetClass){
        // ensure option exists and select it
        const sel = el('class-select');
        // if classes loaded include the id, select it
        const found = classes.find(c => String(c.id) === String(presetClass));
        if(found){ sel.value = found.id; }
      }
      if(presetTestId){
        editingTestId = presetTestId;
        try{
          // fetch test metadata
          const tr = await fetch('/api/tests');
          const allTests = await tr.json().catch(()=>[]);
          const test = (allTests || []).find(t => String(t.id) === String(presetTestId));
          if(test){
            editingTestMeta = {
              description: test.description || '',
              public: test.public ? 1 : 0,
              randomize: test.randomize ? 1 : 0
            };
            if(!presetName) el('test-name').value = test.name || '';
            if(!presetClass){ const sel = el('class-select'); sel.value = test.class_id || ''; }
          }
          // fetch questions
          const qr = await fetch('/api/tests/' + encodeURIComponent(presetTestId) + '/questions');
          const qjson = await qr.json().catch(()=>[]);
          // map to editor format (preserve ids)
          state.questions = (qjson || []).map(q => ({ id: q.id, text: q.text || '', choices: (q.choices || []).map(c => ({ id: c.id, text: c.text || '', is_correct: !!c.is_correct })), type: q.type || ( ((q.choices||[]).filter(c=>c.is_correct).length>1) ? 'multiple' : 'single' ), points: q.points || 1, explanation: q.explanation || '' }));
          renderQuestionsList();
          refreshDirtyState();
        }catch(e){ console.error(e); setStatus('テストの問題読み込みに失敗しました', true); }
      }
      markSavedState();
    })();

    // 自動作成フォームの表示切替（UIのみ）
    function updateCreateModeUI(){
      const checked = document.querySelector('input[name="create-mode"]:checked');
      const mode = checked ? checked.value : 'manual';
      const manual = el('manual-editor');
      const auto = el('auto-create-section');
      if(mode === 'auto'){
        if(manual) manual.style.display = 'none';
        if(auto) auto.style.display = 'block';
        const chip = el('editor-mode-chip'); if(chip) chip.textContent = '自動作成モード';
      } else {
        if(manual) manual.style.display = '';
        if(auto) auto.style.display = 'none';
        syncEditorMeta();
      }
    }

    document.querySelectorAll('input[name="create-mode"]').forEach(function(r){ r.addEventListener('change', updateCreateModeUI); });
    if(el('auto-choice-count')) el('auto-choice-count').addEventListener('change', syncAutoGenerationOptions);

    const autoBtn = el('auto-generate');
    if(autoBtn){
      autoBtn.addEventListener('click', async function(){
        const qcount = parseInt(el('auto-question-count').value, 10) || 0;
        if(qcount < 1 || qcount > 10){ setStatus('問題数は1〜10の間で指定してください', true); return; }
        const choiceCount = parseInt(el('auto-choice-count').value, 10) || 2;
        if(choiceCount < 2 || choiceCount > 4){ setStatus('選択数は2〜4の間で指定してください', true); return; }
        const desc = el('auto-class-description').value || '';
        if(!desc.trim()){ setStatus('授業内容を入力してください', true); return; }
        if(desc.length > 2000){ setStatus('授業内容は2000文字以内で入力してください', true); return; }
        autoBtn.disabled = true;
        setStatus('Geminiで問題を生成中です...');
        try{
          const response = await fetch('/api/generate-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lessonContent: desc,
              questionCount: qcount,
              difficulty: el('auto-difficulty').value,
              choiceCount: choiceCount,
              allowMultipleAnswers: !!(el('auto-allow-multiple') && el('auto-allow-multiple').checked)
            })
          });
          const payload = await response.json().catch(function(){ return null; });
          if(!response.ok){
            throw new Error(payload && payload.error ? payload.error : '生成に失敗しました');
          }
          const generatedQuestions = Array.isArray(payload && payload.questions) ? payload.questions : [];
          if(generatedQuestions.length === 0){
            throw new Error('問題が生成されませんでした');
          }
          const nextQuestions = generatedQuestions.map(mapGeneratedQuestion);
          state.questions = state.questions.concat(nextQuestions);
          renderQuestionsList();
          refreshDirtyState();
          const manualRadio = document.querySelector('input[name="create-mode"][value="manual"]');
          if(manualRadio) manualRadio.checked = true;
          updateCreateModeUI();
          setStatus(nextQuestions.length + '問を自動生成しました。必要に応じて編集してから保存してください。');
        }catch(err){
          console.error(err);
          setStatus(err.message || '自動生成に失敗しました', true);
        }finally{
          autoBtn.disabled = false;
        }
      });
    }

    const autoCancel = el('auto-cancel');
    if(autoCancel){
      autoCancel.addEventListener('click', function(){
        const manualRadio = document.querySelector('input[name="create-mode"][value="manual"]');
        if(manualRadio) manualRadio.checked = true;
        updateCreateModeUI();
      });
    }

    // 初期表示をラジオに合わせる
    syncAutoGenerationOptions();
    updateCreateModeUI();
  });

})();
