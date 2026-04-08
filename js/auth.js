let _tokenClient  = null;
let _accessToken  = null;
let _currentUser  = null;
let _onSignIn     = null;
let _tokenHandled = false; // evita callback doble de GIS

/* Llamado desde app.js una vez que el DOM está listo */
function initAuth(onSignInCallback) {
  _onSignIn = onSignInCallback;
}

/* El usuario hace clic en "Iniciar sesión con Google" */
function signIn() {
  if (typeof google === 'undefined') {
    toast('Cargando Google Sign-In, intenta de nuevo...', 'info');
    setTimeout(signIn, 800);
    return;
  }
  if (!_tokenClient) {
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope:     CONFIG.SCOPES,
      callback:  _handleToken
    });
  }
  _tokenClient.requestAccessToken({ prompt: '' });
}

async function _handleToken(resp) {
  if (resp.error) { toast('Error de autenticación: ' + resp.error, 'error'); return; }
  if (_tokenHandled) return; // ignorar callback duplicado
  _tokenHandled = true;
  _accessToken = resp.access_token;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + _accessToken }
  });
  _currentUser = await res.json();
  if (_onSignIn) _onSignIn(_currentUser);
}

function signOut() {
  if (_accessToken) google.accounts.oauth2.revoke(_accessToken, () => {});
  _accessToken = null;
  _currentUser  = null;
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function getCurrentUser()  { return _currentUser; }
function getAccessToken()  { return _accessToken; }

/* Helper de fetch autenticado — usado por api.js */
async function fetchWithAuth(url, opts = {}) {
  if (!_accessToken) throw new Error('No autenticado');
  const isFormData = opts.body instanceof FormData;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + _accessToken,
      ...(!isFormData && { 'Content-Type': 'application/json' }),
      ...opts.headers
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Error ' + res.status);
  }
  return res.json();
}
