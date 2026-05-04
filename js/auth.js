let _currentUser  = null;
let _sessionToken = null;
let _onSignIn     = null;

/* Llamado desde app.js una vez que el DOM está listo */
function initAuth(onSignInCallback) {
  _onSignIn = onSignInCallback;
  const stored = localStorage.getItem('rg_session');
  if (stored) {
    try {
      const { user, token } = JSON.parse(stored);
      _currentUser  = user;
      _sessionToken = token;
      if (_onSignIn) _onSignIn(_currentUser);
    } catch {
      localStorage.removeItem('rg_session');
    }
  }
}

/* Llamado desde handleLogin en app.js */
async function signIn(email, password) {
  const res = await callBackend('login', { email, password }, false);
  if (!res.success) throw new Error(res.error || 'Error al iniciar sesión');
  _currentUser  = res.user;
  _sessionToken = res.token;
  localStorage.setItem('rg_session', JSON.stringify({ user: res.user, token: res.token }));
  if (_onSignIn) _onSignIn(_currentUser);
}

function signOut() {
  _currentUser  = null;
  _sessionToken = null;
  localStorage.removeItem('rg_session');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  const emailEl = document.getElementById('login-email');
  const passEl  = document.getElementById('login-password');
  if (emailEl) emailEl.value = '';
  if (passEl)  passEl.value  = '';
}

function getCurrentUser()  { return _currentUser;  }
function getSessionToken() { return _sessionToken; }

/* Función central de comunicación con el Apps Script backend (JSONP) */
function callBackend(action, params = {}, requireAuth = true) {
  if (!CONFIG.APPS_SCRIPT_URL) {
    return Promise.reject(new Error('APPS_SCRIPT_URL no configurada en config.js'));
  }

  const body = { action, params };
  if (requireAuth) body.token = _sessionToken;

  return new Promise((resolve, reject) => {
    const cbName = '_rgcb' + Date.now();

    const cleanup = () => {
      delete window[cbName];
      const el = document.getElementById(cbName);
      if (el) el.remove();
    };

    window[cbName] = (data) => {
      cleanup();
      if (data.error) {
        if (requireAuth && data.error.includes('Sesión inválida')) signOut();
        reject(new Error(data.error));
      } else {
        resolve(data);
      }
    };

    const url = CONFIG.APPS_SCRIPT_URL
      + '?callback=' + cbName
      + '&d=' + encodeURIComponent(JSON.stringify(body));

    const script = document.createElement('script');
    script.id  = cbName;
    script.src = url;
    script.onerror = () => {
      cleanup();
      reject(new Error('No se pudo conectar con el servidor. Verifica tu conexión.'));
    };
    document.head.appendChild(script);
  });
}
