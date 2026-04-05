(function(){
  function $(id){ return document.getElementById(id); }

  function getNextPath(){
    try{
      var params = new URLSearchParams(window.location.search || '');
      var next = (params.get('next') || '').trim();
      if(!next) return '/app.html';
      // allow only same-origin relative paths
      if(next.startsWith('/') && !next.startsWith('//')) return next;
      return '/app.html';
    }catch(e){
      return '/app.html';
    }
  }

  function showMessage(text, isError){
    var el = $('login-message');
    if(!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#900' : '';
  }

  var form = $('login-form');
  if(!form) return;

  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    showMessage('ログインしています…');

    var username = ($('username') && $('username').value || '').trim();
    var password = ($('password') && $('password').value || '');

    fetch('/api/teacher/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    }).then(function(r){
      return r.json().then(function(body){
        return { ok: r.ok, status: r.status, body: body };
      });
    }).then(function(result){
      if(!result.ok){
        var msg = (result.body && (result.body.error || result.body.message)) || 'ログインに失敗しました';
        showMessage('ログインに失敗しました: ' + msg, true);
        return;
      }
      showMessage('ログイン成功。移動します…');
      window.location.href = getNextPath();
    }).catch(function(){
      showMessage('通信に失敗しました。サーバー起動を確認してください。', true);
    });
  });

  // If already logged in, skip
  fetch('/api/teacher/me').then(function(r){
    if(r.ok){
      window.location.replace(getNextPath());
    }
  }).catch(function(){});
})();
