(function(){
  // helper to get element
  function el(id){ return document.getElementById(id); }
  function setStatus(msg, isError){ const s = el('status'); s.textContent = msg; s.style.color = isError ? '#900' : ''; }
  function createEmptyChoice(){ return { text: '', is_correct: false }; }
  function nextFrame(fn){ window.requestAnimationFrame(fn); }

  const state = { questions: [], editingIndex: -1, editorChoices: [], page: 0, selectedQuestionIndexes: new Set() };
  let pendingQuestionDeletion = null;
  let isDirty = false;
  let lastSavedClassId = '';
  let lastSavedQuestions = [];
  let editingTestId = null;
  let editingTestMeta = { description: '', public: 0, randomize: 0, answer_mode: 'deferred_summary' };
  const persistedDeletedQuestionIds = new Set();
  const MAX_QUESTIONS = 100;
  const MIN_CHOICES = 2;
  const PAGE_SIZE = 5;
  const MAX_QUESTION_HTML_LENGTH = 100 * 1024;
  const ALLOWED_RICH_TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'IMG']);

  function getQuestionEditor(){
    return el('question-text');
  }

  function escapeHtml(value){
    return String(value || '').replace(/[&<>"']/g, function(ch){
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function normalizeRichTagName(tagName){
    if(tagName === 'B') return 'STRONG';
    if(tagName === 'I') return 'EM';
    return tagName;
  }

  function isInternalImageUrl(value){
    return /^\/uploads\/question-images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|gif)$/i.test(String(value || '').trim());
  }

  function sanitizeRichHtml(html){
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    function cleanNode(node){
      if(node.nodeType === Node.TEXT_NODE){
        return document.createTextNode(node.textContent || '');
      }
      if(node.nodeType !== Node.ELEMENT_NODE){
        return document.createTextNode('');
      }
      const tagName = normalizeRichTagName(node.tagName);
      if(!ALLOWED_RICH_TAGS.has(node.tagName)){
        const fragment = document.createDocumentFragment();
        Array.prototype.slice.call(node.childNodes).forEach(function(child){
          fragment.appendChild(cleanNode(child));
        });
        return fragment;
      }
      const clean = document.createElement(tagName.toLowerCase());
      if(tagName === 'A'){
        const href = String(node.getAttribute('href') || '').trim();
        if(/^(https?:\/\/|mailto:)/i.test(href)){
          clean.setAttribute('href', href);
          if(/^https?:\/\//i.test(href)){
            clean.setAttribute('target', '_blank');
            clean.setAttribute('rel', 'noopener noreferrer');
          }
        }
      }
      if(tagName === 'IMG'){
        const src = String(node.getAttribute('src') || '').trim();
        if(!isInternalImageUrl(src)) return document.createTextNode('');
        clean.setAttribute('src', src);
        clean.setAttribute('alt', String(node.getAttribute('alt') || '').slice(0, 200));
        clean.setAttribute('title', String(node.getAttribute('title') || '').slice(0, 200));
      }
      Array.prototype.slice.call(node.childNodes).forEach(function(child){
        clean.appendChild(cleanNode(child));
      });
      return clean;
    }
    const out = document.createElement('div');
    Array.prototype.slice.call(template.content.childNodes).forEach(function(child){
      out.appendChild(cleanNode(child));
    });
    return out.innerHTML.trim();
  }

  function getQuestionHtml(){
    const editor = getQuestionEditor();
    return sanitizeRichHtml(editor ? editor.innerHTML : '');
  }

  function getQuestionPlainText(){
    const editor = getQuestionEditor();
    return String(editor ? editor.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function setQuestionHtml(html, fallbackText){
    const editor = getQuestionEditor();
    if(!editor) return;
    const safeHtml = sanitizeRichHtml(html || '');
    editor.innerHTML = safeHtml || (fallbackText ? escapeHtml(fallbackText) : '');
    updateQuestionPreview();
  }

  function updateQuestionPreview(){
    const preview = el('question-preview');
    if(!preview) return;
    const html = getQuestionHtml();
    const text = getQuestionPlainText();
    preview.innerHTML = html || (text ? escapeHtml(text) : '<span class="rich-preview-placeholder">問題文のプレビュー</span>');
  }

  function questionPayloadFields(question){
    const html = String((question && question.content_html) || '').trim();
    const text = String((question && question.text) || '').trim();
    return {
      text: text,
      content_html: html,
      content_format: html ? 'html' : 'plain'
    };
  }

  function buildQuestionRequestPayload(question){
    const content = questionPayloadFields(question);
    return {
      text: content.text,
      content_html: content.content_html,
      content_format: content.content_format,
      type: question.type || 'single',
      points: question.points || 1,
      choices: question.choices,
      explanation: question.explanation || ''
    };
  }

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
      content_html: sanitizeRichHtml((question && question.content_html) || ''),
      content_format: question && question.content_html ? 'html' : 'plain',
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
    const explanationField = el('question-explanation');
    const draft = {
      text: getQuestionPlainText(),
      content_html: getQuestionHtml(),
      explanation: String(explanationField ? explanationField.value : '').trim(),
      choices: state.editorChoices.map(normalizeChoice).filter(function(choice){
        return choice.text || choice.is_correct;
      })
    };

    if(state.editingIndex >= 0){
      const source = state.questions[state.editingIndex];
      const original = {
        text: String((source && source.text) || '').trim(),
        content_html: sanitizeRichHtml((source && source.content_html) || ''),
        explanation: String((source && source.explanation) || '').trim(),
        choices: ((source && source.choices) || []).map(normalizeChoice).filter(function(choice){
          return choice.text || choice.is_correct;
        })
      };
      return JSON.stringify(draft) !== JSON.stringify(original);
    }

    return draft.text !== '' || draft.content_html !== '' || draft.explanation !== '' || draft.choices.length > 0;
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
    // update add/update button label based on editing state
    const addBtn = el('add-question');
    if(addBtn) addBtn.textContent = state.editingIndex >= 0 ? '問題を更新' : '問題を追加';
  }

  function setEditorTitle(text){
    const title = el('editor-title');
    if(title) title.textContent = text;
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
      content_html: '',
      content_format: 'plain',
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
    setQuestionHtml('');
    el('question-explanation').value = '';
    state.editorChoices = [ createEmptyChoice(), createEmptyChoice() ];
    state.editingIndex = -1;
    setEditorTitle('問題を作成');
    renderChoicesEditor();
    if(config.focusQuestion !== false) focusQuestionField();
  }

  function goToPage(p){
    const pageCount = Math.max(1, Math.ceil((state.questions || []).length / PAGE_SIZE));
    state.page = Math.max(0, Math.min(p, pageCount - 1));
    renderQuestionsList();
  }

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

  function switchToManualMode(){
    const manualRadio = document.querySelector('input[name="create-mode"][value="manual"]');
    if(manualRadio) manualRadio.checked = true;
    updateCreateModeUI();
  }

  function pruneSelectedQuestionIndexes(){
    state.selectedQuestionIndexes.forEach(function(index){
      if(index < 0 || index >= state.questions.length){
        state.selectedQuestionIndexes.delete(index);
      }
    });
  }

  function renderQuestionsList(){
    const container = el('questions-list'); container.innerHTML = '';
    syncEditorMeta();
    if(!state.questions || state.questions.length === 0){
      state.selectedQuestionIndexes.clear();
      container.textContent = '問題はまだありません';
      return;
    }
    pruneSelectedQuestionIndexes();

    const pageCount = Math.max(1, Math.ceil(state.questions.length / PAGE_SIZE));
    if(state.page >= pageCount) state.page = Math.max(0, pageCount - 1);
    const start = state.page * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, state.questions.length);
    const selectedCount = state.selectedQuestionIndexes.size;

    const bulkActions = document.createElement('div');
    bulkActions.className = 'task-inline-actions';
    bulkActions.style.justifyContent = 'space-between';
    bulkActions.style.marginBottom = '10px';
    const selectionLabel = document.createElement('span');
    selectionLabel.className = 'task-helper-text';
    selectionLabel.textContent = selectedCount ? (selectedCount + '件選択中') : '削除する問題を選択できます';
    const bulkButtons = document.createElement('div');
    bulkButtons.className = 'task-inline-actions';
    const btnDeleteSelected = document.createElement('button');
    btnDeleteSelected.className = 'btn btn-small btn-ghost';
    btnDeleteSelected.type = 'button';
    btnDeleteSelected.textContent = '選択した問題を削除';
    btnDeleteSelected.disabled = selectedCount === 0;
    btnDeleteSelected.addEventListener('click', deleteSelectedQuestions);
    const btnDeleteAll = document.createElement('button');
    btnDeleteAll.className = 'btn btn-small btn-ghost';
    btnDeleteAll.type = 'button';
    btnDeleteAll.textContent = 'すべて削除';
    btnDeleteAll.addEventListener('click', deleteAllQuestions);
    bulkButtons.appendChild(btnDeleteSelected);
    bulkButtons.appendChild(btnDeleteAll);
    bulkActions.appendChild(selectionLabel);
    bulkActions.appendChild(bulkButtons);
    container.appendChild(bulkActions);

    const ol = document.createElement('ol');
    for(let i = start; i < end; i++){
      const q = state.questions[i];
      const idx = i; // global index in state.questions
      const li = document.createElement('li');
      const selectLabel = document.createElement('label');
      selectLabel.className = 'task-toggle compact';
      selectLabel.style.width = 'fit-content';
      const selectInput = document.createElement('input');
      selectInput.type = 'checkbox';
      selectInput.checked = state.selectedQuestionIndexes.has(idx);
      selectInput.setAttribute('aria-label', '問題 ' + (idx + 1) + ' を選択');
      selectInput.addEventListener('change', function(){
        if(selectInput.checked){
          state.selectedQuestionIndexes.add(idx);
        } else {
          state.selectedQuestionIndexes.delete(idx);
        }
        renderQuestionsList();
      });
      selectLabel.appendChild(selectInput);
      selectLabel.appendChild(document.createTextNode(' 選択'));
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
      li.appendChild(selectLabel); li.appendChild(qdiv); li.appendChild(meta); li.appendChild(actions); ol.appendChild(li);
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
    const nextSelected = new Set();
    state.selectedQuestionIndexes.forEach(function(selectedIndex){
      if(selectedIndex < index){
        nextSelected.add(selectedIndex);
      } else if(selectedIndex > index){
        nextSelected.add(selectedIndex - 1);
      }
    });
    state.selectedQuestionIndexes = nextSelected;
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

  async function deleteQuestionsByIndexes(indexes, message){
    const targets = Array.from(new Set(indexes))
      .filter(function(index){ return index >= 0 && index < state.questions.length; })
      .sort(function(a, b){ return b - a; });
    if(targets.length === 0) return;

    setStatus('問題を削除しています...');
    for(const index of targets){
      const question = state.questions[index];
      if(editingTestId && question && question.id){
        await requestJson('/api/questions/' + encodeURIComponent(question.id), { method: 'DELETE' }, '問題の削除に失敗しました');
        persistedDeletedQuestionIds.add(question.id);
      }
      removeQuestionAtIndex(index);
    }
    renderQuestionsList();
    refreshDirtyState();
    setStatus(message || (targets.length + '件の問題を削除しました'));
  }

  function showDeleteQuestionsModal(config){
    const indexes = Array.from(new Set((config && config.indexes) || []))
      .filter(function(index){ return index >= 0 && index < state.questions.length; });
    if(indexes.length === 0) return;
    pendingQuestionDeletion = {
      indexes: indexes,
      successMessage: config && config.successMessage ? config.successMessage : (indexes.length + '件の問題を削除しました')
    };
    const modal = el('delete-questions-modal');
    const title = el('delete-questions-title');
    const message = el('delete-questions-message');
    const confirmButton = el('delete-questions-confirm');
    if(title) title.textContent = config && config.title ? config.title : '問題を削除しますか？';
    if(message) message.textContent = config && config.message ? config.message : '削除すると元に戻せません。';
    if(confirmButton){
      confirmButton.disabled = false;
      confirmButton.textContent = '削除する';
    }
    if(modal) modal.style.display = 'flex';
  }

  function hideDeleteQuestionsModal(){
    const modal = el('delete-questions-modal');
    if(modal) modal.style.display = 'none';
    pendingQuestionDeletion = null;
    const confirmButton = el('delete-questions-confirm');
    if(confirmButton){
      confirmButton.disabled = false;
      confirmButton.textContent = '削除する';
    }
  }

  async function confirmPendingQuestionDeletion(){
    if(!pendingQuestionDeletion) return;
    const deletion = pendingQuestionDeletion;
    const confirmButton = el('delete-questions-confirm');
    if(confirmButton){
      confirmButton.disabled = true;
      confirmButton.textContent = '削除中...';
    }
    try{
      await deleteQuestionsByIndexes(deletion.indexes, deletion.successMessage);
      hideDeleteQuestionsModal();
    }catch(error){
      console.error(error);
      hideDeleteQuestionsModal();
      setStatus(error.message || '問題の削除に失敗しました', true);
    }
  }

  async function deleteQuestion(index){
    const question = state.questions[index];
    if(!question) return;

    showDeleteQuestionsModal({
      indexes: [index],
      title: 'この問題を削除しますか？',
      message: '削除すると元に戻せません。',
      successMessage: '問題を削除しました'
    });
  }

  async function deleteSelectedQuestions(){
    const indexes = Array.from(state.selectedQuestionIndexes);
    if(indexes.length === 0){
      setStatus('削除する問題を選択してください', true);
      return;
    }
    showDeleteQuestionsModal({
      indexes: indexes,
      title: '選択した問題を削除しますか？',
      message: indexes.length + '件の問題を削除します。削除すると元に戻せません。',
      successMessage: indexes.length + '件の問題を削除しました'
    });
  }

  async function deleteAllQuestions(){
    if(!state.questions.length){
      setStatus('削除する問題がありません', true);
      return;
    }
    const count = state.questions.length;
    showDeleteQuestionsModal({
      indexes: state.questions.map(function(_, index){ return index; }),
      title: 'すべての問題を削除しますか？',
      message: 'すべての問題（' + count + '件）を削除します。削除すると元に戻せません。',
      successMessage: count + '件すべての問題を削除しました'
    });
  }

  function duplicateQuestion(index){
    const src = state.questions[index]; if(!src) return;
    // deep clone the question structure but omit DB ids so it becomes a new local question
    const clone = {
      text: src.text || '',
      content_html: src.content_html || '',
      content_format: src.content_html ? 'html' : 'plain',
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
    switchToManualMode();
    setEditorTitle('問題を編集'); setQuestionHtml(q.content_html || '', q.text || '');
    el('question-explanation').value = q.explanation || '';
    state.editorChoices = (q.choices || []).map(c => ({ id: c.id, text: c.text || '', is_correct: !!c.is_correct }));
    state.editingIndex = index; renderChoicesEditor(); refreshDirtyState(); focusQuestionField();
  }

  function addQuestionFromEditor(){
    const contentHtml = getQuestionHtml();
    const text = getQuestionPlainText();
    if(contentHtml.length > MAX_QUESTION_HTML_LENGTH){ setStatus('問題文のHTMLが長すぎます', true); return; }
    if(!text && !contentHtml){ setStatus('問題文を入力してください', true); return; }
    const explanation = el('question-explanation').value.trim();
    if(state.editingIndex < 0 && state.questions.length >= MAX_QUESTIONS){ setStatus('問題は最大100問までです', true); return; }
    const choices = state.editorChoices.map(c=>({ id: c.id, text: (c.text||'').trim(), is_correct: !!c.is_correct })).filter(c=>c.text);
    if(choices.length < 2){ setStatus('選択肢を2つ以上用意してください', true); return; }
    const correctCount = choices.filter(c=>c.is_correct).length;
    if(correctCount === 0){ setStatus('少なくとも1つの選択肢を正解に設定してください', true); return; }
    const type = correctCount > 1 ? 'multiple' : 'single';
    const q = { text: text, content_html: contentHtml, content_format: contentHtml ? 'html' : 'plain', choices: choices, type: type, points: 1, explanation: explanation };
    if(state.editingIndex >= 0){
      // preserve id if editing existing question
      const orig = state.questions[state.editingIndex];
      if(orig && orig.id) q.id = orig.id;
      state.questions[state.editingIndex] = q; state.editingIndex = -1; setEditorTitle('問題を作成');
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
        await requestJson('/api/tests/' + encodeURIComponent(editingTestId), { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: name, description: editingTestMeta.description || '', public: editingTestMeta.public ? 1 : 0, randomize: editingTestMeta.randomize ? 1 : 0, answer_mode: editingTestMeta.answer_mode || 'deferred_summary', class_id: classId || null }) }, 'テスト更新に失敗しました');
        // process questions: update existing ones, create new ones
        for(const q of state.questions){
          if(q.id){
            // update question
            await requestJson('/api/questions/' + q.id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(buildQuestionRequestPayload(q)) }, '問題更新に失敗しました');
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
            await requestJson('/api/tests/' + editingTestId + '/questions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(buildQuestionRequestPayload(q)) }, '問題追加に失敗しました');
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
          await requestJson('/api/tests/' + testId + '/questions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(buildQuestionRequestPayload(q)) }, '問題追加に失敗しました');
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

  function setupDeleteQuestionsModal(){
    const modal = el('delete-questions-modal');
    const cancelButton = el('delete-questions-cancel');
    const confirmButton = el('delete-questions-confirm');
    if(cancelButton) cancelButton.addEventListener('click', hideDeleteQuestionsModal);
    if(confirmButton) confirmButton.addEventListener('click', function(){ confirmPendingQuestionDeletion(); });
    if(modal){
      modal.addEventListener('click', function(event){
        if(event.target === modal){
          hideDeleteQuestionsModal();
        }
      });
    }
    document.addEventListener('keydown', function(event){
      const isOpen = modal && modal.style.display !== 'none';
      if(isOpen && event.key === 'Escape'){
        hideDeleteQuestionsModal();
      }
    });
  }

  function focusEditor(){
    const editor = getQuestionEditor();
    if(editor) editor.focus();
  }

  function execRichCommand(command, value){
    focusEditor();
    document.execCommand(command, false, value || null);
    updateQuestionPreview();
    refreshDirtyState();
  }

  function insertHtmlAtSelection(html){
    focusEditor();
    document.execCommand('insertHTML', false, html);
    updateQuestionPreview();
    refreshDirtyState();
  }

  function insertInlineCode(){
    const selection = window.getSelection();
    const text = selection && selection.toString() ? selection.toString() : 'code';
    insertHtmlAtSelection('<code>' + escapeHtml(text) + '</code>');
  }

  function insertCodeBlock(){
    const code = window.prompt('コードを入力してください');
    if(code === null) return;
    insertHtmlAtSelection('<pre><code>' + escapeHtml(code) + '</code></pre><p><br></p>');
  }

  function insertLink(){
    const selection = window.getSelection();
    const label = selection && selection.toString() ? selection.toString() : '';
    const href = window.prompt('リンクURLを入力してください（http, https, mailto）');
    if(!href) return;
    if(!/^(https?:\/\/|mailto:)/i.test(href.trim())){
      setStatus('リンクURLは http, https, mailto のみ利用できます', true);
      return;
    }
    insertHtmlAtSelection('<a href="' + escapeHtml(href.trim()) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(label || href.trim()) + '</a>');
  }

  function insertImageUrl(url, alt){
    insertHtmlAtSelection('<p><img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt || '') + '"></p>');
  }

  async function uploadQuestionImageFile(file){
    if(!file) return;
    if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type || '')){
      setStatus('PNG、JPEG、WebP、GIF画像を選択してください', true);
      return;
    }
    const form = new FormData();
    form.append('image', file);
    setStatus('画像をアップロードしています...');
    try{
      const response = await fetch('/api/question-images', { method: 'POST', body: form });
      const payload = await response.json().catch(function(){ return null; });
      if(!response.ok || !payload || !payload.url){
        throw new Error((payload && payload.error) || '画像アップロードに失敗しました');
      }
      insertImageUrl(payload.url, file.name || '');
      setStatus('画像を追加しました');
    }catch(err){
      console.error(err);
      setStatus(err.message || '画像アップロードに失敗しました', true);
    }
  }

  function setupRichQuestionEditor(){
    const editor = getQuestionEditor();
    if(!editor) return;

    document.querySelectorAll('[data-rich-command]').forEach(function(button){
      button.addEventListener('click', function(){
        execRichCommand(button.getAttribute('data-rich-command'));
      });
    });
    const inlineCode = el('insert-inline-code');
    if(inlineCode) inlineCode.addEventListener('click', insertInlineCode);
    const codeBlock = el('insert-code-block');
    if(codeBlock) codeBlock.addEventListener('click', insertCodeBlock);
    const linkButton = el('insert-link');
    if(linkButton) linkButton.addEventListener('click', insertLink);
    const imageButton = el('insert-image');
    const imageFile = el('question-image-file');
    if(imageButton && imageFile) imageButton.addEventListener('click', function(){ imageFile.click(); });
    if(imageFile) imageFile.addEventListener('change', function(){
      const file = imageFile.files && imageFile.files[0];
      uploadQuestionImageFile(file).finally(function(){ imageFile.value = ''; });
    });
    const clearButton = el('clear-rich-format');
    if(clearButton) clearButton.addEventListener('click', function(){
      const text = getQuestionPlainText();
      setQuestionHtml(text ? '<p>' + escapeHtml(text) + '</p>' : '');
      refreshDirtyState();
    });

    editor.addEventListener('input', function(){
      updateQuestionPreview();
      refreshDirtyState();
    });
    editor.addEventListener('keydown', function(e){
      if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){
        e.preventDefault();
        addQuestionFromEditor();
      }
    });
    editor.addEventListener('paste', function(e){
      const items = e.clipboardData && e.clipboardData.items ? Array.prototype.slice.call(e.clipboardData.items) : [];
      const imageItem = items.find(function(item){ return item.type && item.type.indexOf('image/') === 0; });
      if(imageItem){
        e.preventDefault();
        uploadQuestionImageFile(imageItem.getAsFile());
        return;
      }
      const plain = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      if(plain){
        e.preventDefault();
        insertHtmlAtSelection(escapeHtml(plain).replace(/\n/g, '<br>'));
      }
    });
    editor.addEventListener('dragover', function(e){ e.preventDefault(); editor.classList.add('is-dragging'); });
    editor.addEventListener('dragleave', function(){ editor.classList.remove('is-dragging'); });
    editor.addEventListener('drop', function(e){
      editor.classList.remove('is-dragging');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if(file && file.type && file.type.indexOf('image/') === 0){
        e.preventDefault();
        uploadQuestionImageFile(file);
      }
    });
    updateQuestionPreview();
  }

  document.addEventListener('DOMContentLoaded', function(){
    el('add-choice').addEventListener('click', function(e){ e.preventDefault(); state.editorChoices.push(createEmptyChoice()); renderChoicesEditor(); refreshDirtyState(); focusChoiceInput(state.editorChoices.length - 1); });
    el('set-two-choices').addEventListener('click', function(e){ e.preventDefault(); setChoiceCount(2); refreshDirtyState(); setStatus('選択肢を2件に整えました'); focusChoiceInput(0); });
    el('set-four-choices').addEventListener('click', function(e){ e.preventDefault(); setChoiceCount(4); refreshDirtyState(); setStatus('選択肢を4件に整えました'); focusChoiceInput(2); });
    el('add-question').addEventListener('click', function(e){ e.preventDefault(); addQuestionFromEditor(); });
    el('clear-editor').addEventListener('click', function(e){ e.preventDefault(); resetEditor(); refreshDirtyState(); setStatus('エディタをクリアしました'); });
    el('save-test').addEventListener('click', function(e){ e.preventDefault(); saveTest(); });
    setupRichQuestionEditor();
    el('question-explanation').addEventListener('input', refreshDirtyState);
    el('class-select').addEventListener('change', refreshDirtyState);

    // setup unsaved handlers
    setupUnsavedHandlers();
    setupDeleteQuestionsModal();

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
              randomize: test.randomize ? 1 : 0,
              answer_mode: test.answer_mode === 'immediate_feedback' ? 'immediate_feedback' : 'deferred_summary'
            };
            if(!presetName) el('test-name').value = test.name || '';
            if(!presetClass){ const sel = el('class-select'); sel.value = test.class_id || ''; }
          }
          // fetch questions
          const qr = await fetch('/api/tests/' + encodeURIComponent(presetTestId) + '/questions');
          const qjson = await qr.json().catch(()=>[]);
          // map to editor format (preserve ids)
          state.questions = (qjson || []).map(q => ({ id: q.id, text: q.text || '', content_html: q.content_html || '', content_format: q.content_html ? 'html' : 'plain', choices: (q.choices || []).map(c => ({ id: c.id, text: c.text || '', is_correct: !!c.is_correct })), type: q.type || ( ((q.choices||[]).filter(c=>c.is_correct).length>1) ? 'multiple' : 'single' ), points: q.points || 1, explanation: q.explanation || '' }));
          renderQuestionsList();
          refreshDirtyState();
        }catch(e){ console.error(e); setStatus('テストの問題読み込みに失敗しました', true); }
      }
      markSavedState();
    })();

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
