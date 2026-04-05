(function(){
  function $(id){ return document.getElementById(id); }

  var storageKey = 'instanttest_admin_password';
  var teacherItems = [];
  var dateFormatter = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  function getAdminPassword(){
    return (localStorage.getItem(storageKey) || '').trim();
  }

  function setAdminPassword(pw){
    localStorage.setItem(storageKey, pw || '');
  }

  function clearAdminPassword(){
    localStorage.removeItem(storageKey);
  }

  function apiFetch(url, options){
    var opts = options || {};
    opts.headers = opts.headers || {};
    var adminPw = getAdminPassword();
    if(adminPw){
      opts.headers['X-Admin-Password'] = adminPw;
    }
    return fetch(url, opts).then(function(r){
      return r.text().then(function(text){
        var body = {};
        if(text){
          try{
            body = JSON.parse(text);
          }catch(_err){
            body = { raw: text };
          }
        }
        return { ok: r.ok, status: r.status, body: body };
      });
    });
  }

  function showMessage(id, text, isError){
    var el = $(id);
    if(!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#900' : '';
  }

  function showAuthMessage(text, isError){
    showMessage('admin-auth-message', text, isError);
  }

  function showCreateMessage(text, isError){
    showMessage('teacher-create-message', text, isError);
  }

  function showListMessage(text, isError){
    showMessage('teacher-list-message', text, isError);
  }

  function formatDate(value){
    if(!value) return '未記録';
    var time = Date.parse(value);
    if(Number.isNaN(time)) return String(value);
    return dateFormatter.format(new Date(time));
  }

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, function(ch){
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] || ch;
    });
  }

  function getSummary(item){
    var summary = item && item.summary ? item.summary : {};
    return {
      classes: Number(summary.classes) || 0,
      tests: Number(summary.tests) || 0,
      questions: Number(summary.questions) || 0,
      students: Number(summary.students) || 0,
      studentAnswers: Number(summary.student_answers) || 0,
      examSessions: Number(summary.exam_sessions) || 0,
      teacherSessions: Number(summary.teacher_sessions) || 0
    };
  }

  function renderTeacherSummary(items){
    var host = $('teacher-list-summary');
    if(!host) return;
    var teacherCount = items.length;
    var testCount = 0;
    var studentCount = 0;
    items.forEach(function(item){
      var summary = getSummary(item);
      testCount += summary.tests;
      studentCount += summary.students;
    });
    host.innerHTML = ''
      + '<span class="admin-pill">教師 ' + teacherCount + '人</span>'
      + '<span class="admin-pill">テスト ' + testCount + '件</span>'
      + '<span class="admin-pill">生徒 ' + studentCount + '人</span>';
  }

  function renderTeacherList(items){
    var host = $('teacher-list');
    if(!host) return;

    renderTeacherSummary(items || []);

    if(!items || items.length === 0){
      host.innerHTML = '<div class="admin-empty">教師ユーザーはまだ登録されていません。</div>';
      return;
    }

    var html = '';
    items.forEach(function(item){
      var summary = getSummary(item);
      var displayName = item.display_name ? '表示名: ' + escapeHtml(item.display_name) : '表示名は未設定';
      html += ''
        + '<article class="teacher-card" data-user-id="' + item.id + '">'
        + '  <div class="teacher-card-head">'
        + '    <div class="teacher-card-title">'
        + '      <strong>' + escapeHtml(item.username) + '</strong>'
        + '      <span>' + displayName + '</span>'
        + '      <span>作成日時: ' + escapeHtml(formatDate(item.created_at)) + '</span>'
        + '    </div>'
        + '    <button class="btn btn-small btn-danger" data-action="delete" data-id="' + item.id + '" type="button">この教師を完全削除</button>'
        + '  </div>'
        + '  <div class="teacher-card-meta">'
        + '    <div class="teacher-metric"><strong>' + summary.classes + '</strong><span>クラス</span></div>'
        + '    <div class="teacher-metric"><strong>' + summary.tests + '</strong><span>テスト</span></div>'
        + '    <div class="teacher-metric"><strong>' + summary.questions + '</strong><span>問題</span></div>'
        + '    <div class="teacher-metric"><strong>' + summary.students + '</strong><span>生徒</span></div>'
        + '    <div class="teacher-metric"><strong>' + summary.studentAnswers + '</strong><span>回答</span></div>'
        + '    <div class="teacher-metric"><strong>' + summary.examSessions + '</strong><span>受験記録</span></div>'
        + '  </div>'
        + '  <div class="teacher-card-foot">'
        + '    <p>削除時にはログインセッション ' + summary.teacherSessions + ' 件も同時に消去します。</p>'
        + '  </div>'
        + '</article>';
    });

    host.innerHTML = '<div class="teacher-list-grid">' + html + '</div>';

    host.querySelectorAll('button[data-action="delete"]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-id');
        var item = teacherItems.find(function(entry){ return String(entry.id) === String(id); });
        if(!item) return;

        var summary = getSummary(item);
        var targetName = item.display_name || item.username;
        var confirmLines = [
          '教師ユーザー「' + targetName + '」を完全削除します。',
          '',
          '削除されるデータ',
          'クラス: ' + summary.classes + '件',
          'テスト: ' + summary.tests + '件',
          '問題: ' + summary.questions + '件',
          '生徒: ' + summary.students + '件',
          '回答: ' + summary.studentAnswers + '件',
          '受験記録: ' + summary.examSessions + '件',
          'ログインセッション: ' + summary.teacherSessions + '件',
          '',
          'この操作は取り消せません。'
        ];
        if(!confirm(confirmLines.join('\n'))) return;

        btn.disabled = true;
        showListMessage('削除しています…');
        apiFetch('/api/admin/teachers/' + encodeURIComponent(id), {
          method: 'DELETE'
        }).then(function(r){
          if(!r.ok){
            btn.disabled = false;
            showListMessage('削除に失敗しました: ' + (((r.body && r.body.error) || r.status)), true);
            return;
          }
          var deletedSummary = r.body && r.body.deleted_summary ? r.body.deleted_summary : {};
          showListMessage(
            '削除しました: ' + targetName
            + ' / クラス ' + (deletedSummary.classes || 0) + '件'
            + ' / テスト ' + (deletedSummary.tests || 0) + '件'
            + ' / 生徒 ' + (deletedSummary.students || 0) + '件'
          );
          loadTeachers(true);
        }).catch(function(){
          btn.disabled = false;
          showListMessage('通信に失敗しました', true);
        });
      });
    });
  }

  function setManagementEnabled(enabled){
    var createForm = $('teacher-create-form');
    if(createForm){
      Array.prototype.forEach.call(createForm.elements, function(el){
        if(el) el.disabled = !enabled;
      });
    }

    var list = $('teacher-list');
    if(list && !enabled){
      list.innerHTML = '<div class="admin-empty">認証すると教師ユーザー一覧が表示されます。</div>';
      renderTeacherSummary([]);
    }
  }

  function loadTeachers(keepMessage){
    if(!keepMessage) showListMessage('一覧を読み込んでいます…');
    showCreateMessage('');
    apiFetch('/api/admin/teachers').then(function(r){
      if(!r.ok){
        var msg = (r.body && r.body.error) || '取得に失敗しました';
        teacherItems = [];
        setManagementEnabled(false);
        showAuthMessage('認証に失敗しました: ' + msg, true);
        showListMessage('教師一覧を表示できません。', true);
        return;
      }
      teacherItems = Array.isArray(r.body) ? r.body : [];
      setManagementEnabled(true);
      showAuthMessage('認証済みです。');
      if(!keepMessage) showListMessage('教師ユーザー ' + teacherItems.length + ' 人を表示しています。');
      renderTeacherList(teacherItems);
    }).catch(function(){
      teacherItems = [];
      setManagementEnabled(false);
      showAuthMessage('通信に失敗しました。サーバー起動を確認してください。', true);
      showListMessage('教師一覧を表示できません。', true);
    });
  }

  var pwInput = $('admin-password');
  if(pwInput){
    pwInput.value = getAdminPassword();
  }

  var authForm = $('admin-auth-form');
  if(authForm){
    authForm.addEventListener('submit', function(ev){
      ev.preventDefault();
      var pw = (pwInput && pwInput.value || '').trim();
      if(!pw){
        showAuthMessage('管理者パスワードを入力してください', true);
        return;
      }
      setAdminPassword(pw);
      showAuthMessage('認証を確認しています…');
      loadTeachers(false);
    });
  }

  var clearBtn = $('admin-clear');
  if(clearBtn){
    clearBtn.addEventListener('click', function(){
      clearAdminPassword();
      teacherItems = [];
      if(pwInput) pwInput.value = '';
      setManagementEnabled(false);
      showAuthMessage('保存済みパスワードを削除しました。');
      showCreateMessage('');
      showListMessage('');
    });
  }

  var createForm = $('teacher-create-form');
  if(createForm){
    createForm.addEventListener('submit', function(ev){
      ev.preventDefault();
      var username = ($('teacher-username') && $('teacher-username').value || '').trim();
      var displayName = ($('teacher-display-name') && $('teacher-display-name').value || '').trim();
      var password = ($('teacher-password') && $('teacher-password').value || '').trim();
      if(!username || !password){
        showCreateMessage('ユーザー名と初期パスワードは必須です。', true);
        return;
      }

      showCreateMessage('追加しています…');
      apiFetch('/api/admin/teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, display_name: displayName, password: password })
      }).then(function(r){
        if(!r.ok){
          var msg = (r.body && r.body.error) || r.status;
          showCreateMessage('追加に失敗しました: ' + msg, true);
          return;
        }
        showCreateMessage('教師ユーザーを追加しました。');
        if($('teacher-username')) $('teacher-username').value = '';
        if($('teacher-display-name')) $('teacher-display-name').value = '';
        if($('teacher-password')) $('teacher-password').value = '';
        loadTeachers(true);
      }).catch(function(){
        showCreateMessage('通信に失敗しました', true);
      });
    });
  }

  setManagementEnabled(!!getAdminPassword());
  if(getAdminPassword()){
    showAuthMessage('保存済みパスワードで認証しています…');
    loadTeachers(false);
  }
})();
