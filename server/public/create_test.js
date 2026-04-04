(function(){
  // helper to get element
  function el(id){ return document.getElementById(id); }
  function setStatus(msg, isError){ const s = el('status'); s.textContent = msg; s.style.color = isError ? '#900' : ''; }
  function createEmptyChoice(){ return { text: '', is_correct: false }; }
  function nextFrame(fn){ window.requestAnimationFrame(fn); }

  const state = { questions: [], editingIndex: -1, editorChoices: [] };
  let isDirty = false;
  let pendingNavigation = null; // {href}
  let editingTestId = null;
  const MAX_QUESTIONS = 100;
  const MIN_CHOICES = 2;

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
      input.addEventListener('input', function(e){ state.editorChoices[idx].text = e.target.value; });
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
      chk.addEventListener('change', function(){ state.editorChoices[idx].is_correct = chk.checked; renderChoicesEditor(); isDirty = true; });
      const label = document.createElement('label'); label.className = 'task-toggle compact'; label.appendChild(chk); label.appendChild(document.createTextNode(' 正解'));
      const del = document.createElement('button'); del.className = 'btn btn-small btn-ghost'; del.type = 'button'; del.textContent = '削除';
      del.disabled = state.editorChoices.length <= MIN_CHOICES;
      del.addEventListener('click', function(){ state.editorChoices.splice(idx,1); renderChoicesEditor(); isDirty = true; });
      row.appendChild(indexBadge); row.appendChild(input); row.appendChild(label); row.appendChild(del);
      list.appendChild(row);
    });
  }

  function resetEditor(options){
    const config = options || {};
    el('question-text').value = '';
    state.editorChoices = [ createEmptyChoice(), createEmptyChoice() ];
    state.editingIndex = -1;
    el('editor-title').textContent = '新しい問題を作成';
    renderChoicesEditor();
    if(config.focusQuestion !== false) focusQuestionField();
  }

  function renderQuestionsList(){
    const container = el('questions-list'); container.innerHTML = '';
    syncEditorMeta();
    isDirty = true;
    if(!state.questions || state.questions.length === 0){ container.textContent = '（問題がありません）'; return; }
    const ol = document.createElement('ol');
    state.questions.forEach((q, idx) => {
      const li = document.createElement('li');
      const qdiv = document.createElement('div'); qdiv.className = 'question-list-card__title'; qdiv.appendChild(document.createTextNode(q.text));
      const meta = document.createElement('div'); meta.className = 'task-helper-text'; meta.appendChild(document.createTextNode('選択肢: ' + (q.choices ? q.choices.length : 0) + ' / ' + ((q.type || 'single') === 'multiple' ? '複数正解' : '単一正解')));
      const btnEdit = document.createElement('button'); btnEdit.className='btn btn-small btn-primary'; btnEdit.type='button'; btnEdit.textContent='編集'; btnEdit.addEventListener('click', function(){ editQuestion(idx); });
      const btnDel = document.createElement('button'); btnDel.className='btn btn-small btn-ghost'; btnDel.type='button'; btnDel.textContent='削除'; btnDel.addEventListener('click', function(){ if(!confirm('削除しますか？')) return; state.questions.splice(idx,1); renderQuestionsList(); });
      const btnDup = document.createElement('button'); btnDup.className='btn btn-small btn-secondary'; btnDup.type='button'; btnDup.textContent='複製'; btnDup.title = 'この問題を複製して次に追加';
      btnDup.addEventListener('click', function(){ duplicateQuestion(idx); });
      const actions = document.createElement('div'); actions.className = 'task-inline-actions';
      actions.appendChild(btnEdit); actions.appendChild(btnDup); actions.appendChild(btnDel);
      li.appendChild(qdiv); li.appendChild(meta); li.appendChild(actions); ol.appendChild(li);
    });
    container.appendChild(ol);
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
    renderQuestionsList();
    // open editor for the newly inserted question
    editQuestion(index + 1);
    setStatus('問題を複製しました。編集モードになっています。');
  }

  function editQuestion(index){
    const q = state.questions[index]; if(!q) return;
    el('editor-title').textContent = '問題を編集'; el('question-text').value = q.text || '';
    state.editorChoices = (q.choices || []).map(c => ({ id: c.id, text: c.text || '', is_correct: !!c.is_correct }));
    state.editingIndex = index; renderChoicesEditor(); focusQuestionField();
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
      state.questions[state.editingIndex] = q; state.editingIndex = -1; el('editor-title').textContent = '新しい問題を作成';
    }
    else { state.questions.push(q); }
      renderQuestionsList(); resetEditor(); setStatus('問題を追加しました。続けて入力できます。');
      isDirty = true;
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
        const updRes = await fetch('/api/tests/' + encodeURIComponent(editingTestId), { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: name, description: '', public: 0, randomize: 0, class_id: classId || null }) });
        const updated = await updRes.json().catch(()=>null);
        // process questions: update existing ones, create new ones
        for(const q of state.questions){
          if(q.id){
            // update question
            await fetch('/api/questions/' + q.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: q.text, type: q.type || 'single', points: q.points || 1, explanation: q.explanation || '' }) });
            // process choices
            for(const c of q.choices || []){
              if(c.id){
                await fetch('/api/choices/' + c.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: c.text, is_correct: c.is_correct?1:0 }) });
              } else {
                await fetch('/api/questions/' + q.id + '/choices', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: c.text, is_correct: c.is_correct?1:0 }) });
              }
            }
          } else {
            // new question
            await fetch('/api/tests/' + editingTestId + '/questions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: q.text, type: q.type || 'single', points: q.points || 1, choices: q.choices }) });
          }
        }
        setStatus('テストを更新しました');
        setTimeout(function(){ window.location.href = '/'; }, 1500);
      } else {
        // create new test
        const res = await fetch('/api/tests', { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ class_id: classId || null, name: name, public: 0, randomize: 0 }) });
        const j = await res.json(); if(!j || !j.id){ setStatus('テスト作成に失敗しました', true); btn.disabled=false; return; }
        const testId = j.id;
        for(const q of state.questions){
          await fetch('/api/tests/' + testId + '/questions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: q.text, type: q.type || 'single', points: q.points || 1, choices: q.choices }) });
        }
        setStatus('テストを作成しました（ID: ' + testId + '）。2秒後にメインに戻ります。');
        isDirty = false;
        setTimeout(function(){ window.location.href = '/'; }, 2000);
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
    pendingNavigation = href; showUnsavedModal();
  }

  function setupUnsavedHandlers(){
    // beforeunload native prompt
    window.addEventListener('beforeunload', function(e){ if(isDirty){ e.preventDefault(); e.returnValue = ''; return ''; } });

    // modal buttons
    const btnSave = el('unsaved-save'); const btnDiscard = el('unsaved-discard'); const btnCancel = el('unsaved-cancel');
    if(btnSave) btnSave.addEventListener('click', async function(){ hideUnsavedModal(); if(pendingNavigation){ await saveTest(); const h = pendingNavigation; pendingNavigation = null; window.location.href = h; } else { await saveTest(); } });
    if(btnDiscard) btnDiscard.addEventListener('click', function(){ hideUnsavedModal(); const h = pendingNavigation; pendingNavigation = null; isDirty = false; if(h) window.location.href = h; });
    if(btnCancel) btnCancel.addEventListener('click', function(){ hideUnsavedModal(); pendingNavigation = null; });

    // intercept internal links in header/actions
    document.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', function(ev){ const href = a.getAttribute('href'); if(!href || href.startsWith('#') || href.startsWith('javascript:')) return; ev.preventDefault(); handleNavigate(href); });
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    el('add-choice').addEventListener('click', function(e){ e.preventDefault(); state.editorChoices.push(createEmptyChoice()); renderChoicesEditor(); focusChoiceInput(state.editorChoices.length - 1); });
    el('set-two-choices').addEventListener('click', function(e){ e.preventDefault(); setChoiceCount(2); setStatus('選択肢を2件に整えました'); focusChoiceInput(0); });
    el('set-four-choices').addEventListener('click', function(e){ e.preventDefault(); setChoiceCount(4); setStatus('選択肢を4件に整えました'); focusChoiceInput(2); });
    el('add-question').addEventListener('click', function(e){ e.preventDefault(); addQuestionFromEditor(); });
    el('clear-editor').addEventListener('click', function(e){ e.preventDefault(); resetEditor(); setStatus('エディタをクリアしました'); });
    el('save-test').addEventListener('click', function(e){ e.preventDefault(); saveTest(); });
    el('question-text').addEventListener('keydown', function(e){ if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){ e.preventDefault(); addQuestionFromEditor(); } });
    el('question-text').addEventListener('input', function(){ isDirty = true; });

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
          if(test){ if(!presetName) el('test-name').value = test.name || ''; if(!presetClass){ const sel = el('class-select'); sel.value = test.class_id || ''; } }
          // fetch questions
          const qr = await fetch('/api/tests/' + encodeURIComponent(presetTestId) + '/questions');
          const qjson = await qr.json().catch(()=>[]);
          // map to editor format (preserve ids)
          state.questions = (qjson || []).map(q => ({ id: q.id, text: q.text || '', choices: (q.choices || []).map(c => ({ id: c.id, text: c.text || '', is_correct: !!c.is_correct })), type: q.type || ( ((q.choices||[]).filter(c=>c.is_correct).length>1) ? 'multiple' : 'single' ), points: q.points || 1, explanation: q.explanation || '' }));
          renderQuestionsList();
        }catch(e){ console.error(e); setStatus('テストの問題読み込みに失敗しました', true); }
      }
    })();
  });

})();
