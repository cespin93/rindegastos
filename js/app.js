// ─── Estado global ────────────────────────────
const state = {
  role:           null,  // RENDIDOR | APROBADOR | GERENTE | ADMIN
  expenses:       [],
  payments:       [],
  categories:     [],
  costCenters:    [],
  users:          [],
  empresas:       [],
  empresaUsuario: '',    // empresa del usuario logueado
  currentExpense: null,
  prevView:       null,
  detailContext:  null   // 'dashboard' | 'approvals' | 'gerencia'
};

// ─── Helpers DOM ──────────────────────────────
const $ = id => document.getElementById(id);
const _isAdmin = () => state.role === 'ADMIN' || state.role === 'SUPERADMIN';
const _getCurrentUserKey = () => ((getCurrentUser()?.email || '').toLowerCase().split('@')[0] || '');
const _canChooseAnyExpenseCompany = () => _isAdmin() || _getCurrentUserKey() === 'mmoreno';
const _isExpenseCompanyLocked = () => !_canChooseAnyExpenseCompany() && !!state.empresaUsuario;
const _getManagerCompanyScope = () => {
  if (state.role !== 'GERENTE') return '';
  const userKey = _getCurrentUserKey();
  if (userKey === 'mmoreno') return '';
  if (userKey === 'jpalma') return 'C Y O';
  return state.empresaUsuario || '';
};
const _canViewAllCompanies = () => {
  if (_isAdmin()) return true;
  return state.role === 'GERENTE' && !_getManagerCompanyScope();
};
const _emailKey = s => (s || '').toLowerCase().split('@')[0];
const _canDeleteExpense = exp =>
  exp.status === 'PENDIENTE' &&
  _emailKey(exp.email) === _emailKey(getCurrentUser()?.email || '');
const _canAccessExpense = exp => {
  if (_isAdmin()) return true;
  const user = getCurrentUser();
  if (!user?.email) return false;
  const myKey = _emailKey(user.email);
  if (state.role === 'GERENTE') {
    if (_emailKey(exp.email) === myKey) return true; // propias, cualquier estado
    const empresaScope = _getManagerCompanyScope();
    return !empresaScope || exp.empresa === empresaScope;
  }
  if (state.role === 'APROBADOR' && _emailKey(exp.approverEmail) === myKey) return true;
  return _emailKey(exp.email) === myKey;
};
const _getUserName = email => {
  const u = state.users.find(u => u.email === (email || '').toLowerCase());
  return u?.displayName || email || '—';
};

function toast(msg, type = 'success') {
  const colors = { success: '#16a34a', error: '#dc2626', info: '#2563eb' };
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:20px;right:20px;background:${colors[type]||colors.success};
    color:#fff;padding:12px 20px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,.2);
    z-index:9999;font-size:14px;font-weight:500;max-width:320px;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function toastLink(msg, linkText, url, type = 'success') {
  const colors = { success: '#16a34a', error: '#dc2626', info: '#2563eb' };
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;bottom:20px;right:20px;background:${colors[type]||colors.success};
    color:#fff;padding:14px 18px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.25);
    z-index:9999;font-size:14px;font-weight:500;max-width:380px;line-height:1.6;`;
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
    <div>${_escapeHtml(msg)}<br>
      <a href="${_escapeHtml(url)}" target="_blank" rel="noopener"
        style="color:#fff;text-decoration:underline;font-size:13px;font-weight:700"
        onclick="this.closest('div[style]').remove()">${_escapeHtml(linkText)} ↗</a>
    </div>
    <button onclick="this.closest('div[style]').remove()"
      style="background:rgba(255,255,255,.25);border:none;color:#fff;border-radius:6px;
             padding:2px 8px;cursor:pointer;font-size:16px;flex-shrink:0;line-height:1.4">✕</button>
  </div>`;
  document.body.appendChild(el);
  setTimeout(() => el?.isConnected && el.remove(), 20000);
}

function blockingAlert(msg) {
  toast(msg, 'error');
  window.alert(msg);
}

function loading(show, text, sub) {
  $('loading').classList.toggle('hidden', !show);
  const t = $('loading-text'), s = $('loading-sub');
  if (t) t.textContent = text || 'Cargando...';
  if (s) { s.textContent = sub || ''; s.style.display = sub ? '' : 'none'; }
}

function showView(id) {
  state.prevView = document.querySelector('.view:not(.hidden)')?.id || null;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
  document.querySelectorAll('[data-view]').forEach(btn =>
    btn.classList.toggle('active-nav', btn.dataset.view === id)
  );
}

function goBack() { showView(state.prevView || 'view-dashboard'); }

function _receiptIcon(mime) {
  if (!mime) return '📎';
  if (mime.startsWith('image/')) return '🖼';
  if (mime === 'application/pdf') return '📄';
  return '📎';
}

function _escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return 'Tamano no disponible';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 104857.6) / 10} MB`;
}

function _shouldShowDocPreviewPanel() {
  return window.innerWidth > 640;
}

let _activeReceiptObjectUrl = null;

function _base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

function _renderPdfWithLoader(container, url, fallbackHref) {
  if (!container) return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:100%;height:100%';

  const loader = document.createElement('div');
  loader.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(15,23,42,.72);color:#fff;z-index:1';
  loader.innerHTML = '<div class="spinner"></div><div style="font-size:13px;font-weight:600">Cargando PDF...</div>';

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.allowFullscreen = true;
  iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:6px;display:none';
  iframe.onload = () => {
    loader.remove();
    iframe.style.display = 'block';
  };
  iframe.onerror = () => {
    wrapper.innerHTML = fallbackHref
      ? `<p style="color:#fff;padding:20px">No se pudo cargar el PDF. <a href="${fallbackHref}" target="_blank" style="color:#93c5fd">Abrir en una nueva pestaña</a></p>`
      : '<p style="color:#fff;padding:20px">No se pudo cargar el PDF.</p>';
  };

  wrapper.append(loader, iframe);
  container.innerHTML = '';
  container.appendChild(wrapper);
}

function _renderPdfLoadingState(container) {
  if (!container) return;
  container.innerHTML = `
    <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(15,23,42,.72);color:#fff;border-radius:6px">
      <div class="spinner"></div>
      <div style="font-size:13px;font-weight:600">Cargando PDF...</div>
    </div>`;
}

function _renderReceiptContent(container, r) {
  if (!container) return;

  const isImage    = r.mime?.startsWith('image/');
  const isPdf      = (r.mime || '').includes('pdf');
  const previewUrl = r.inlineUrl || `https://drive.google.com/file/d/${r.id}/preview`;
  const imgUrl     = r.inlineUrl || `https://drive.google.com/uc?id=${r.id}&export=view`;

  if (r.loading && isPdf) {
    _renderPdfLoadingState(container);
  } else if (isImage) {
    container.innerHTML = `<img src="${imgUrl}" alt="${r.name}"
        onerror="this.outerHTML='<p style=color:#fff;padding:20px>No se pudo cargar. <a href=\\'${r.url}\\' target=\\'_blank\\' style=color:#93c5fd>Abrir en Drive</a></p>'">`;
  } else if (isPdf) {
    _renderPdfWithLoader(container, previewUrl, r.url);
  } else {
    container.innerHTML = `<iframe src="${previewUrl}" allowfullscreen></iframe>`;
  }
}

function openFileViewer(r) {
  const overlay = $('file-viewer-overlay');
  const content = $('file-viewer-content');
  const nameEl  = $('file-viewer-name');
  const linkEl  = $('file-viewer-link');
  if (!overlay) return;

  nameEl.textContent = r.name || 'Archivo';
  linkEl.href        = r.url  || '#';
  _renderReceiptContent(content, r);

  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDetailReceiptPreview() {
  const panel = $('detail-preview-panel');
  const content = $('detail-preview-content');
  const nameEl = $('detail-preview-name');
  const linkEl = $('detail-preview-link');
  if (panel) panel.classList.add('hidden');
  if (content) {
    content.innerHTML = '<span class="doc-preview-empty">📎 Selecciona un documento<br>para visualizarlo aquí</span>';
  }
  if (nameEl) nameEl.textContent = 'Selecciona un adjunto';
  if (linkEl) {
    linkEl.href = '#';
    linkEl.classList.add('hidden');
  }
  document.querySelectorAll('#d-receipts .receipt-link').forEach(btn => btn.classList.remove('is-active'));
}

function _showDetailReceiptPreview(r) {
  const panel = $('detail-preview-panel');
  const content = $('detail-preview-content');
  const nameEl = $('detail-preview-name');
  const linkEl = $('detail-preview-link');
  if (!panel || !content || !nameEl || !linkEl) return false;

  $('file-viewer-overlay')?.classList.add('hidden');
  if ($('file-viewer-content')) $('file-viewer-content').innerHTML = '';
  document.body.style.overflow = '';

  panel.classList.remove('hidden');
  nameEl.textContent = r.name || 'Archivo';
  linkEl.href = r.url || '#';
  linkEl.classList.toggle('hidden', !r.url);
  _renderReceiptContent(content, r);

  document.querySelectorAll('#d-receipts .receipt-link').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.receiptId === String(r.id || ''));
  });

  return true;
}

function closeFileViewer() {
  $('file-viewer-overlay')?.classList.add('hidden');
  $('file-viewer-content').innerHTML = '';
  if (_activeReceiptObjectUrl) {
    URL.revokeObjectURL(_activeReceiptObjectUrl);
    _activeReceiptObjectUrl = null;
  }
  document.body.style.overflow = '';
}

async function openReceipt(r) {
  if (!r) return;
  const isPdf = (r.mime || '').includes('pdf');
  const inlineDetailPreview = $('view-detail') && !$('view-detail').classList.contains('hidden') && $('detail-preview-panel');
  try {
    if (isPdf) {
      const loadingPayload = {
        ...r,
        loading: true
      };
      if (!_showDetailReceiptPreview(loadingPayload) || !inlineDetailPreview) {
        openFileViewer(loadingPayload);
      }
    }
    if (r.id) {
      const res = await getReceiptContent(r.id);
      const blob = _base64ToBlob(res.data, res.mime || r.mime);
      if (_activeReceiptObjectUrl) URL.revokeObjectURL(_activeReceiptObjectUrl);
      _activeReceiptObjectUrl = URL.createObjectURL(blob);
      const previewPayload = {
        ...r,
        name: res.name || r.name,
        mime: res.mime || r.mime,
        inlineUrl: _activeReceiptObjectUrl
      };
      if (!_showDetailReceiptPreview(previewPayload) || !inlineDetailPreview) {
        openFileViewer(previewPayload);
      }
      return;
    }
  } catch (e) {
    console.warn('[Rindegastos] no se pudo cargar el adjunto inline:', e.message);
    toast('No se pudo mostrar el adjunto dentro de la app: ' + e.message, 'error');
    return;
  }
  toast('El adjunto no tiene un identificador válido para mostrarse.', 'error');
}

const fmt     = n => '$' + Number(n).toLocaleString('es-CL');
const _moneyDigits = value => String(value ?? '').replace(/\D+/g, '');
const parseMoney = value => {
  const digits = _moneyDigits(value);
  return digits ? Number(digits) : 0;
};
const formatMoneyInputValue = value => {
  const digits = _moneyDigits(value);
  return digits ? fmt(Number(digits)) : '';
};
function setMoneyInputValue(input, value) {
  if (!input) return;
  input.value = formatMoneyInputValue(value);
}
function bindMoneyInput(input) {
  if (!input || input.dataset.moneyBound === '1') return;
  input.dataset.moneyBound = '1';
  const syncValue = () => {
    input.value = formatMoneyInputValue(input.value);
  };
  input.addEventListener('input', syncValue);
  input.addEventListener('blur', syncValue);
  syncValue();
}
function bindMoneyInputs(root = document) {
  root.querySelectorAll('input[data-money-input="true"]').forEach(bindMoneyInput);
}
const fmtDate = s => {
  if (!s) return '—';
  const d = s.includes('T') ? s.split('T')[0] : s;
  const parsed = new Date(d + 'T12:00:00');
  return isNaN(parsed) ? s : parsed.toLocaleDateString('es-CL');
};

function _getBackendDeploymentId() {
  const match = String(CONFIG?.APPS_SCRIPT_URL || '').match(/\/s\/([^/]+)\/exec/i);
  return match ? match[1] : 'desconocido';
}

function badge(status) {
  const cls = {
    PENDIENTE:  'badge-yellow',
    APROBADO:   'badge-green',
    AUTORIZADO: 'badge-purple',
    RECHAZADO:  'badge-red'
  };
  return `<span class="badge ${cls[status] || 'badge-gray'}">${status}</span>`;
}

function _getPaymentStatus(exp) {
  if (exp.paymentStatus) return exp.paymentStatus;
  return exp.status === 'AUTORIZADO' ? 'PENDIENTE_PAGO' : '';
}

function _getPaymentStatusLabel(status) {
  const labels = {
    PENDIENTE_PAGO: 'Pendiente de pago',
    EN_PREPARACION_PAGO: 'En preparacion',
    PAGADO: 'Pagado',
    ANULADO_PAGO: 'Anulado'
  };
  return labels[status] || 'Pendiente de pago';
}

function _paymentBadge(status, batchId) {
  const normalized = status || 'PENDIENTE_PAGO';
  const cls = {
    PENDIENTE_PAGO: 'pending',
    EN_PREPARACION_PAGO: 'preparing',
    PAGADO: 'paid',
    ANULADO_PAGO: 'cancelled'
  }[normalized] || 'pending';
  const meta = batchId ? `<span class="conta-pay-meta">Lote ${_escapeHtml(batchId)}</span>` : '';
  return `<span class="conta-pay-badge ${cls}">${_getPaymentStatusLabel(normalized)}</span>${meta}`;
}

function _canSelectPaymentStatus(status) {
  return status === 'PENDIENTE_PAGO' || status === 'ANULADO_PAGO';
}

function _buildPaymentBatchId() {
  const stamp = new Date();
  const yyyy = stamp.getFullYear();
  const mm = String(stamp.getMonth() + 1).padStart(2, '0');
  const dd = String(stamp.getDate()).padStart(2, '0');
  const hh = String(stamp.getHours()).padStart(2, '0');
  const min = String(stamp.getMinutes()).padStart(2, '0');
  const sec = String(stamp.getSeconds()).padStart(2, '0');
  return `PG-${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

// ─── Arranque ─────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await _loadViews();
  bindMoneyInputs();
  initAuth(onSignIn);
});

/* Maneja el submit del formulario de login */
async function handleLogin(ev) {
  ev.preventDefault();
  const email  = $('login-email').value.trim();
  const pass   = $('login-password').value;
  const btn    = $('login-btn');
  const errEl  = $('login-error');

  btn.disabled    = true;
  btn.textContent = 'Ingresando...';
  errEl.classList.add('hidden');
  errEl.textContent = '';

  try {
    await signIn(email, pass);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
    btn.disabled    = false;
    btn.textContent = 'Ingresar';
  }
}

async function _loadViews() {
  const main = document.getElementById('main-content');
  const views = ['dashboard', 'new-expense', 'detail', 'approvals', 'gerencia', 'contabilidad', 'admin', 'batch-detail'];
  const baseUrl = new URL('.', window.location.href);
  const viewVersion = '12';
  for (const name of views) {
    const res  = await fetch(new URL(`views/${name}.html?v=${viewVersion}`, baseUrl), { cache: 'no-store' });
    const html = await res.text();
    main.insertAdjacentHTML('beforeend', html);
  }
}

async function onSignIn(user) {
  loading(true);
  try {
    // El rol viene incluido en el objeto user desde el login
    state.role = user.role || await getUserRole(user.email);

    $('user-name').textContent    = user.displayName || user.email;
    $('user-email').textContent   = user.email;
    $('user-avatar').textContent  = (user.displayName || user.email).charAt(0).toUpperCase();

    // Mostrar/ocultar nav según rol
    document.querySelectorAll('[data-role]').forEach(el => {
      const roles = el.dataset.role.split(',');
      el.classList.toggle('hidden', !roles.includes(state.role));
    });

    // Guardar empresa del usuario logueado
    const userObj = state.users.length
      ? state.users.find(u => u.email === user.email?.toLowerCase())
      : null;
    state.empresaUsuario = user.empresa || userObj?.empresa || '';

    await Promise.all([_loadCategories(), _loadCostCenters(), _loadUsers(), _loadFondoFijo(), _loadEmpresas()]);

    $('login-screen').classList.add('hidden');
    $('app-screen').classList.remove('hidden');

    if (state.role === 'APROBADOR' || state.role === 'SUPERADMIN') {
      await navApprovals();
    } else if (state.role === 'GERENTE') {
      await navGerencia();
    } else {
      await navDashboard();
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading(false);
  }
}

// ─── Datos de referencia ──────────────────────
async function _loadCategories() {
  state.categories = await getCategories();
  _fillSelect('form-category', state.categories.map(c => ({ val: c, label: c })), '— Categoría —');
}

function _fillExpenseCompanySelects(selectedCompany = '') {
  const items = state.empresas.map(e => ({ val: e.nombre, label: e.nombre }));
  if (selectedCompany && !items.some(i => i.val === selectedCompany)) {
    items.unshift({ val: selectedCompany, label: selectedCompany });
  }
  const locked = _isExpenseCompanyLocked();
  ['form-company', 'bulk-company'].forEach(id => {
    _fillSelect(id, items, '— Seleccionar empresa —');
    const sel = $(id);
    if (!sel) return;
    sel.value = selectedCompany || '';
    sel.disabled = locked;
  });
}

function _syncExpenseCompanySelects(company = '') {
  ['form-company', 'bulk-company'].forEach(id => {
    const sel = $(id);
    if (sel) sel.value = company || '';
  });
}

function _refreshBulkCostCenterOptions() {
  const options = ['<option value="">— C. Costo —</option>']
    .concat(state.costCenters.map(c => `<option value="${c}">${c}</option>`))
    .join('');
  document.querySelectorAll('#bulk-tbody .bulk-cost-center-select').forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = options;
    if (prev && state.costCenters.includes(prev)) sel.value = prev;
  });
}

async function _loadCostCenters(company = state.empresaUsuario) {
  state.costCenters = company ? await getCostCenters(company) : [];
  const formCostCenter = $('form-cost-center');
  const prevFormValue = formCostCenter?.value || '';
  _fillSelect('form-cost-center', state.costCenters.map(c => ({ val: c, label: c })), '— Centro de Costo —');
  if (formCostCenter && prevFormValue && state.costCenters.includes(prevFormValue)) {
    formCostCenter.value = prevFormValue;
  }
  _refreshBulkCostCenterOptions();
}

async function _loadEmpresas() {
  state.empresas = await getEmpresas();
}

async function _loadFondoFijo() {
  state.fondoFijo = await getFondoFijo();
}

async function _loadUsers() {
  state.users = await getUsers();
  const currentEmail = getCurrentUser()?.email?.toLowerCase();
  const me = state.users.find(u => u.email === currentEmail);
  if (me?.empresa) state.empresaUsuario = me.empresa;
  const approvers = state.users.filter(u =>
    (u.role === 'APROBADOR' || u.role === 'ADMIN' || u.role === 'SUPERADMIN') &&
    u.email !== currentEmail
  );
  _fillSelect('form-approver', approvers.map(u => ({ val: u.email, label: u.displayName })), 'Sin aprobador asignado');
  _fillSelect('bulk-approver', approvers.map(u => ({ val: u.email, label: u.displayName })), 'Sin aprobador asignado');
}

function _fillSelect(id, items, placeholder) {
  const sel = $(id);
  if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map(i => `<option value="${i.val}">${i.label}</option>`).join('');
}

function _getSelectedExpenseCompany() {
  return $('form-company')?.value || $('bulk-company')?.value || state.empresaUsuario || '';
}

async function handleExpenseCompanyChange(company) {
  _syncExpenseCompanySelects(company || '');
  await _loadCostCenters(company || '');
}

async function _setupExpenseCompanyFields() {
  const selectedCompany = _isExpenseCompanyLocked()
    ? (state.empresaUsuario || '')
    : (_getSelectedExpenseCompany() || state.empresaUsuario || '');
  _fillExpenseCompanySelects(selectedCompany);
  await _loadCostCenters(selectedCompany);
}

function _mergeExpenses(list) {
  list.forEach(e => {
    const idx = state.expenses.findIndex(x => x.rowIndex === e.rowIndex);
    idx >= 0 ? state.expenses[idx] = e : state.expenses.push(e);
  });
}

// ─── DASHBOARD ────────────────────────────────
async function navDashboard() {
  loading(true);
  try {
    showView('view-dashboard');
    const [all] = await Promise.all([getExpenses(), _loadFondoFijo()]);
    _mergeExpenses(all);
    const mine = all.filter(_canAccessExpense);
    _renderStats(mine);
    _renderFondoFijo(mine);
    _renderTable(mine);
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

function _renderFondoFijo(exps) {
  const widget = $('ff-widget');
  if (!widget) return;

  const email = getCurrentUser()?.email?.toLowerCase();
  const now   = new Date();
  const mes   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fondo = (state.fondoFijo || []).find(f => f.email === email && f.month.substring(0, 7) === mes);

  if (!fondo || _isAdmin()) {
    widget.classList.add('hidden');
    return;
  }

  const gastado   = exps
    .filter(e => e.fechaGasto.startsWith(mes) && e.status !== 'RECHAZADO')
    .reduce((s, e) => s + e.total, 0);
  const saldo     = fondo.monto - gastado;
  const excedente = saldo < 0;
  const pct       = Math.min(Math.round((gastado / fondo.monto) * 100), 100);
  const barColor  = excedente ? '#dc2626' : pct > 80 ? '#d97706' : '#16a34a';
  const mesLabel  = now.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });

  $('ff-widget-label').textContent = excedente
    ? `🔴 Excedente ${fmt(Math.abs(saldo))}`
    : `💰 Disponible ${fmt(saldo)}`;

  $('ff-widget-content').innerHTML = `
    <div class="ff-month">Fondo Fijo — ${mesLabel}</div>
    <div class="ff-row">
      <span class="ff-label">Asignado</span>
      <span class="ff-value">${fmt(fondo.monto)}</span>
    </div>
    <div class="ff-row">
      <span class="ff-label">Gastado este mes</span>
      <span class="ff-value">${fmt(gastado)}</span>
    </div>
    <div class="ff-row">
      <span class="ff-label" style="font-weight:600">${excedente ? 'Excedente' : 'Disponible'}</span>
      <span class="ff-value" style="color:${excedente ? '#dc2626' : '#16a34a'};font-size:20px">
        ${excedente ? '-' : ''}${fmt(Math.abs(saldo))}
      </span>
    </div>
    <div class="ff-bar-track">
      <div class="ff-bar-fill" style="width:${pct}%;background:${barColor}"></div>
    </div>
    <div class="ff-pct">${pct}% utilizado</div>`;

  widget.classList.remove('hidden');
}

function toggleFfWidget() {
  const panel = $('ff-widget-panel');
  panel.classList.toggle('hidden');
}

function _renderStats(exps) {
  $('stat-count').textContent    = exps.length;
  $('stat-total').textContent    = fmt(exps.reduce((s, e) => s + e.total, 0));
  $('stat-pending').textContent  = exps.filter(e => e.status === 'PENDIENTE').length;
  $('stat-approved').textContent = fmt(
    exps.filter(e => e.status === 'APROBADO' || e.status === 'AUTORIZADO')
        .reduce((s, e) => s + e.total, 0)
  );
  $('stat-rejected').textContent = exps.filter(e => e.status === 'RECHAZADO').length;
}

function _batchStatus(exps) {
  const ss = exps.map(e => e.status);
  if (ss.every(s => s === 'AUTORIZADO')) return 'AUTORIZADO';
  if (ss.every(s => s === 'APROBADO' || s === 'AUTORIZADO')) return 'APROBADO';
  if (ss.every(s => s === 'RECHAZADO')) return 'RECHAZADO';
  if (ss.every(s => s === 'PENDIENTE')) return 'PENDIENTE';
  const done = ss.filter(s => s !== 'PENDIENTE').length;
  return `${done}/${exps.length}`;
}

function _renderTable(exps) {
  const tbody = $('exp-tbody');
  if (!exps.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No hay rendiciones registradas</td></tr>';
    return;
  }

  // Separar individuales y agrupar por batch
  const batches = {};
  const singles = [];
  for (const e of exps) {
    if (e.batchName) {
      (batches[e.batchName] = batches[e.batchName] || []).push(e);
    } else {
      singles.push(e);
    }
  }

  const rows = [];

  // Filas de batches
  for (const [name, list] of Object.entries(batches)) {
    const total  = list.reduce((s, e) => s + e.total, 0);
    const status = _batchStatus(list);
    const knownStatus = ['PENDIENTE','APROBADO','AUTORIZADO','RECHAZADO'].includes(status);
    const statusCell = knownStatus
      ? badge(status)
      : `<span class="badge badge-gray">${status} revisados</span>`;
    const batchDate = fmtDate(list[0].timestamp?.split('T')[0] || list[0].fechaGasto);
    rows.push(`
      <tr class="table-row" onclick="openBatchDetail('${name.replace(/'/g,"\\'")}')">
        <td class="td">${batchDate}</td>
        <td class="td td-bold">
          <span style="font-size:11px;background:#dbeafe;color:#1e40af;padding:2px 7px;border-radius:10px;margin-right:6px">CONJUNTO</span>
          ${name}
          <span style="font-size:12px;color:#6b7280;margin-left:4px">(${list.length} gastos)</span>
        </td>
        <td class="td td-muted">—</td>
        <td class="td td-muted">—</td>
        <td class="td td-muted">—</td>
        <td class="td td-bold">${fmt(total)}</td>
        <td class="td">${statusCell}</td>
        <td class="td td-muted">—</td>
        <td class="td"></td>
      </tr>`);
  }

  // Filas individuales
  for (const e of singles) {
    const delBtn = _canDeleteExpense(e)
      ? `<button onclick="deleteExpenseConfirm(${e.rowIndex},event)"
           style="background:#dc2626;border:none;color:#fff;cursor:pointer;font-size:12px;
                  font-weight:600;padding:5px 12px;border-radius:6px;white-space:nowrap"
           onmouseover="this.style.background='#b91c1c'" onmouseout="this.style.background='#dc2626'">
           🗑 Eliminar</button>`
      : '';
    rows.push(`
      <tr class="table-row" onclick="openDetail(${e.rowIndex},'dashboard')">
        <td class="td">${fmtDate(e.fechaGasto)}</td>
        <td class="td td-bold">${e.title}</td>
        <td class="td td-muted">${e.category}</td>
        <td class="td td-muted">${e.docType}</td>
        <td class="td td-muted">${e.docNumber || '—'}</td>
        <td class="td td-bold">${fmt(e.total)}</td>
        <td class="td">${badge(e.status)}</td>
        <td class="td td-muted">${_getUserName(e.approverEmail)}</td>
        <td class="td" style="text-align:center">${delBtn}</td>
      </tr>`);
  }

  tbody.innerHTML = rows.join('');
}

async function deleteExpenseConfirm(rowIndex, event) {
  event.stopPropagation();
  const exp = state.expenses.find(e => e.rowIndex === rowIndex);
  if (!exp) return;
  if (!confirm(`¿Eliminar esta rendición?\n\n"${exp.title}" — ${fmt(exp.total)}\n\nEsta acción no se puede deshacer.`)) return;
  loading(true);
  try {
    await deleteExpense(rowIndex);
    state.expenses = state.expenses.filter(e => e.rowIndex !== rowIndex);
    const mine = state.expenses.filter(_canAccessExpense);
    _renderStats(mine);
    _renderTable(mine);
    toast('Rendición eliminada correctamente.', 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading(false);
  }
}

function openBatchDetail(batchName, context = 'dashboard') {
  const list = state.expenses.filter(e => e.batchName === batchName && _canAccessExpense(e));
  if (!list.length) return;

  state._currentBatch   = batchName;
  state._batchContext   = context;

  $('bd-name').textContent = batchName;
  $('bd-meta').textContent = `Enviado por: ${_getUserName(list[0].email) || list[0].email}`;

  const total      = list.reduce((s, e) => s + e.total, 0);
  const pending    = list.filter(e => e.status === 'PENDIENTE').length;
  const approved   = list.filter(e => e.status === 'APROBADO').length;
  const authorized = list.filter(e => e.status === 'AUTORIZADO').length;

  $('bd-count').textContent        = list.length;
  $('bd-total').textContent        = fmt(total);
  $('bd-pending').textContent      = pending;
  $('bd-approved').textContent     = approved;
  $('bd-authorized').textContent   = authorized;
  $('bd-total-footer').textContent = fmt(total);

  // Botones de cabecera según contexto
  const canAuth     = (state.role === 'GERENTE' || _isAdmin()) && context === 'gerencia';
  const authAllBtn  = $('bd-auth-all-btn');
  const printBtn    = $('bd-print-btn');
  if (authAllBtn) authAllBtn.classList.toggle('hidden', !canAuth || approved === 0);
  if (printBtn)   printBtn.classList.toggle('hidden', authorized === 0);

  const currentEmail = getCurrentUser()?.email?.toLowerCase();
  const canApprove   = state.role === 'APROBADOR' || _isAdmin();

  $('bd-tbody').innerHTML = list.map(e => {
    const isOwn = e.email === currentEmail && state.role !== 'SUPERADMIN';
    let actionBtn = '';
    if (canApprove && e.status === 'PENDIENTE' && !isOwn) {
      actionBtn = `<button class="btn-primary" style="font-size:12px;padding:4px 10px"
                    onclick="openDetail(${e.rowIndex},'approvals')">Revisar</button>`;
    } else if (canAuth && e.status === 'APROBADO' && !isOwn) {
      actionBtn = `<button class="btn-primary" style="font-size:12px;padding:4px 10px;background:#7c3aed"
                    onclick="openDetail(${e.rowIndex},'gerencia')">Autorizar</button>`;
    } else {
      actionBtn = `<button class="btn-secondary" style="font-size:12px;padding:4px 10px"
                    onclick="openDetail(${e.rowIndex},'dashboard')">Ver</button>`;
    }
    return `
      <tr class="table-row">
        <td class="td">${fmtDate(e.fechaGasto)}</td>
        <td class="td td-bold">${e.title}</td>
        <td class="td td-muted">${e.category}</td>
        <td class="td td-muted">${e.docType}</td>
        <td class="td td-muted">${e.docNumber || '—'}</td>
        <td class="td td-muted">${e.provider || '—'}</td>
        <td class="td td-bold">${fmt(e.total)}</td>
        <td class="td">${badge(e.status)}</td>
        <td class="td td-muted">${_getUserName(e.approverEmail)}</td>
        <td class="td">${actionBtn}</td>
      </tr>`;
  }).join('');

  showView('view-batch-detail');
}

async function authorizeAll() {
  const batchName = state._currentBatch;
  const list      = state.expenses.filter(e => e.batchName === batchName && e.status === 'APROBADO' && _canAccessExpense(e));
  if (!list.length) { toast('No hay gastos aprobados para autorizar', 'info'); return; }

  if (!confirm(`¿Autorizar los ${list.length} gasto(s) aprobados del conjunto "${batchName}"?`)) return;

  const user      = getCurrentUser();
  const authName  = _getUserName(user.email) || user.email;
  const obs       = `Autorizado por ${authName} el ${new Date().toLocaleString('es-CL')}`;

  // Capturar aprobadores antes de sobreescribir
  const snapshot  = list.map(e => ({ rowIndex: e.rowIndex, approver: e.approverEmail, title: e.title }));

  loading(true);
  try {
    for (const e of list) {
      await updateExpenseStatus(e.rowIndex, 'AUTORIZADO', obs, user.email);
      e.status       = 'AUTORIZADO';
      e.observations = obs;
      const ownr      = state.users.find(u => u.email === e.email);
      const notifyA   = ownr?.notifyEmail || (e.email.includes('@') ? e.email : null);
      if (notifyA) { try { await sendReceipt(e, notifyA); } catch (_) {} }
    }
    await addAudit('AUTORIZAR_CONJUNTO', user.email, { batchName, count: list.length });
    toast(`${list.length} gastos autorizados. Abriendo informe...`, 'success');
    printAuthReport(batchName, user.email, snapshot);
    openBatchDetail(batchName, 'gerencia');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading(false);
  }
}

function printAuthReport(batchName, authEmail, snapshot) {
  const batchName_ = batchName || state._currentBatch;
  const list       = state.expenses.filter(e => e.batchName === batchName_ && _canAccessExpense(e));
  const total      = list.reduce((s, e) => s + e.total, 0);
  const authName   = _getUserName(authEmail) || authEmail || _getUserName(getCurrentUser()?.email);
  const fecha      = new Date().toLocaleDateString('es-CL');

  const rows = list.map(e => {
    const snap         = snapshot?.find(s => s.rowIndex === e.rowIndex);
    const approverName = _getUserName(snap?.approver || e.approverEmail);
    return `<tr>
      <td>${fmtDate(e.fechaGasto)}</td>
      <td>${e.title}</td>
      <td>${e.category}</td>
      <td>${e.docType}</td>
      <td>${e.docNumber || '—'}</td>
      <td>${e.provider || '—'}</td>
      <td style="text-align:right;font-weight:600">${fmt(e.total)}</td>
      <td>${approverName}</td>
      <td>${authName}</td>
    </tr>`;
  }).join('');

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Informe Autorización - ${batchName_}</title>
<style>
  body{font-family:Arial,sans-serif;color:#111;margin:40px;font-size:13px}
  h1{font-size:20px;margin:0 0 4px}
  .meta{color:#6b7280;font-size:12px;margin-bottom:24px;line-height:1.8}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#1e40af;color:#fff;padding:8px;text-align:left;font-size:11px}
  td{padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top}
  tr:nth-child(even) td{background:#f9fafb}
  .total-row td{font-weight:700;background:#eff6ff;border-top:2px solid #1e40af;font-size:13px}
  .footer{margin-top:60px;display:flex;justify-content:space-around;page-break-inside:avoid}
  .sig{text-align:center;width:220px}
  .sig-line{border-top:1px solid #374151;margin:0 auto 8px;width:180px}
  .sig-label{font-size:11px;color:#374151;line-height:1.6}
  @media print{body{margin:20px}.no-print{display:none}}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
  <div>
    <h1>Informe de Autorización de Gastos</h1>
    <div class="meta">
      <strong>Conjunto:</strong> ${batchName_}<br>
      <strong>Fecha de emisión:</strong> ${fecha}<br>
      <strong>Autorizado por:</strong> ${authName}
    </div>
  </div>
  <button class="no-print" onclick="window.print()"
    style="padding:8px 18px;background:#1e40af;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px">
    🖨 Imprimir
  </button>
</div>
<table>
  <thead><tr>
    <th>Fecha</th><th>Concepto</th><th>Categoría</th>
    <th>Tipo Doc</th><th>N° Doc</th><th>Proveedor</th>
    <th>Monto</th><th>Aprobado por</th><th>Autorizado por</th>
  </tr></thead>
  <tbody>
    ${rows}
    <tr class="total-row">
      <td colspan="6" style="text-align:right">Total del conjunto:</td>
      <td>${fmt(total)}</td><td colspan="2"></td>
    </tr>
  </tbody>
</table>
<div class="footer">
  <div class="sig"><div class="sig-line"></div>
    <div class="sig-label">Firma Aprobador</div></div>
  <div class="sig"><div class="sig-line"></div>
    <div class="sig-label"><strong>${authName}</strong><br>Gerente Autorizador</div></div>
</div>
</body></html>`);
  win.document.close();
}

function filterTable() {
  const q = $('search').value.toLowerCase();
  const s = $('filter-status').value;
  let exps = state.expenses.filter(_canAccessExpense);
  exps = exps.filter(e =>
    (!q || e.title.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || (e.provider || '').toLowerCase().includes(q)) &&
    (!s || e.status === s)
  );
  _renderStats(exps);
  _renderTable(exps);
}

function exportCSV() {
  const exps = state.expenses.filter(_canAccessExpense);
  const headers = ['Fecha','Concepto','Categoría','Tipo Doc','N° Doc','Proveedor','Monto','Estado','Aprobador','Observaciones'];
  const rows = exps.map(e => [
    e.fechaGasto, e.title, e.category, e.docType, e.docNumber,
    e.provider, e.total, e.status, e.approverEmail, e.observations
  ].map(v => `"${(v||'').toString().replace(/"/g,'""')}"`));
  const csv = '\uFEFF' + [headers.map(h=>`"${h}"`), ...rows].map(r => r.join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: `rendiciones_${new Date().toISOString().split('T')[0]}.csv`
  });
  a.click();
}

// ─── DETALLE ──────────────────────────────────
function openDetail(rowIndex, context) {
  const e = state.expenses.find(x => x.rowIndex === rowIndex);
  if (!e) return;
  closeFileViewer();
  if (!_canAccessExpense(e)) {
    toast('No tienes permisos para visualizar este gasto', 'error');
    return;
  }
  state.currentExpense = e;
  state.detailContext  = context || 'dashboard';

  $('d-title').textContent        = e.title;
  $('d-status').innerHTML         = badge(e.status);
  $('d-email').textContent        = e.email;
  $('d-date').textContent         = fmtDate(e.fechaGasto);
  $('d-category').textContent     = e.category;
  $('d-total').textContent        = fmt(e.total);
  $('d-doctype').textContent      = e.docType;
  $('d-docnumber').textContent    = e.docNumber || '—';
  $('d-provider').textContent     = e.provider || '—';
  $('d-notes').textContent        = e.notes    || '—';
  $('d-approver').textContent     = _getUserName(e.approverEmail);
  $('d-observations').textContent = e.observations  || '—';

  $('d-receipts').innerHTML = e.receipts?.length
    ? e.receipts.map(r => `
        <button class="receipt-link" data-receipt-id="${String(r.id || '')}" onclick='openReceipt(${JSON.stringify(r)})'>
          ${_receiptIcon(r.mime)} ${r.name}
        </button>`).join('')
    : '<p class="text-muted">Sin archivos adjuntos</p>';

  const user = getCurrentUser();

  // Nivel 1: APROBADOR/ADMIN puede aprobar PENDIENTE que no sea suyo
  const canL1 =
    context === 'approvals' &&
    e.status === 'PENDIENTE' &&
    (state.role === 'APROBADOR' || _isAdmin()) &&
    (e.email !== user.email.toLowerCase() || state.role === 'SUPERADMIN');

  // Nivel 2: GERENTE/ADMIN puede autorizar APROBADO
  const canL2 =
    context === 'gerencia' &&
    e.status === 'APROBADO' &&
    (state.role === 'GERENTE' || _isAdmin()) &&
    _canAccessExpense(e) &&
    (e.email !== user.email.toLowerCase() || state.role === 'SUPERADMIN');

  $('d-actions-l1').classList.toggle('hidden', !canL1);
  $('d-actions-l2').classList.toggle('hidden', !canL2);
  if (canL1) $('d-comment-l1').value = '';
  if (canL2) $('d-comment-l2').value = '';

  showView('view-detail');
  closeDetailReceiptPreview();
  if (context === 'approvals' && e.receipts?.length) {
    openReceipt(e.receipts[0]);
  }
}

async function doDecision(newStatus) {
  const e    = state.currentExpense;
  if (!e) return;
  const user = getCurrentUser();
  if (e.email === user.email.toLowerCase() && state.role !== 'SUPERADMIN') {
    toast('No puedes aprobar tus propias rendiciones', 'error');
    return;
  }
  const commentEl = newStatus === 'AUTORIZADO' ? $('d-comment-l2') : $('d-comment-l1');
  const comment   = commentEl?.value.trim() || '';
  const label     = { APROBADO: 'Aprobado', AUTORIZADO: 'Autorizado', RECHAZADO: 'Rechazado' }[newStatus] || newStatus;
  const obs = `${label} por ${user.email} el ${new Date().toLocaleString('es-CL')}` +
              (comment ? ` | ${comment}` : '');

  // Regla: si un APROBADOR/ADMIN aprueba (nivel 1) la rendición de un GERENTE
  // → se salta gerencia y queda AUTORIZADO directamente
  let finalStatus = newStatus;
  if (newStatus === 'APROBADO') {
    const expOwner = state.users.find(u => u.email === e.email);
    if (expOwner?.role === 'GERENTE') {
      finalStatus = 'AUTORIZADO';
    }
  }

  loading(true);
  try {
    await updateExpenseStatus(e.rowIndex, finalStatus, obs, user.email);
    await addAudit(finalStatus, user.email, { rowIndex: e.rowIndex, title: e.title });

    e.status        = finalStatus;
    e.observations  = obs;
    e.approverEmail = user.email;

    toast(`Rendición ${finalStatus.toLowerCase()} correctamente`, 'success');

    // Notificar al rendidor (usa notifyEmail si está configurado, si no el email de login)
    const owner       = state.users.find(u => u.email === e.email);
    const notifyAddr  = owner?.notifyEmail || (e.email.includes('@') ? e.email : null);
    if (notifyAddr) {
      try { await sendReceipt(e, notifyAddr); } catch (_) {}
    }
    if (CONFIG.RECEIPTS_EMAIL) {
      try { await sendReceipt(e, CONFIG.RECEIPTS_EMAIL); } catch (_) {}
    }

    if (state.detailContext === 'gerencia') await navGerencia();
    else await navApprovals();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    loading(false);
  }
}

async function sendReceiptManual() {
  const e = state.currentExpense;
  if (!e) return;
  const to = CONFIG.RECEIPTS_EMAIL || prompt('Email de destino para el comprobante:');
  if (!to) return;
  loading(true);
  try {
    await sendReceipt(e, to);
    toast('Comprobante enviado correctamente', 'success');
  } catch (err) {
    toast('Error al enviar: ' + err.message, 'error');
  } finally {
    loading(false);
  }
}

// ─── APROBACIONES ─────────────────────────────
async function navApprovals() {
  loading(true);
  try {
    showView('view-approvals');
    const all = await getExpenses();
    _mergeExpenses(all);
    const user = getCurrentUser();

    let pending;
    if (_isAdmin()) {
      // Admin ve todos los PENDIENTE
      pending = all.filter(e => e.status === 'PENDIENTE');
    } else if (state.role === 'GERENTE') {
      // Gerente ve los PENDIENTE dentro de su alcance (solo lectura)
      pending = all.filter(e => e.status === 'PENDIENTE' && _canAccessExpense(e));
    } else {
      // Aprobador ve solo los asignados a él
      pending = all.filter(e =>
        e.status === 'PENDIENTE' &&
        e.approverEmail === user.email.toLowerCase()
      );
    }

    // Mostrar aviso de solo lectura para GERENTE
    $('approvals-readonly-notice').classList.toggle('hidden', state.role !== 'GERENTE');

    _renderApprovals(pending);
    const countText = pending.length
      ? `${pending.length} pendiente${pending.length > 1 ? 's' : ''}`
      : '';
    $('nav-approvals-count').textContent = pending.length || '';
    $('approvals-subtitle').textContent  = countText;
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

function _renderApprovals(exps) {
  const el = $('approvals-list');
  if (!exps.length) {
    el.innerHTML = `
      <div class="empty-approvals">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <p>Sin pendientes de aprobación</p>
      </div>`;
    return;
  }
  el.innerHTML = exps.map(e => `
    <div onclick="openDetail(${e.rowIndex},'approvals')" class="approval-card">
      <div class="approval-card-header">
        <div>
          <h3 class="approval-title">${e.title}</h3>
          <p class="approval-email">${e.email}</p>
        </div>
        <span class="approval-amount">${fmt(e.total)}</span>
      </div>
      <div class="approval-tags">
        <span class="tag">${e.category}</span>
        <span class="tag">${e.docType}</span>
        <span class="tag">${fmtDate(e.fechaGasto)}</span>
        ${e.receipts?.length ? `<span class="tag tag-purple">📎 ${e.receipts.length} archivo(s)</span>` : ''}
      </div>
    </div>`).join('');
}

// ─── GERENCIA ─────────────────────────────────
async function navGerencia() {
  loading(true);
  try {
    showView('view-gerencia');
    const all = await getExpenses();
    _mergeExpenses(all);
    const user = getCurrentUser();
    const myKey = _emailKey(user?.email || '');
    // Rendiciones propias del gerente (todas, para que las vea sin importar estado)
    const myOwn = (state.role === 'GERENTE' && myKey)
      ? all.filter(e => _emailKey(e.email) === myKey).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      : [];
    // Cola de autorización: APROBADO de otros rendidores dentro del scope del gerente
    const toAuthorize = all.filter(e => e.status === 'APROBADO' && _emailKey(e.email) !== myKey && _canAccessExpense(e));
    _renderGerencia(toAuthorize, myOwn);
    const countText = toAuthorize.length
      ? `${toAuthorize.length} pendiente${toAuthorize.length > 1 ? 's' : ''} de autorización`
      : 'Sin rendiciones pendientes de autorización';
    $('gerencia-subtitle').textContent  = countText;
    $('nav-gerencia-count').textContent = toAuthorize.length || '';
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

function _renderGerencia(exps, myOwn = []) {
  const el = $('gerencia-list');
  if (!exps.length && !myOwn.length) {
    el.innerHTML = `
      <div class="empty-approvals">
        <div style="font-size:48px;margin-bottom:12px">🏛</div>
        <p>Sin rendiciones pendientes de autorización gerencial</p>
      </div>`;
    return;
  }

  let html = '';

  // ── Sección: Mis rendiciones (propias del gerente) ──
  if (myOwn.length) {
    html += `
      <div style="margin-bottom:24px">
        <div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:.05em;text-transform:uppercase;margin-bottom:10px">
          Mis rendiciones
        </div>`;
    for (const e of myOwn) {
      html += `
        <div onclick="openDetail(${e.rowIndex},'gerencia')" class="approval-card" style="cursor:pointer;margin-bottom:8px">
          <div class="approval-card-header">
            <div style="min-width:0;flex:1">
              <h3 class="approval-title" style="margin-bottom:2px">${_escapeHtml(e.title)}</h3>
              <p class="approval-email">${_escapeHtml(e.docType)} N°${_escapeHtml(e.docNumber || '—')} • ${fmtDate(e.fechaGasto)}</p>
            </div>
            <div style="text-align:right;flex-shrink:0;margin-left:12px">
              <div class="approval-amount">${fmt(e.total)}</div>
              <div style="margin-top:4px">${badge(e.status)}</div>
            </div>
          </div>
        </div>`;
    }
    html += `</div>`;
  }

  // ── Sección: Cola de autorización ──
  if (exps.length) {
    if (myOwn.length) {
      html += `<div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:.05em;text-transform:uppercase;margin-bottom:10px">
        Pendientes de autorización
      </div>`;
    }

    // Agrupar por batchName
    const batches = {};
    const singles = [];
    for (const e of exps) {
      if (e.batchName) (batches[e.batchName] = batches[e.batchName] || []).push(e);
      else singles.push(e);
    }

    // Conjuntos (batch)
    for (const [name, list] of Object.entries(batches)) {
      const total     = list.reduce((s, e) => s + e.total, 0);
      const approvers = [...new Set(list.map(e => _getUserName(e.approverEmail)))].join(', ');
      html += `
        <div onclick="openBatchDetail('${name.replace(/'/g,"\\'")}','gerencia')" class="approval-card approval-card-gerencia">
          <div class="approval-card-header">
            <div>
              <h3 class="approval-title">
                <span style="font-size:11px;background:#dbeafe;color:#1e40af;padding:2px 7px;border-radius:10px;margin-right:6px">CONJUNTO</span>
                ${name}
              </h3>
              <p class="approval-email">${list.length} gastos
                <span style="margin-left:6px;font-size:11px;color:#059669">• Aprobado por ${approvers}</span>
              </p>
            </div>
            <span class="approval-amount">${fmt(total)}</span>
          </div>
          <div class="approval-tags">
            ${badge('APROBADO')}
            <span class="tag">📦 ${list.length} gastos pendientes de autorización</span>
          </div>
        </div>`;
    }

    // Gastos individuales
    for (const e of singles) {
      html += `
        <div onclick="openDetail(${e.rowIndex},'gerencia')" class="approval-card approval-card-gerencia">
          <div class="approval-card-header">
            <div>
              <h3 class="approval-title">${_escapeHtml(e.title)}</h3>
              <p class="approval-email">${_escapeHtml(e.email)}
                <span style="margin-left:6px;font-size:11px;color:#059669">• Aprobado por ${_getUserName(e.approverEmail)}</span>
              </p>
            </div>
            <span class="approval-amount">${fmt(e.total)}</span>
          </div>
          <div class="approval-tags">
            <span class="tag">${_escapeHtml(e.category)}</span>
            <span class="tag">${_escapeHtml(e.docType)}</span>
            <span class="tag">${fmtDate(e.fechaGasto)}</span>
            ${e.receipts?.length ? `<span class="tag tag-purple">📎 ${e.receipts.length} archivo(s)</span>` : ''}
            ${badge('APROBADO')}
          </div>
        </div>`;
    }
  } else if (myOwn.length) {
    html += `
      <div style="padding:16px;background:#f9fafb;border-radius:10px;text-align:center;color:#9ca3af;font-size:13px">
        Sin rendiciones pendientes de autorización gerencial
      </div>`;
  }

  el.innerHTML = html;
}

// ─── NUEVA RENDICIÓN ──────────────────────────
async function navNewExpense() {
  $('expense-form').reset();
  $('file-preview').innerHTML = '';
  window._receipts      = [];
  window._originalFiles = [];
  window._docPreviewIndex = 0;
  _setDocPreviewEmptyState();
  const autofillBtn = $('autofill-btn-wrap');
  if (autofillBtn) autofillBtn.style.display = 'none';
  const batchNameInput = $('bulk-batch-name');
  if (batchNameInput) batchNameInput.value = '';
  _resetBulk();
  setExpenseMode('single');
  await Promise.all([_loadCategories(), _loadUsers(), _loadEmpresas()]);
  await _setupExpenseCompanyFields();
  showView('view-new-expense');
}

// ── Modo Individual ──
window._receipts      = [];
window._originalFiles = []; // archivos originales para OCR
window._docPreviewObjectUrl = null;

function _clearDocPreviewObjectUrl() {
  if (window._docPreviewObjectUrl) {
    URL.revokeObjectURL(window._docPreviewObjectUrl);
    window._docPreviewObjectUrl = null;
  }
}

function _setDocPreviewEmptyState() {
  const panel = $('doc-preview-panel');
  const content = $('doc-preview-content');
  const nameEl = $('doc-preview-name');
  const metaEl = $('doc-preview-meta');
  const openEl = $('doc-preview-open');
  const stripEl = $('doc-preview-strip');
  if (panel) panel.classList.add('hidden');
  if (content) {
    content.innerHTML = '<span class="doc-preview-empty"><strong>Adjunta un documento</strong>Se mostrara aqui una vista previa mas clara del respaldo antes de registrar la rendicion.</span>';
  }
  if (nameEl) nameEl.textContent = 'Adjunta un documento';
  if (metaEl) metaEl.textContent = 'Podras revisarlo aqui antes de registrar la rendicion.';
  if (openEl) {
    openEl.href = '#';
    openEl.classList.add('hidden');
  }
  if (stripEl) {
    stripEl.classList.add('hidden');
    stripEl.innerHTML = '';
  }
  _clearDocPreviewObjectUrl();
}

function selectDocPreview(index) {
  window._docPreviewIndex = index;
  _updateDocPreview();
}

function _renderDocPreviewStrip(files) {
  const stripEl = $('doc-preview-strip');
  if (!stripEl) return;
  if (!files.length) {
    stripEl.classList.add('hidden');
    stripEl.innerHTML = '';
    return;
  }
  stripEl.classList.remove('hidden');
  stripEl.innerHTML = files.map((file, index) => {
    const activeClass = index === window._docPreviewIndex ? ' is-active' : '';
    const typeLabel = (file.type || '').includes('pdf') ? 'PDF' : (file.type || '').startsWith('image/') ? 'Imagen' : 'Archivo';
    return `
      <button type="button" class="doc-preview-thumb${activeClass}" onclick="selectDocPreview(${index})">
        <span class="doc-preview-thumb-icon">${_receiptIcon(file.type || '')}</span>
        <span class="doc-preview-thumb-text">
          <span class="doc-preview-thumb-name">${_escapeHtml(file.name || `Adjunto ${index + 1}`)}</span>
          <span class="doc-preview-thumb-meta">${typeLabel} • ${_formatFileSize(file.size)}</span>
        </span>
      </button>`;
  }).join('');
}

async function handleFiles(input) {
  const preview = $('file-preview');
  const newFiles = Array.from(input.files);

  for (const file of newFiles) {
    const item = document.createElement('div');
    item.className = 'file-item file-uploading';
    item.innerHTML = `<div class="spinner"></div> Subiendo ${file.name}...`;
    preview.appendChild(item);
    try {
      const uploaded = await uploadFile(file);
      window._receipts.push(uploaded);
      window._originalFiles.push(file);
      item.className = 'file-item file-ok';
      item.innerHTML = `✅ ${file.name}`;
    } catch (e) {
      item.className = 'file-item file-error';
      item.innerHTML = `❌ ${file.name}: ${e.message}`;
      blockingAlert(`No se pudo subir el archivo "${file.name}": ${e.message}`);
    }
  }
  _updateDocPreview();
  const btn = $('autofill-btn-wrap');
  if (btn) btn.style.display = window._originalFiles.length ? 'flex' : 'none';
}

window._docPreviewIndex = 0;

function _showDocPreviewFile(file) {
  const panel = $('doc-preview-panel');
  const content = $('doc-preview-content');
  const nameEl = $('doc-preview-name');
  const metaEl = $('doc-preview-meta');
  const openEl = $('doc-preview-open');
  if (!panel || !content || !file) return;
  if (!_shouldShowDocPreviewPanel()) {
    panel.classList.add('hidden');
    _clearDocPreviewObjectUrl();
    return;
  }
  panel.classList.remove('hidden');
  _clearDocPreviewObjectUrl();
  const url = URL.createObjectURL(file);
  window._docPreviewObjectUrl = url;
  if (nameEl) nameEl.textContent = file.name || 'Documento adjunto';
  if (metaEl) {
    const typeLabel = (file.type || '').includes('pdf') ? 'PDF' : (file.type || '').startsWith('image/') ? 'Imagen' : (file.type || 'Archivo');
    metaEl.textContent = `${typeLabel} • ${_formatFileSize(file.size)} • ${window._docPreviewIndex + 1} de ${window._originalFiles.length}`;
  }
  if (openEl) {
    openEl.href = url;
    openEl.classList.remove('hidden');
  }
  if (file.type.startsWith('image/')) {
    content.innerHTML = `<div class="doc-preview-stage"><img src="${url}" alt="${_escapeHtml(file.name || 'Documento')}" loading="lazy"></div>`;
  } else if (file.type === 'application/pdf') {
    content.innerHTML = '<div class="doc-preview-stage"></div>';
    _renderPdfWithLoader(content.firstElementChild, url);
  } else {
    content.innerHTML = `<div class="doc-preview-stage"><div style="text-align:center;padding:20px"><div style="font-size:54px;margin-bottom:10px">${_receiptIcon(file.type || '')}</div><div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:6px">${_escapeHtml(file.name || 'Documento adjunto')}</div><div style="font-size:12px;color:#64748b">No hay vista previa inline para este formato, pero puedes abrirlo completo.</div></div></div>`;
  }
}

function _updateDocPreview() {
  const panel = $('doc-preview-panel');
  const nav = $('doc-preview-nav');
  const content = $('doc-preview-content');
  if (!panel || !content) return;
  if (!_shouldShowDocPreviewPanel()) {
    _setDocPreviewEmptyState();
    return;
  }
  const files = window._originalFiles;
  if (!files.length) {
    _setDocPreviewEmptyState();
    return;
  }
  if (window._docPreviewIndex >= files.length) window._docPreviewIndex = files.length - 1;
  if (nav) {
    nav.innerHTML = files.length > 1 ? `
      <button onclick="_docPreviewGo(-1)" ${window._docPreviewIndex === 0 ? 'disabled' : ''}
              class="doc-nav-btn">‹</button>
      <span class="doc-preview-counter">${window._docPreviewIndex + 1} / ${files.length}</span>
      <button onclick="_docPreviewGo(1)" ${window._docPreviewIndex === files.length - 1 ? 'disabled' : ''}
              class="doc-nav-btn">›</button>` : '';
  }
  _renderDocPreviewStrip(files);
  _showDocPreviewFile(files[window._docPreviewIndex]);
}

function _docPreviewGo(dir) {
  const len = window._originalFiles.length;
  window._docPreviewIndex = Math.max(0, Math.min(len - 1, window._docPreviewIndex + dir));
  _updateDocPreview();
}

async function autoFillBulkRow(rowId) {
  const file = window._bulkOriginalFiles?.get(rowId);
  if (!file) { toast('No hay archivo en esta fila para analizar', 'info'); return; }

  const btn = $(`bulk-autofill-${rowId}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }

  try {
    const data = await extractFromDocument(file);
    const row  = $(`bulk-row-${rowId}`);
    if (!row) return;

    const inputs  = row.querySelectorAll('input[type="text"], input[type="number"], input[type="date"]');
    const selects = row.querySelectorAll('select');
    // inputs order: concepto(0), fecha(1), monto(2), N°Doc(3), proveedor(4)
    // selects order: categoría(0), tipo doc(1)

    if (data.date)     inputs[1].value  = data.date;
    if (data.total)    setMoneyInputValue(inputs[2], Math.round(Number(data.total)));
    if (data.docNumber) inputs[3].value = data.docNumber;
    if (data.provider)  inputs[4].value = data.provider;

    if (data.docType) {
      const opts = ['BOLETA','FACTURA','BOUCHER','OTRO'];
      const match = opts.find(o => o === data.docType.toUpperCase());
      if (match) selects[1].value = match;
    }

    toast('Fila completada con IA — revisa antes de enviar', 'success');
  } catch (e) {
    toast('Error al analizar: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ IA'; }
  }
}

async function autoFillFromReceipt() {
  const file = window._originalFiles[0];
  if (!file) { toast('Primero sube un archivo para autocompletar', 'info'); return; }

  const btn = $('autofill-btn-wrap')?.querySelector('button');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analizando...'; }

  try {
    const data = await extractFromDocument(file);

    if (data.docType) {
      const sel = $('f-doctype');
      const opts = ['BOLETA','FACTURA','BOUCHER','OTRO'];
      const match = opts.find(o => o === data.docType.toUpperCase());
      if (match) sel.value = match;
    }
    if (data.docNumber) $('f-docnum').value   = data.docNumber;
    if (data.provider)  $('f-provider').value = data.provider;
    if (data.total)     setMoneyInputValue($('f-total'), Math.round(Number(data.total)));
    if (data.date)      $('f-date').value     = data.date;

    toast('Datos extraídos correctamente — revisa y ajusta si es necesario', 'success');
  } catch (e) {
    toast('No se pudo extraer datos: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Autocompletar con IA'; }
  }
}

function _getFondoDelMes(email) {
  const now = new Date();
  const mes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fondo = (state.fondoFijo || []).find(f =>
    f.email === email && f.month.substring(0, 7) === mes
  );
  if (!fondo) return null;
  const gastado = (state.expenses || [])
    .filter(e => e.email === email && e.fechaGasto.startsWith(mes) && e.status !== 'RECHAZADO')
    .reduce((s, e) => s + e.total, 0);
  return { fondo: fondo.monto, gastado, saldo: fondo.monto - gastado };
}

// Retorna null si ok, 'warn' si supera 80%, 'block' si supera 100%
function _checkFondoFijo(montoNuevo, extraGastado = 0) {
  const email = getCurrentUser()?.email?.toLowerCase();
  const ff = _getFondoDelMes(email);
  if (!ff) return null;
  const totalGastado = ff.gastado + extraGastado + montoNuevo;
  const pct = totalGastado / ff.fondo;
  if (pct > 1)    return { tipo: 'block', saldo: ff.saldo - extraGastado, pct: Math.round(pct * 100) };
  if (pct >= 0.8) return { tipo: 'warn',  saldo: ff.saldo - extraGastado, pct: Math.round(pct * 100) };
  return null;
}

function _checkDuplicateFolio(provider, docNumber, excludeExpenses = []) {
  if (!provider || !docNumber) return null;
  const prov = String(provider).trim().toLowerCase();
  const num  = String(docNumber).trim().toLowerCase();
  const existing = (state.expenses || []).find(e =>
    e.status !== 'RECHAZADO' &&
    String(e.provider || '').trim().toLowerCase() === prov &&
    String(e.docNumber || '').trim().toLowerCase() === num
  );
  if (existing) return existing;
  // Check within the provided list (for batch mode)
  const inBatch = excludeExpenses.find(e =>
    String(e.provider || '').trim().toLowerCase() === prov &&
    String(e.docNumber || '').trim().toLowerCase() === num
  );
  return inBatch || null;
}

async function submitExpense(ev) {
  ev.preventDefault();
  const f = ev.target;
  const empresa = _getSelectedExpenseCompany();
  if (!empresa) {
    toast('Selecciona una empresa', 'error');
    return;
  }
  const total = parseMoney(f.total.value);
  if (total <= 0) {
    toast('Ingresa un monto valido mayor a cero', 'error');
    return;
  }
  const exp = {
    fechaGasto:    f.fechaGasto.value,
    title:         f.title.value.trim(),
    category:      f.category.value,
    total,
    docType:       f.docType.value,
    docNumber:     f.docNumber.value.trim(),
    provider:      f.provider.value.trim(),
    notes:         f.notes.value.trim(),
    approverEmail: f.approverEmail.value,
    costCenter:    f.costCenter.value,
    receipts:      window._receipts || []
  };
  if (!exp.receipts.length) {
    blockingAlert('No se puede subir una rendición sin un archivo adjunto. Debes subir al menos un respaldo del gasto.');
    return;
  }
  const dup = _checkDuplicateFolio(exp.provider, exp.docNumber);
  if (dup) {
    blockingAlert(`Folio "${exp.docNumber}" ya existe para el proveedor "${exp.provider}".`);
    return;
  }
  const ffCheck = _checkFondoFijo(exp.total);
  if (ffCheck?.tipo === 'block') {
    if (!confirm(`Esta rendición excederá tu fondo asignado. Quedarás con un excedente de ${fmt(Math.abs(ffCheck.saldo - exp.total))}. ¿Continuar de todas formas?`)) return;
  } else if (ffCheck?.tipo === 'warn') {
    if (!confirm(`Esta rendición llevará tu fondo al ${ffCheck.pct}%. ¿Continuar?`)) return;
  }
  loading(true);
  try {
    await addExpense(exp, getCurrentUser().email, empresa);
    await addAudit('CREAR', getCurrentUser().email, { title: exp.title, total: exp.total });
    toast('Rendición registrada exitosamente', 'success');
    window._receipts = [];
    await navDashboard();
  } catch (e) {
    blockingAlert(e.message || 'No se pudo registrar la rendición.');
  } finally {
    loading(false);
  }
}

// ── Modo Múltiple ──
window._bulkRowCount    = 0;
window._bulkReceipts    = new Map(); // rowId → [uploaded files]
window._bulkUploading   = new Set(); // rowIds en proceso de subida

function setExpenseMode(mode) {
  const isSingle = mode === 'single';
  $('single-layout').classList.toggle('hidden', !isSingle);
  $('bulk-form').classList.toggle('hidden',    isSingle);
  $('btn-mode-single').classList.toggle('mode-btn-active', isSingle);
  $('btn-mode-bulk').classList.toggle('mode-btn-active',  !isSingle);
}

function _resetBulk() {
  window._bulkRowCount      = 0;
  window._bulkReceipts      = new Map();
  window._bulkOriginalFiles = new Map();
  window._bulkUploading     = new Set();
  const tbody = $('bulk-tbody');
  if (tbody) tbody.innerHTML = '';
  const empty = $('bulk-empty');
  if (empty) empty.classList.remove('hidden');
}

function _catOptions() {
  return state.categories.map(c => `<option>${c}</option>`).join('');
}

function _ccOptions() {
  return (state.costCenters || []).map(c => `<option>${c}</option>`).join('');
}

function addBulkRow() {
  const id = window._bulkRowCount++;
  window._bulkReceipts.set(id, []);

  const empty = $('bulk-empty');
  if (empty) empty.classList.add('hidden');

  const row = document.createElement('tr');
  row.id = `bulk-row-${id}`;
  row.className = 'bulk-row';
  row.innerHTML = `
    <td class="bulk-td" style="color:#9ca3af;font-size:12px;text-align:center">${id + 1}</td>
    <td class="bulk-td">
      <input type="text" class="input-field-sm" placeholder="Concepto" required>
    </td>
    <td class="bulk-td">
      <input type="date" class="input-field-sm" required>
    </td>
    <td class="bulk-td">
      <input type="text" class="input-field-sm" placeholder="$0" required style="width:100px" inputmode="numeric" data-money-input="true" autocomplete="off">
    </td>
    <td class="bulk-td">
      <select class="input-field-sm" required>
        <option value="">— Cat —</option>
        ${_catOptions()}
      </select>
    </td>
    <td class="bulk-td">
      <select class="input-field-sm bulk-cost-center-select">
        <option value="">— C. Costo —</option>
        ${_ccOptions()}
      </select>
    </td>
    <td class="bulk-td">
      <select class="input-field-sm" required>
        <option value="">— Tipo —</option>
        <option>BOLETA</option><option>FACTURA</option><option>BOUCHER</option><option>OTRO</option>
      </select>
    </td>
    <td class="bulk-td">
      <input type="text" class="input-field-sm" placeholder="N° Doc" style="width:90px">
    </td>
    <td class="bulk-td">
      <input type="text" class="input-field-sm" placeholder="Proveedor" style="width:130px">
    </td>
    <td class="bulk-td">
      <input type="text" class="input-field-sm" placeholder="Notas" style="width:140px">
    </td>
    <td class="bulk-td">
      <label class="btn-upload-sm" style="cursor:pointer">
        📎 Subir
        <input type="file" multiple accept="image/*,.pdf"
               onchange="handleBulkFiles(this,${id})" style="display:none">
      </label>
      <div id="bulk-status-${id}" class="bulk-file-status"></div>
      <button type="button" id="bulk-autofill-${id}"
              onclick="autoFillBulkRow(${id})"
              style="display:none;margin-top:4px;background:linear-gradient(135deg,#7c3aed,#6d28d9);
                     color:#fff;border:none;padding:3px 8px;border-radius:6px;font-size:11px;
                     cursor:pointer;width:100%">✨ IA</button>
    </td>
    <td class="bulk-td">
      <button type="button" class="btn-danger-sm" onclick="removeBulkRow(${id})" title="Eliminar fila">✕</button>
    </td>`;
  $('bulk-tbody').appendChild(row);
  bindMoneyInputs(row);
}

function removeBulkRow(id) {
  $(`bulk-row-${id}`)?.remove();
  window._bulkReceipts.delete(id);
  if (!$('bulk-tbody').children.length) {
    $('bulk-empty').classList.remove('hidden');
  }
}

async function handleBulkFiles(input, rowId) {
  const statusEl = $(`bulk-status-${rowId}`);
  window._bulkUploading.add(rowId);
  for (const file of Array.from(input.files)) {
    statusEl.textContent = `⏳ ${file.name}`;
    statusEl.style.color = '#2563eb';
    try {
      const uploaded = await uploadFile(file);
      const arr = window._bulkReceipts.get(rowId) || [];
      arr.push(uploaded);
      window._bulkReceipts.set(rowId, arr);
      // Guardar el primer archivo original para OCR
      if (!window._bulkOriginalFiles.has(rowId)) {
        window._bulkOriginalFiles.set(rowId, file);
      }
      statusEl.textContent = `✅ ${arr.length} archivo(s)`;
      statusEl.style.color = '#15803d';
      // Mostrar botón ✨ IA
      const btn = $(`bulk-autofill-${rowId}`);
      if (btn) btn.style.display = 'block';
    } catch (e) {
      statusEl.textContent = `❌ ${e.message}`;
      statusEl.style.color = '#dc2626';
      blockingAlert(`No se pudo subir el archivo "${file.name}" en la fila ${rowId + 1}: ${e.message}`);
    }
  }
  window._bulkUploading.delete(rowId);
}

async function submitBulk() {
  if (window._bulkUploading.size > 0) {
    toast('Espera a que terminen de subir los archivos', 'info');
    return;
  }
  const batchName = $('bulk-batch-name').value.trim();
  if (!batchName) { toast('Ingresa un nombre para el conjunto', 'error'); return; }
  const empresa = ($('bulk-company')?.value || '').trim();
  if (!empresa) { toast('Selecciona una empresa para el conjunto', 'error'); return; }

  const rows = Array.from($('bulk-tbody').querySelectorAll('tr.bulk-row'));
  if (!rows.length) { toast('Agrega al menos una fila', 'error'); return; }

  const approverEmail = $('bulk-approver').value;
  const userEmail     = getCurrentUser().email;
  const expenses = [];

  for (const row of rows) {
    const inputs     = row.querySelectorAll('input, select');
    const id         = parseInt(row.id.replace('bulk-row-', ''));
    const textInputs = Array.from(inputs).filter(i => i.type !== 'file');
    const [title, fechaGasto, total, category, costCenter, docType, docNumber, provider, notes] =
      textInputs.map(i => i.value.trim());

    if (!title || !fechaGasto || !total || !category || !docType) {
      toast('Completa todos los campos obligatorios en cada fila', 'error');
      return;
    }
    const parsedTotal = parseMoney(total);
    if (parsedTotal <= 0) {
      toast('Ingresa un monto valido mayor a cero en cada fila', 'error');
      return;
    }
    expenses.push({
      title, fechaGasto, total: parsedTotal,
      category, costCenter, docType, docNumber, provider,
      notes: notes || '', approverEmail, batchName,
      receipts: window._bulkReceipts.get(id) || []
    });
    if (!expenses[expenses.length - 1].receipts.length) {
      blockingAlert(`No se puede subir una rendición sin un archivo adjunto. La fila ${id + 1} no tiene respaldo cargado.`);
      return;
    }
  }

  // Validate folio duplicates (system-wide + within batch)
  const seen = [];
  for (const exp of expenses) {
    const dup = _checkDuplicateFolio(exp.provider, exp.docNumber, seen);
    if (dup) {
      blockingAlert(`Folio "${exp.docNumber}" duplicado para el proveedor "${exp.provider}".`);
      return;
    }
    if (exp.provider && exp.docNumber) seen.push(exp);
  }

  // Validate fondo fijo for the full batch total
  const bulkTotal  = expenses.reduce((s, e) => s + e.total, 0);
  const ffBulk     = _checkFondoFijo(bulkTotal);
  if (ffBulk?.tipo === 'block') {
    if (!confirm(`Este conjunto excederá tu fondo asignado. Quedarás con un excedente de ${fmt(Math.abs(ffBulk.saldo - bulkTotal))}. ¿Continuar de todas formas?`)) return;
  } else if (ffBulk?.tipo === 'warn') {
    if (!confirm(`Este conjunto llevará tu fondo al ${ffBulk.pct}%. ¿Continuar?`)) return;
  }

  loading(true);
  try {
    for (const exp of expenses) {
      await addExpense(exp, userEmail, empresa);
    }
    await addAudit('CREAR_CONJUNTO', userEmail, { batchName, count: expenses.length });
    toast(`Conjunto "${batchName}" registrado con ${expenses.length} rendiciones`, 'success');
    _resetBulk();
    await navDashboard();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading(false);
  }
}

// ─── REPORTES ─────────────────────────────────
const _repCharts = {};

async function navReportes() {
  const mc = $('main-content');
  if (!$('view-reportes')) {
    const html = await fetch('./views/reportes.html').then(r => r.text());
    mc.insertAdjacentHTML('beforeend', html);
  }
  showView('view-reportes');
  loading(true);
  try {
    const all = await getExpenses();
    _mergeExpenses(all);

    // Filtro empresa: GERENTE solo ve su alcance permitido
    const esGerente = state.role === 'GERENTE' && !_canViewAllCompanies();
    const empWrap   = $('rep-empresa-wrap');
    if (empWrap) empWrap.classList.toggle('hidden', esGerente);

    const empSel = $('rep-empresa');
    if (empSel && !esGerente) {
      empSel.innerHTML = '<option value="">Todas</option>' +
        state.empresas.map(e => `<option value="${e.nombre}">${e.nombre}</option>`).join('');
    }

    // Gráfica por empresa: solo ADMIN/SUPERADMIN
    const empChart = $('rep-empresa-chart-wrap');
    if (empChart) empChart.classList.toggle('hidden', esGerente);

    // Fechas por defecto: últimos 6 meses
    const now   = new Date();
    const hasta = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const desde = (() => {
      const d = new Date(now); d.setMonth(d.getMonth() - 5);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    if ($('rep-desde') && !$('rep-desde').value) $('rep-desde').value = desde;
    if ($('rep-hasta') && !$('rep-hasta').value) $('rep-hasta').value = hasta;

    renderReportes();
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

function renderReportes() {
  const empresa = (state.role === 'GERENTE' && !_canViewAllCompanies())
    ? _getManagerCompanyScope()
    : ($('rep-empresa')?.value || '');
  const desde  = $('rep-desde')?.value  || '';
  const hasta  = $('rep-hasta')?.value  || '';
  const estado = $('rep-estado')?.value || '';

  let exps = state.expenses.filter(e => {
    if (empresa && e.empresa !== empresa) return false;
    if (estado  && e.status  !== estado)  return false;
    const mes = (e.fechaGasto || '').substring(0, 7);
    if (desde && mes < desde) return false;
    if (hasta && mes > hasta) return false;
    return true;
  });

  // KPIs
  const total    = exps.reduce((s, e) => s + e.total, 0);
  const count    = exps.length;
  const avg      = count ? Math.round(total / count) : 0;
  const empleados = new Set(exps.map(e => e.email)).size;
  $('rep-total').textContent    = fmt(total);
  $('rep-count').textContent    = count;
  $('rep-avg').textContent      = fmt(avg);
  $('rep-empleados').textContent = empleados;

  // Paleta
  const palette = ['#1e40af','#7c3aed','#0891b2','#16a34a','#d97706','#dc2626','#6b7280','#0d9488','#9333ea','#ea580c'];

  // ── Gráfica: por categoría ──
  const byCat = {};
  exps.forEach(e => { byCat[e.category || 'Sin categoría'] = (byCat[e.category || 'Sin categoría'] || 0) + e.total; });
  _drawChart('chart-categorias', 'doughnut', Object.keys(byCat), Object.values(byCat), palette);

  // ── Gráfica: por centro de costo ──
  const byCC = {};
  exps.forEach(e => { if (e.costCenter) byCC[e.costCenter] = (byCC[e.costCenter] || 0) + e.total; });
  const ccLabels = Object.keys(byCC).sort((a, b) => byCC[b] - byCC[a]);
  _drawChart('chart-centros', 'bar', ccLabels, ccLabels.map(k => byCC[k]), palette, true);

  // ── Gráfica: evolución mensual ──
  const byMes = {};
  exps.forEach(e => {
    const m = (e.fechaGasto || '').substring(0, 7);
    if (m) byMes[m] = (byMes[m] || 0) + e.total;
  });
  const mesLabels = Object.keys(byMes).sort();
  _drawChart('chart-mensual', 'line', mesLabels, mesLabels.map(k => byMes[k]), [palette[0]]);

  // ── Gráfica: por empresa (solo admin) ──
  if (state.role !== 'GERENTE' || _canViewAllCompanies()) {
    const byEmp = {};
    exps.forEach(e => { const k = e.empresa || 'Sin empresa'; byEmp[k] = (byEmp[k] || 0) + e.total; });
    _drawChart('chart-empresas', 'bar', Object.keys(byEmp), Object.values(byEmp), palette);
  }

  // ── Ranking y tabla por rendidor ──
  const byRend = {};
  exps.forEach(e => {
    const key = e.email || 'desconocido';
    if (!byRend[key]) byRend[key] = { name: _getUserName(e.email), total: 0, count: 0, pendiente: 0, aprobado: 0, autorizado: 0, rechazado: 0, pendientePago: 0, pagado: 0 };
    byRend[key].total += e.total;
    byRend[key].count++;
    if (e.status === 'PENDIENTE')  byRend[key].pendiente++;
    if (e.status === 'APROBADO')   byRend[key].aprobado++;
    if (e.status === 'AUTORIZADO') byRend[key].autorizado++;
    if (e.status === 'RECHAZADO')  byRend[key].rechazado++;
    const ps = _getPaymentStatus(e);
    if (ps === 'PENDIENTE_PAGO' || ps === 'EN_PREPARACION_PAGO') byRend[key].pendientePago++;
    if (ps === 'PAGADO') byRend[key].pagado++;
  });

  const rendKeys = Object.keys(byRend).sort((a, b) => byRend[b].total - byRend[a].total);
  const maxTotal = rendKeys.length ? byRend[rendKeys[0]].total : 1;

  // Gráfica: top 15
  const top15 = rendKeys.slice(0, 15);
  const chartWrap = $('rep-rendidor-chart-wrap');
  if (chartWrap) chartWrap.style.height = Math.max(180, top15.length * 36) + 'px';
  const chartNote = $('rep-rendidor-chart-note');
  if (chartNote) chartNote.textContent = rendKeys.length > 15 ? `(Top 15 de ${rendKeys.length})` : '';
  _drawChart('chart-rendidores', 'bar', top15.map(k => byRend[k].name), top15.map(k => byRend[k].total), palette, true);

  // Tabla detallada
  const rendTbody = $('rep-rendidor-tbody');
  if (rendTbody) {
    if (!rendKeys.length) {
      rendTbody.innerHTML = '<tr><td colspan="9" class="empty-row">Sin datos para el período seleccionado</td></tr>';
    } else {
      rendTbody.innerHTML = rendKeys.map(key => {
        const r = byRend[key];
        const pct = maxTotal > 0 ? Math.round((r.total / maxTotal) * 100) : 0;
        const cell = (val, color) => val
          ? `<span style="font-weight:600;color:${color}">${val}</span>`
          : `<span style="color:#d1d5db">—</span>`;
        return `<tr>
          <td class="td td-bold">${_escapeHtml(r.name)}<div style="font-size:11px;color:#9ca3af;font-weight:400">${_escapeHtml(key)}</div></td>
          <td class="td" style="min-width:140px">
            <div style="font-weight:700;color:#111827">${fmt(r.total)}</div>
            <div style="background:#f3f4f6;border-radius:3px;height:5px;margin-top:5px;overflow:hidden">
              <div style="background:#1e40af;height:100%;width:${pct}%;border-radius:3px;transition:width .4s"></div>
            </div>
          </td>
          <td class="td td-muted" style="text-align:center">${r.count}</td>
          <td class="td" style="text-align:center">${cell(r.pendiente,  '#d97706')}</td>
          <td class="td" style="text-align:center">${cell(r.aprobado,   '#0891b2')}</td>
          <td class="td" style="text-align:center">${cell(r.autorizado, '#16a34a')}</td>
          <td class="td" style="text-align:center">${cell(r.rechazado,  '#dc2626')}</td>
          <td class="td" style="text-align:center">${cell(r.pendientePago, '#d97706')}</td>
          <td class="td" style="text-align:center">${cell(r.pagado,     '#16a34a')}</td>
        </tr>`;
      }).join('');
    }
  }
}

function _drawChart(id, type, labels, data, palette, horizontal = false) {
  const canvas = $(id);
  if (!canvas) return;
  if (_repCharts[id]) { _repCharts[id].destroy(); }

  const colors = labels.map((_, i) => palette[i % palette.length]);

  _repCharts[id] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: type === 'line' ? 'rgba(30,64,175,.12)' : colors,
        borderColor:     type === 'line' ? palette[0] : colors,
        borderWidth:     type === 'line' ? 2 : 0,
        fill:            type === 'line',
        pointRadius:     type === 'line' ? 4 : 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: horizontal ? 'y' : 'x',
      plugins: {
        legend: { display: type === 'doughnut', position: 'bottom',
          labels: { font: { size: 11 }, padding: 12, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v = ctx.raw || 0;
              return ' $' + Number(v).toLocaleString('es-CL');
            }
          }
        }
      },
      scales: type !== 'doughnut' ? {
        x: { grid: { display: !horizontal }, ticks: { font: { size: 11 } } },
        y: { grid: { display: horizontal },  ticks: { font: { size: 11 },
          callback: v => horizontal ? v : '$' + Number(v).toLocaleString('es-CL') } }
      } : {}
    }
  });
}

// ─── TUTORIAL ─────────────────────────────────
async function navTutorial() {
  const mc = $('main-content');
  if (!$('view-tutorial')) {
    const html = await fetch('./views/tutorial.html').then(r => r.text());
    mc.insertAdjacentHTML('beforeend', html);
  }
  showView('view-tutorial');
}

// ─── ADMINISTRACIÓN ───────────────────────────
async function navAdmin() {
  showView('view-admin');
  await showAdminTab('tab-users');
}

async function showAdminTab(tab) {
  document.querySelectorAll('.admin-tab-btn').forEach(b =>
    b.classList.toggle('admin-tab-active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.admin-tab').forEach(t =>
    t.classList.toggle('hidden', t.id !== tab)
  );
  if (tab === 'tab-users')        await _loadAdminUsers();
  if (tab === 'tab-categories')  await _loadAdminCats();
  if (tab === 'tab-costcenters') await _loadAdminCostCenters();
  if (tab === 'tab-fondo-fijo')  await _loadAdminFondoFijo();
  if (tab === 'tab-config')      _loadGeminiKeyStatus();
  if (tab === 'tab-empresas')    await _loadAdminEmpresas();
}

async function _loadGeminiKeyStatus() {
  const status = $('gemini-key-status');
  if (!status) return;
  status.innerHTML = '<span style="color:#6b7280">Verificando...</span>';
  const key = await getGeminiKey();
  if (key) {
    status.innerHTML = '<span style="color:#16a34a">✅ Clave configurada — todos los usuarios pueden usar el autocompletar</span>';
  } else {
    status.innerHTML = '<span style="color:#d97706">⚠️ Sin clave configurada — el autocompletar con IA no funcionará</span>';
  }
}

async function saveGeminiKey() {
  const val = $('gemini-key-input').value.trim();
  if (!val) { toast('Ingresa una clave válida', 'error'); return; }
  loading(true);
  try {
    await setGeminiKey(val);
    $('gemini-key-input').value = '';
    await _loadGeminiKeyStatus();
    toast('Clave Gemini guardada para todos los usuarios', 'success');
  } catch (e) {
    toast('Error al guardar: ' + e.message, 'error');
  } finally {
    loading(false);
  }
}

const ALL_ROLES = ['RENDIDOR', 'APROBADOR', 'GERENTE', 'ADMIN', 'SUPERADMIN'];

async function _loadAdminUsers() {
  const users = await getUsers();
  const isSuperAdmin = state.role === 'SUPERADMIN';
  $('users-tbody').innerHTML = users.length
    ? users.map((u, i) => {
        const isSA      = u.role === 'SUPERADMIN';
        const canEdit   = isSuperAdmin || !isSA;
        const rolesOpts = (isSuperAdmin ? ALL_ROLES : ALL_ROLES.filter(r => r !== 'SUPERADMIN'))
          .map(r => `<option ${u.role===r?'selected':''}>${r}</option>`).join('');
        return `
        <tr class="table-row">
          <td class="td">${u.email}${isSA ? ' <span style="font-size:10px;background:#1e40af;color:#fff;padding:1px 6px;border-radius:8px">SUPERADMIN</span>' : ''}</td>
          <td class="td">${u.nombre || '—'}</td>
          <td class="td">${u.apellido || '—'}</td>
          <td class="td">
            ${canEdit
              ? `<select onchange="updateUserRole(${i+2}, this.value)" class="select-sm">${rolesOpts}</select>`
              : `<span class="badge badge-gray">${u.role}</span>`}
          </td>
          <td class="td">
            ${canEdit
              ? `<input type="email" value="${u.notifyEmail || ''}" placeholder="correo@empresa.com"
                   class="input-field" style="width:170px;margin:0;font-size:12px"
                   onblur="saveNotifyEmail(${i+2}, this.value)">`
              : (u.notifyEmail || '—')}
          </td>
          <td class="td">
            ${canEdit
              ? `<select class="select-sm" onchange="saveEmpresaUsuario(${i+2}, this.value)">
                  <option value="">— Sin empresa —</option>
                  ${state.empresas.map(e => `<option value="${e.nombre}" ${u.empresa===e.nombre?'selected':''}>${e.nombre}</option>`).join('')}
                </select>`
              : (u.empresa || '—')}
          </td>
          <td class="td">
            ${canEdit
              ? `<button onclick="changePassword(${i+2})" class="btn-secondary" style="font-size:12px;padding:4px 10px">Cambiar clave</button>`
              : '—'}
          </td>
          <td class="td">
            ${canEdit
              ? `<button onclick="deleteUser(${i+2})" class="btn-danger-sm">Eliminar</button>`
              : '—'}
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="8" class="empty-row">Sin usuarios registrados</td></tr>';
}

async function addUser() {
  const email    = prompt('Email o usuario de login:')?.toLowerCase().trim();
  if (!email) return;
  const nombre   = prompt('Nombre:')?.trim() || '';
  const apellido = prompt('Apellido:')?.trim() || '';
  const rolesDisp = state.role === 'SUPERADMIN' ? ALL_ROLES : ALL_ROLES.filter(r => r !== 'SUPERADMIN');
  const role = prompt(`Rol (${rolesDisp.join(' / ')}):`, 'RENDIDOR')?.toUpperCase().trim();
  if (!rolesDisp.includes(role)) { toast('Rol inválido', 'error'); return; }
  const password    = prompt('Contraseña inicial:')?.trim();
  if (!password) { toast('Debes ingresar una contraseña', 'error'); return; }
  const notifyEmail = prompt('Email para notificaciones (dejar vacío si el login ya es un email):')?.trim() || '';
  const empresaOpts = state.empresas.map(e => e.nombre).join(' / ');
  const empresa     = prompt(`Empresa (${empresaOpts || 'nombre empresa'}):`)?.trim() || '';
  loading(true);
  try {
    await sheetsAppend('Usuarios', [email, role, nombre, apellido, password, notifyEmail, empresa]);
    state.users = await getUsers();
    await _loadAdminUsers();
    toast('Usuario agregado', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function saveEmpresaUsuario(rowIndex, value) {
  try {
    await sheetsBatchUpdate([{ range: `Usuarios!G${rowIndex}`, values: [[value]] }]);
    state.users = await getUsers();
    toast(value ? `Empresa asignada: ${value}` : 'Empresa eliminada', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function saveNotifyEmail(rowIndex, value) {
  const email = value.trim();
  if (email && !email.includes('@')) {
    toast('Ingresa un email válido para notificaciones', 'error'); return;
  }
  try {
    await sheetsBatchUpdate([{ range: `Usuarios!F${rowIndex}`, values: [[email]] }]);
    state.users = await getUsers();
    toast(email ? 'Email de notificación guardado' : 'Email de notificación eliminado', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function changeOwnPassword() {
  const current = prompt('Contraseña actual:');
  if (current === null) return;
  const newPass = prompt('Nueva contraseña (mínimo 6 caracteres):');
  if (newPass === null) return;
  const confirm_ = prompt('Repite la nueva contraseña:');
  if (confirm_ === null) return;
  if (newPass !== confirm_) { toast('Las contraseñas no coinciden', 'error'); return; }
  loading(true);
  try {
    const res = await callBackend('changeOwnPassword', { currentPassword: current, newPassword: newPass });
    if (!res.ok) throw new Error(res.error);
    toast('Contraseña actualizada correctamente', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function changePassword(rowIndex) {
  const newPass = prompt('Nueva contraseña para este usuario:')?.trim();
  if (!newPass) return;
  loading(true);
  try {
    await callBackend('setPassword', { rowIndex, password: newPass });
    toast('Contraseña actualizada', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function updateUserRole(rowIndex, role) {
  if (role === 'SUPERADMIN' && state.role !== 'SUPERADMIN') {
    toast('Solo un SUPERADMIN puede asignar ese rol', 'error'); return;
  }
  loading(true);
  try {
    await sheetsBatchUpdate([{ range: `Usuarios!B${rowIndex}`, values: [[role]] }]);
    state.users = await getUsers();
    toast('Rol actualizado', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function deleteUser(rowIndex) {
  if (!confirm('¿Eliminar este usuario?')) return;
  loading(true);
  try {
    await sheetsBatchUpdate([{ range: `Usuarios!A${rowIndex}:D${rowIndex}`, values: [['','','','']] }]);
    await _loadAdminUsers();
    toast('Usuario eliminado', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function _loadAdminCats() {
  const cats = await getCategories();
  $('cats-list').innerHTML = cats.length
    ? cats.map((c, i) => `
        <div class="cat-item">
          <span>${c}</span>
          <button onclick="deleteCategory(${i+2})" class="btn-danger-sm">Eliminar</button>
        </div>`).join('')
    : '<p class="text-muted" style="padding:16px">Sin categorías</p>';
}

async function addCategory() {
  const name = prompt('Nueva categoría:')?.trim();
  if (!name) return;
  loading(true);
  try {
    await sheetsAppend('Categorias', [name]);
    state.categories = await getCategories();
    await _loadAdminCats();
    _fillSelect('form-category', state.categories.map(c => ({ val: c, label: c })), '— Categoría —');
    toast('Categoría agregada', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function deleteCategory(rowIndex) {
  if (!confirm('¿Eliminar esta categoría?')) return;
  loading(true);
  try {
    await sheetsBatchUpdate([{ range: `Categorias!A${rowIndex}`, values: [['']] }]);
    state.categories = await getCategories();
    await _loadAdminCats();
    toast('Categoría eliminada', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function _loadAdminCostCenters() {
  const ccs = await getCostCenters();
  $('cc-list').innerHTML = ccs.length
    ? ccs.map((c, i) => `
        <div class="cat-item">
          <span>${c}</span>
          <button onclick="deleteCostCenter(${i+2})" class="btn-danger-sm">Eliminar</button>
        </div>`).join('')
    : '<p class="text-muted" style="padding:16px">Sin centros de costo</p>';
}

async function addCostCenter() {
  const name = prompt('Nuevo centro de costo:')?.trim();
  if (!name) return;
  loading(true);
  try {
    await sheetsAppend('CentrosCosto', [name]);
    state.costCenters = await getCostCenters();
    await _loadAdminCostCenters();
    _fillSelect('form-cost-center', state.costCenters.map(c => ({ val: c, label: c })), '— Centro de Costo —');
    toast('Centro de costo agregado', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function deleteCostCenter(rowIndex) {
  if (!confirm('¿Eliminar este centro de costo?')) return;
  loading(true);
  try {
    await sheetsBatchUpdate([{ range: `CentrosCosto!A${rowIndex}:B${rowIndex}`, values: [['', '']] }]);
    state.costCenters = await getCostCenters(state.empresaUsuario);
    if ($('cc-list')) await _loadAdminCostCenters();
    if ($('empresas-admin-list')) await _loadAdminEmpresas();
    toast('Centro de costo eliminado', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function _loadAdminEmpresas() {
  const container = $('empresas-admin-list');
  if (!container) return;
  let empresas, costCenters;
  try {
    [empresas, costCenters] = await Promise.all([getEmpresasFull(), getCostCentersFull()]);
  } catch (e) {
    container.innerHTML = `<p style="color:#ef4444;padding:16px">Error al cargar empresas: ${e.message}</p>`;
    return;
  }

  if (!empresas.length) {
    container.innerHTML = '<p class="text-muted" style="padding:16px">Sin empresas registradas. Agrega una con el botón de arriba.</p>';
    return;
  }

  container.innerHTML = empresas.map(emp => {
    const ccs = costCenters.filter(c => c.empresa === emp.nombre);
    const safeNombre = emp.nombre.replace(/'/g, "\\'");
    return `
      <div class="empresa-admin-card">
        <div class="empresa-admin-header">
          <div>
            <div class="empresa-admin-nombre">${emp.nombre}</div>
            <div class="empresa-admin-rut">RUT: ${emp.rut || '—'}</div>
          </div>
          <button onclick="deleteEmpresa(${emp.rowIndex},'${safeNombre}')" class="btn-danger-sm">Eliminar empresa</button>
        </div>
        <div class="empresa-admin-cc-header">
          <span style="font-size:13px;font-weight:600;color:#374151">Centros de Costo (${ccs.length})</span>
          <button class="btn-secondary" style="font-size:12px;padding:4px 12px"
                  onclick="addCostCenterToEmpresa('${safeNombre}')">+ Agregar</button>
        </div>
        <div class="empresa-admin-cc-list">
          ${ccs.length
            ? ccs.map(c => `
                <div class="cat-item">
                  <span>${c.name}</span>
                  <button onclick="deleteCostCenter(${c.rowIndex})" class="btn-danger-sm">Eliminar</button>
                </div>`).join('')
            : '<p class="text-muted" style="padding:8px 0;font-size:13px">Sin centros de costo. Agrega uno con el botón de arriba.</p>'
          }
        </div>
      </div>`;
  }).join('');
}

async function addEmpresa() {
  const nombre = prompt('Nombre de la empresa:')?.trim();
  if (!nombre) return;
  const rut = prompt('RUT (opcional, deja vacío si no aplica):')?.trim() || '';
  loading(true);
  try {
    await sheetsAppend('Empresas Grupo', [nombre, rut]);
    state.empresas = await getEmpresas();
    await _loadAdminEmpresas();
    toast('Empresa agregada', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function deleteEmpresa(rowIndex, nombre) {
  if (!confirm(`¿Eliminar la empresa "${nombre}"?\n\nSus centros de costo asociados quedarán sin empresa asignada.`)) return;
  loading(true);
  try {
    await sheetsBatchUpdate([{ range: `Empresas Grupo!A${rowIndex}:B${rowIndex}`, values: [['', '']] }]);
    state.empresas = await getEmpresas();
    await _loadAdminEmpresas();
    toast('Empresa eliminada', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function addCostCenterToEmpresa(empresa) {
  const name = prompt(`Nuevo centro de costo para "${empresa}":`)?.trim();
  if (!name) return;
  loading(true);
  try {
    await sheetsAppend('CentrosCosto', [name, empresa]);
    state.costCenters = await getCostCenters(state.empresaUsuario);
    await _loadAdminEmpresas();
    toast('Centro de costo agregado', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function _loadAdminFondoFijo() {
  const picker = $('ff-month-picker');
  if (!picker) return;
  if (!picker.value) {
    const now = new Date();
    picker.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const selectedMonth = picker.value;

  const [fondos, users] = await Promise.all([getFondoFijo(), getUsers()]);
  const tbody = $('fondo-fijo-tbody');
  if (!tbody) return;
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-row">Sin usuarios registrados</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const fondo = fondos.find(f => f.email === u.email && f.month === selectedMonth);
    const monto = fondo ? fondo.monto : '';
    return `
      <tr class="table-row">
        <td class="td">
          <div style="font-weight:600">${u.displayName || u.email}</div>
          <div style="font-size:11px;color:#6b7280">${u.email}</div>
        </td>
        <td class="td td-muted">${u.role}</td>
        <td class="td">
             <input id="ff-input-${u.email.replace(/[@.]/g,'_')}"
               type="text"
               value="${formatMoneyInputValue(monto)}"
                 placeholder="Sin fondo"
               class="input-field" style="width:160px;margin:0"
               inputmode="numeric" data-money-input="true" autocomplete="off">
        </td>
        <td class="td">
          <button onclick="saveFondoFijo('${u.email}')"
                  class="btn-primary" style="font-size:12px;padding:5px 14px">
            Guardar
          </button>
        </td>
      </tr>`;
  }).join('');
  bindMoneyInputs(tbody);
}

async function saveFondoFijo(email) {
  const month = $('ff-month-picker')?.value;
  if (!month) { toast('Selecciona un mes', 'error'); return; }
  const inputId = 'ff-input-' + email.replace(/[@.]/g, '_');
  const val     = $(inputId)?.value.trim();
  const monto   = parseMoney(val);
  loading(true);
  try {
    if (!val || monto <= 0) {
      const fondos = await getFondoFijo();
      const found  = fondos.find(f => f.email === email && f.month === month);
      if (found) {
        await deleteFondoFijo(found.rowIndex);
        toast('Fondo fijo eliminado', 'success');
      } else {
        toast('Este usuario no tiene fondo asignado para este mes', 'info');
      }
    } else {
      await setFondoFijo(email, month, monto);
      toast(`Fondo de ${fmt(monto)} guardado para ${month}`, 'success');
    }
    state.fondoFijo = await getFondoFijo();
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

// ─── CONTABILIDAD ─────────────────────────────
// Cache de los documentos autorizados filtrados actualmente visibles
let _contaData = [];
let _contaFiltered = [];
const _contaSelection = new Set();

async function navContabilidad() {
  loading(true);
  try {
    showView('view-contabilidad');
    const [all, payments] = await Promise.all([getExpenses(), getPayments()]);
    _mergeExpenses(all);
    state.payments = payments;

    // Solo rendiciones AUTORIZADAS
    _contaData = all.filter(e => e.status === 'AUTORIZADO');
    _contaSelection.clear();

    // Poblar filtro de categorías
    const cats = [...new Set(_contaData.map(e => e.category).filter(Boolean))].sort();
    const catSel = $('conta-filter-cat');
    catSel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option>${c}</option>`).join('');

    // Poblar filtro de rendidores
    const rendEmails = [...new Set(_contaData.map(e => e.email).filter(Boolean))].sort();
    const rendSel = $('conta-filter-rendidor');
    rendSel.innerHTML = '<option value="">Todos los rendidores</option>' +
      rendEmails.map(em => `<option value="${em}">${_getUserName(em)}</option>`).join('');

    if ($('conta-pay-date') && !$('conta-pay-date').value) {
      $('conta-pay-date').value = new Date().toISOString().split('T')[0];
    }

    filterConta();
    _renderPaymentBatches();
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

function filterConta() {
  const q        = $('conta-search').value.toLowerCase();
  const tipo     = $('conta-filter-tipo').value;
  const cat      = $('conta-filter-cat').value;
  const pago     = $('conta-filter-pago').value;
  const rendidor = $('conta-filter-rendidor').value;
  const desde    = $('conta-filter-desde').value;
  const hasta    = $('conta-filter-hasta').value;

  const all = state.expenses.filter(e => e.status === 'AUTORIZADO');
  const filtered = all.filter(e => {
    const paymentStatus = _getPaymentStatus(e);
    if (q && !`${e.docNumber} ${e.provider} ${e.title} ${e.category} ${e.email}`.toLowerCase().includes(q)) return false;
    if (tipo     && e.docType !== tipo)          return false;
    if (cat      && e.category !== cat)          return false;
    if (pago     && paymentStatus !== pago)       return false;
    if (rendidor && e.email !== rendidor)         return false;
    if (desde    && e.fechaGasto < desde)         return false;
    if (hasta    && e.fechaGasto > hasta)         return false;
    return true;
  });
  _renderConta(filtered);
}

function _renderConta(exps) {
  _contaFiltered = exps;
  // ── KPIs ──
  const total    = exps.reduce((s, e) => s + e.total, 0);
  const boletas  = exps.filter(e => e.docType === 'BOLETA').length;
  const facturas = exps.filter(e => e.docType === 'FACTURA').length;
  const pending  = exps.filter(e => _getPaymentStatus(e) === 'PENDIENTE_PAGO').length;
  const preparing = exps.filter(e => _getPaymentStatus(e) === 'EN_PREPARACION_PAGO').length;
  const paid     = exps.filter(e => _getPaymentStatus(e) === 'PAGADO').length;

  $('conta-kpi-count').textContent   = exps.length;
  $('conta-kpi-total').textContent   = fmt(total);
  $('conta-kpi-pending').textContent = pending;
  $('conta-kpi-preparing').textContent = preparing;
  $('conta-kpi-paid').textContent    = paid;
  $('conta-kpi-boleta').textContent  = boletas;
  $('conta-kpi-factura').textContent = facturas;
  $('conta-subtitle').textContent    = exps.length
    ? `${exps.length} documento${exps.length > 1 ? 's' : ''} autorizado${exps.length > 1 ? 's' : ''} · ${pending} pendiente${pending === 1 ? '' : 's'} · ${preparing} en preparación`
    : 'Sin documentos autorizados';

  _renderContaSelectionSummary();

  // ── Tabla principal ──
  const tbody = $('conta-tbody');
  if (!exps.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-row">Sin documentos autorizados</td></tr>';
  } else {
    tbody.innerHTML = exps.map(e => `
      <tr class="table-row" onclick="openDetail(${e.rowIndex},'dashboard')">
        <td class="td" onclick="event.stopPropagation()">
          ${_canSelectPaymentStatus(_getPaymentStatus(e))
            ? `<input type="checkbox" class="conta-check"
                 ${_contaSelection.has(e.rowIndex) ? 'checked' : ''}
                 onchange="toggleContaSelection(${e.rowIndex})">`
            : '<span style="color:#d1d5db;font-size:11px;cursor:default" title="No disponible para pago">—</span>'}
        </td>
        <td class="td td-bold conta-folio">${e.docNumber || '—'}</td>
        <td class="td">${fmtDate(e.fechaGasto)}</td>
        <td class="td"><span class="tag">${e.docType}</span></td>
        <td class="td td-bold">${e.provider || '—'}</td>
        <td class="td td-muted">${e.category}</td>
        <td class="td">${e.title}</td>
        <td class="td td-muted">${_getUserName(e.email)}</td>
        <td class="td td-bold" style="color:#111827">${fmt(e.total)}</td>
        <td class="td">${_paymentBadge(_getPaymentStatus(e), e.paymentBatchId)}</td>
        <td class="td td-muted">${e.paymentDate ? fmtDate(e.paymentDate) : '—'}</td>
        <td class="td td-muted" style="font-size:12px">${_getUserName(e.approverEmail)}</td>
        <td class="td">
          ${e.receipts?.length
            ? e.receipts.map(r => `<button type="button" class="conta-file-link" style="background:none;border:none;cursor:pointer" onclick='event.stopPropagation();openReceipt(${JSON.stringify(r)})'>📎</button>`).join(' ')
            : '<span class="text-muted">—</span>'}
        </td>
      </tr>`).join('');
  }

  // ── Resumen por categoría ──
  const byCat = _groupAndSum(exps, 'category');
  $('conta-by-cat').innerHTML = _renderBreakdown(byCat, total);

  // ── Resumen por tipo ──
  const byTipo = _groupAndSum(exps, 'docType');
  $('conta-by-tipo').innerHTML = _renderBreakdown(byTipo, total);
}

function _getSelectedContaExpenses() {
  return state.expenses
    .filter(e => _contaSelection.has(e.rowIndex))
    .sort((a, b) => String(a.fechaGasto || '').localeCompare(String(b.fechaGasto || '')) || a.rowIndex - b.rowIndex);
}

function _getPaymentExpenses(payment) {
  let rows = [];
  try {
    rows = JSON.parse(payment?.expenseRowsJson || '[]');
  } catch {
    rows = [];
  }
  return state.expenses.filter(e => rows.includes(e.rowIndex));
}

function _sortPaymentsDesc(list) {
  return [...(list || [])].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.rowIndex - a.rowIndex);
}

function _renderPaymentBatches() {
  const tbody = $('conta-payments-tbody');
  if (!tbody) return;
  const payments = _sortPaymentsDesc(state.payments);
  if (!payments.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Sin lotes de pago registrados</td></tr>';
    return;
  }

  tbody.innerHTML = payments.map(payment => {
    const canFinalize = payment.paymentStatus === 'EN_PREPARACION_PAGO';
    const canCancel = payment.paymentStatus === 'EN_PREPARACION_PAGO' || payment.paymentStatus === 'PAGADO';
    return `
      <tr>
        <td class="td td-bold conta-folio">${_escapeHtml(payment.paymentBatchId)}</td>
        <td class="td">${_escapeHtml(payment.payeeName || _getUserName(payment.payeeEmail))}</td>
        <td class="td">${_paymentBadge(payment.paymentStatus, '')}</td>
        <td class="td">${payment.paymentDate ? fmtDate(payment.paymentDate) : '—'}</td>
        <td class="td td-bold">${fmt(payment.totalAmount)}</td>
        <td class="td">${_escapeHtml(payment.paymentRef || '—')}</td>
        <td class="td" title="${_escapeHtml(payment.folios || '')}" style="font-size:11px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default">
          <strong>${payment.documentCount}</strong>${payment.folios ? ` · ${_escapeHtml(payment.folios)}` : ''}
        </td>
        <td class="td">${payment.packetUrl ? `<a class="conta-batch-link" href="${payment.packetUrl}" target="_blank" rel="noopener">Abrir PDF</a>` : '—'}</td>
        <td class="td">
          <div class="conta-batch-actions">
            ${canFinalize ? `<button type="button" class="btn-secondary" onclick="finalizePaymentBatch(${payment.rowIndex})">Finalizar</button>` : ''}
            ${canCancel ? `<button type="button" class="btn-secondary" onclick="cancelPaymentBatch(${payment.rowIndex})">Anular</button>` : ''}
            <button type="button" class="btn-secondary" onclick="reprintPaymentBatch(${payment.rowIndex})">Reimprimir</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function _renderContaSelectionSummary() {
  const summaryEl = $('conta-payment-summary');
  if (!summaryEl) return;

  const selected = _getSelectedContaExpenses();
  if (!selected.length) {
    summaryEl.textContent = 'Selecciona rendiciones autorizadas del mismo rendidor para generar el comprobante.';
    return;
  }

  const total = selected.reduce((sum, exp) => sum + exp.total, 0);
  summaryEl.textContent = `${selected.length} rendición${selected.length === 1 ? '' : 'es'} seleccionada${selected.length === 1 ? '' : 's'} · Rendidor: ${_getUserName(selected[0].email)} · Total a transferir: ${fmt(total)}`;
}

function clearContaSelection() {
  _contaSelection.clear();
  _renderConta(_contaFiltered);
}

function selectAllContaFiltered() {
  const selectable = _contaFiltered.filter(e => _canSelectPaymentStatus(_getPaymentStatus(e)));
  if (!selectable.length) {
    toast('No hay rendiciones disponibles para seleccionar en la vista actual.', 'info');
    return;
  }
  const emails = [...new Set(selectable.map(e => e.email))];
  if (emails.length > 1) {
    toast('Filtra por un rendidor específico antes de usar "Seleccionar todos".', 'error');
    return;
  }
  selectable.forEach(e => _contaSelection.add(e.rowIndex));
  _renderConta(_contaFiltered);
}

function toggleContaSelection(rowIndex) {
  const exp = state.expenses.find(item => item.rowIndex === rowIndex);
  if (!exp || exp.status !== 'AUTORIZADO') return;

  if (_contaSelection.has(rowIndex)) {
    _contaSelection.delete(rowIndex);
    _renderConta(_contaFiltered);
    return;
  }

  const selected = _getSelectedContaExpenses();
  if (selected.length && selected[0].email !== exp.email) {
    toast('El comprobante debe corresponder a un solo rendidor.', 'error');
    return;
  }

  _contaSelection.add(rowIndex);
  _renderConta(_contaFiltered);
}

function _loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('No se pudo cargar PDF.js'));
    document.head.appendChild(s);
  });
}

async function _pdfToImages(base64data, scale = 2) {
  const lib = await _loadPdfJs();
  const raw = atob(base64data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

  const pdf = await lib.getDocument({ data: bytes }).promise;
  const images = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page     = await pdf.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.88));
  }
  return images;
}

async function _buildPaymentPrintSnapshot(expenses) {
  const totalReceipts = expenses.reduce((s, e) => s + Math.max(1, (Array.isArray(e.receipts) ? e.receipts : []).filter(r => r?.id).length), 0);
  let doneReceipts = 0;

  const _updateProgress = () => {
    loading(true,
      `Generando comprobante... (${doneReceipts} de ${totalReceipts} adjuntos)`,
      'Por favor espera, esto puede tomar varios minutos para lotes grandes.'
    );
  };
  _updateProgress();

  // Semáforo: máx 8 descargas simultáneas para no saturar Apps Script
  let _active = 0;
  const _waiters = [];
  const _acquire = () => new Promise(resolve => {
    if (_active < 8) { _active++; resolve(); }
    else _waiters.push(resolve);
  });
  const _release = () => {
    _active--;
    if (_waiters.length) { _active++; _waiters.shift()(); }
  };

  const _fetchWithRetry = async (fn, retries = 2) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { return await fn(); } catch (err) {
        if (attempt === retries) throw err;
        await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  };

  const _fetchReceipt = async (receipt) => {
    const cloned = { ...receipt };
    if (!receipt?.id) return cloned;
    await _acquire();
    try {
      const content = await _fetchWithRetry(() => getReceiptContent(receipt.id));
      if (content?.data && content?.mime) {
        if (content.mime.includes('pdf')) {
          try {
            cloned.pdfImages = await _pdfToImages(content.data);
          } catch {
            cloned.inlineUrl = `data:${content.mime};base64,${content.data}`;
          }
          cloned.mime = content.mime;
        } else {
          cloned.inlineUrl = `data:${content.mime};base64,${content.data}`;
          cloned.mime = content.mime;
        }
      }
    } catch (err) {
      cloned.loadError = err.message;
    } finally {
      _release();
      doneReceipts++;
      _updateProgress();
    }
    return cloned;
  };

  return Promise.all(expenses.map(async exp => {
    const receipts = Array.isArray(exp.receipts) ? exp.receipts : [];
    const clonedReceipts = await Promise.all(receipts.map(_fetchReceipt));
    return { ...exp, receipts: clonedReceipts };
  }));
}

function _buildPaymentAttachments(expenses) {
  const sections = [];
  let totalReceipts = 0;
  expenses.forEach(exp => {
    const r = Array.isArray(exp.receipts) ? exp.receipts : [];
    totalReceipts += r.length || 1;
  });
  let idx = 1;

  expenses.forEach((exp, expIdx) => {
    const receipts = Array.isArray(exp.receipts) ? exp.receipts : [];
    const docRef   = `${_escapeHtml(exp.docType || 'DOC')} ${_escapeHtml(exp.docNumber || 'S/F')}`;
    const provRef  = `${_escapeHtml(exp.provider || 'Sin proveedor')} · ${fmt(exp.total)}`;

    const _header = (label) => `
      <div style="flex-shrink:0;display:flex;justify-content:space-between;align-items:center;
                  background:#1e3a8a;color:#fff;padding:8px 18px;">
        <div>
          <span style="font-size:9px;opacity:.7;text-transform:uppercase;letter-spacing:.07em">
            Respaldo ${label}
          </span>
          <div style="font-size:13px;font-weight:800;margin-top:1px">${docRef} · ${provRef}</div>
        </div>
        <div style="text-align:right;font-size:10px;opacity:.8">
          ${_escapeHtml(exp.title)}<br>${fmtDate(exp.fechaGasto)}
        </div>
      </div>`;

    if (!receipts.length) {
      sections.push(`
        <div style="height:100vh;page-break-after:always;display:flex;flex-direction:column;
                    font-family:Arial,sans-serif;overflow:hidden;box-sizing:border-box">
          ${_header(`${idx} de ${totalReceipts}`)}
          <div style="flex:1;display:flex;align-items:center;justify-content:center;
                      background:#f8fafc;flex-direction:column;gap:8px;color:#9ca3af">
            <div style="font-size:36px">📄</div>
            <div style="font-size:13px;font-weight:600">Sin archivos adjuntos</div>
            <div style="font-size:11px">Este documento no tiene comprobantes digitales adjuntos</div>
          </div>
        </div>`);
      idx++;
      return;
    }

    receipts.forEach((receipt, rIdx) => {
      const baseLabel = receipts.length > 1 ? `(${rIdx + 1}/${receipts.length})` : '';
      const source    = receipt.inlineUrl || receipt.url || '';
      const mime      = String(receipt.mime || '');
      const fname     = receipt.name || '—';

      // ── PDF convertido a imágenes (una página = una hoja) ──
      if (receipt.pdfImages && receipt.pdfImages.length > 0) {
        receipt.pdfImages.forEach((imgSrc, pageIdx) => {
          const pageTag  = receipt.pdfImages.length > 1
            ? ` · Pág. ${pageIdx + 1}/${receipt.pdfImages.length}` : '';
          const fullLabel = `${idx} de ${totalReceipts}${baseLabel}${pageTag}`;
          sections.push(`
            <div style="height:100vh;page-break-after:always;display:flex;flex-direction:column;
                        font-family:Arial,sans-serif;overflow:hidden;box-sizing:border-box">
              ${_header(fullLabel)}
              <div style="flex:1;overflow:hidden;background:#fff;display:flex;
                          align-items:center;justify-content:center">
                <img src="${imgSrc}" alt="${_escapeHtml(fname)}"
                     style="max-width:100%;max-height:100%;object-fit:contain;display:block">
              </div>
            </div>`);
        });
        idx++;
        return;
      }

      // ── Resto de casos ──
      const label = `${idx} de ${totalReceipts}${baseLabel ? ' ' + baseLabel : ''}`;
      let body;

      if (receipt.loadError) {
        body = `
          <div style="display:flex;align-items:center;justify-content:center;flex-direction:column;
                      gap:10px;padding:32px;text-align:center">
            <div style="font-size:32px">⚠️</div>
            <div style="font-size:14px;font-weight:700;color:#dc2626">No se pudo cargar el adjunto</div>
            <div style="font-size:12px;color:#6b7280;max-width:400px">${_escapeHtml(receipt.loadError)}</div>
            ${receipt.url ? `<a href="${_escapeHtml(receipt.url)}" target="_blank"
              style="margin-top:8px;background:#1e40af;color:#fff;padding:8px 20px;
                     border-radius:8px;text-decoration:none;font-size:12px;font-weight:700">
              Abrir en Drive ↗</a>` : ''}
          </div>`;
      } else if (source && mime.startsWith('image/')) {
        body = `
          <div style="flex:1;display:flex;align-items:center;justify-content:center;
                      background:#fff;overflow:hidden">
            <img src="${source}" alt="${_escapeHtml(fname)}"
                 style="max-width:100%;max-height:100%;object-fit:contain;display:block">
          </div>`;
      } else if (mime.includes('pdf') || fname.toLowerCase().endsWith('.pdf')) {
        const driveUrl = receipt.url || source;
        body = `
          <div style="display:flex;align-items:center;justify-content:center;flex-direction:column;
                      gap:12px;padding:40px;text-align:center;background:#f0f4ff;flex:1">
            <div style="font-size:56px">📑</div>
            <div style="font-size:16px;font-weight:800;color:#1e3a8a">${_escapeHtml(fname)}</div>
            <div style="font-size:12px;color:#6b7280">
              ${_escapeHtml(exp.docType || '')} ${_escapeHtml(exp.docNumber || '')} · ${_escapeHtml(exp.provider || '')}
            </div>
            ${driveUrl ? `<a href="${_escapeHtml(driveUrl)}" target="_blank"
              style="background:#1e3a8a;color:#fff;padding:10px 28px;border-radius:10px;
                     text-decoration:none;font-size:13px;font-weight:700;margin-top:4px">
              Abrir PDF en Drive ↗</a>` : ''}
          </div>`;
      } else if (source) {
        body = `
          <div style="display:flex;align-items:center;justify-content:center;flex-direction:column;
                      gap:10px;padding:32px;flex:1">
            <div style="font-size:36px">📎</div>
            <div style="font-size:13px;font-weight:700">${_escapeHtml(fname)}</div>
            <a href="${_escapeHtml(source)}" target="_blank"
               style="background:#1e40af;color:#fff;padding:8px 20px;border-radius:8px;
                      text-decoration:none;font-size:12px;font-weight:700">Abrir archivo ↗</a>
          </div>`;
      } else {
        body = `
          <div style="display:flex;align-items:center;justify-content:center;flex-direction:column;
                      gap:8px;padding:32px;color:#9ca3af;flex:1">
            <div style="font-size:32px">🔗</div>
            <div style="font-size:12px">Adjunto sin URL disponible</div>
          </div>`;
      }

      sections.push(`
        <div style="height:100vh;page-break-after:always;display:flex;flex-direction:column;
                    font-family:Arial,sans-serif;overflow:hidden;box-sizing:border-box">
          ${_header(label)}
          <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;background:#fff">
            ${body}
          </div>
        </div>`);
      idx++;
    });
  });
  return sections.join('');
}

function _buildPaymentPacketHtml(payload, options = {}) {
  const payment  = payload || {};
  const expenses = Array.isArray(payment.expenses) ? payment.expenses : [];
  if (!expenses.length) return '';

  const ownerEmail = expenses[0].email || '';
  const ownerName  = _getUserName(ownerEmail) || ownerEmail;
  const empresa    = expenses[0].empresa || '—';
  const total      = expenses.reduce((sum, exp) => sum + exp.total, 0);
  const emitDate   = fmtDate(new Date().toISOString().split('T')[0]);

  const rows = expenses.map((exp, i) => `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;text-align:center;color:#64748b">${i + 1}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;white-space:nowrap">${fmtDate(exp.fechaGasto)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0">
        <span style="background:#dbeafe;color:#1e40af;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">
          ${_escapeHtml(exp.docType || '—')}
        </span>
      </td>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#1e3a8a">${_escapeHtml(exp.docNumber || '—')}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0">${_escapeHtml(exp.provider || '—')}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;color:#64748b">${_escapeHtml(exp.category || '—')}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0">${_escapeHtml(exp.title || '—')}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:10px">${_escapeHtml(_getUserName(exp.approverEmail) || exp.approverEmail || '—')}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:800;color:#111827">${fmt(exp.total)}</td>
    </tr>`).join('');

  const attachments = _buildPaymentAttachments(expenses);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Comprobante ${_escapeHtml(payment.paymentBatchId || '')}</title>
  <style>
    @page summaryPage{size:A4 landscape;margin:10mm}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:12px;background:#fff}
    table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}
    td,th{word-wrap:break-word;overflow-wrap:break-word}
    @media print{body{background:#fff}}
  </style>
</head>
<body>

<!-- ── PÁGINA 1: DESGLOSE (horizontal) ── -->
<div style="page-break-after:always;font-family:Arial,Helvetica,sans-serif;page:summaryPage">

  <!-- Cabecera azul oscuro -->
  <div style="background:#1e3a8a;color:#fff;padding:20px 28px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:10px;opacity:.65;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">
        Rindegastos · ${_escapeHtml(empresa)}
      </div>
      <div style="font-size:22px;font-weight:800;letter-spacing:-.3px">Comprobante de Pago</div>
      <div style="font-size:11px;opacity:.75;margin-top:3px">
        Emitido el ${emitDate} &nbsp;·&nbsp; Lote: <strong>${_escapeHtml(payment.paymentBatchId || '—')}</strong>
      </div>
    </div>
    <!-- Total destacado -->
    <div style="text-align:right">
      <div style="font-size:10px;opacity:.65;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Total a transferir</div>
      <div style="font-size:32px;font-weight:800;letter-spacing:-.5px">${fmt(total)}</div>
      <div style="font-size:10px;opacity:.65;margin-top:2px">${expenses.length} documento${expenses.length === 1 ? '' : 's'} autorizado${expenses.length === 1 ? '' : 's'}</div>
    </div>
  </div>

  <!-- Franja acento -->
  <div style="height:4px;background:linear-gradient(90deg,#3b82f6,#06b6d4)"></div>

  <!-- Cuerpo principal -->
  <div style="padding:20px 28px">

    <!-- Dos columnas: rendidor + datos pago -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">

      <!-- Card rendidor -->
      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="background:#f1f5f9;padding:8px 14px;font-size:10px;font-weight:700;
                    text-transform:uppercase;letter-spacing:.07em;color:#475569;
                    border-bottom:1px solid #e2e8f0">
          Datos del rendidor
        </div>
        <div style="padding:12px 14px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Nombre</div>
            <div style="font-size:13px;font-weight:800;color:#1e3a8a">${_escapeHtml(ownerName)}</div>
          </div>
          <div>
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Empresa</div>
            <div style="font-size:12px;font-weight:700">${_escapeHtml(empresa)}</div>
          </div>
          <div style="grid-column:1/-1">
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Correo</div>
            <div style="font-size:11px;color:#475569">${_escapeHtml(ownerEmail)}</div>
          </div>
        </div>
      </div>

      <!-- Card datos del pago -->
      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <div style="background:#f1f5f9;padding:8px 14px;font-size:10px;font-weight:700;
                    text-transform:uppercase;letter-spacing:.07em;color:#475569;
                    border-bottom:1px solid #e2e8f0">
          Datos del pago
        </div>
        <div style="padding:12px 14px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Fecha transferencia</div>
            <div style="font-size:12px;font-weight:700">${fmtDate(payment.paymentDate || '')}</div>
          </div>
          <div>
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Procesado por</div>
            <div style="font-size:12px;font-weight:700">${_escapeHtml(payment.paymentByName || payment.paymentBy || '—')}</div>
          </div>
          <div style="grid-column:1/-1">
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Referencia / N° Transferencia</div>
            <div style="font-size:12px;font-weight:800;color:#1e3a8a">${_escapeHtml(payment.paymentRef || '—')}</div>
          </div>
          ${payment.paymentNotes ? `
          <div style="grid-column:1/-1">
            <div style="font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Observaciones</div>
            <div style="font-size:11px;color:#475569">${_escapeHtml(payment.paymentNotes)}</div>
          </div>` : ''}
        </div>
      </div>
    </div>

    <!-- Tabla desglose -->
    <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:18px">
      <div style="background:#f1f5f9;padding:8px 14px;font-size:10px;font-weight:700;
                  text-transform:uppercase;letter-spacing:.07em;color:#475569;
                  border-bottom:1px solid #e2e8f0">
        Desglose de rendiciones autorizadas
      </div>
      <table>
        <thead>
          <tr style="background:#1e3a8a;color:#fff">
            <th style="padding:8px 6px;text-align:center;width:3%;font-size:10px">#</th>
            <th style="padding:8px 6px;width:7%;font-size:10px">Fecha</th>
            <th style="padding:8px 6px;width:6%;font-size:10px">Tipo</th>
            <th style="padding:8px 6px;width:8%;font-size:10px">N° Folio</th>
            <th style="padding:8px 6px;width:17%;font-size:10px">Proveedor</th>
            <th style="padding:8px 6px;width:11%;font-size:10px">Categoría</th>
            <th style="padding:8px 6px;width:25%;font-size:10px">Concepto</th>
            <th style="padding:8px 6px;width:12%;font-size:10px">Autorizado por</th>
            <th style="padding:8px 6px;width:11%;text-align:right;font-size:10px">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <!-- Fila total -->
          <tr style="background:#1e3a8a;color:#fff">
            <td colspan="8" style="padding:10px 6px;text-align:right;font-weight:700;font-size:12px;
                                   text-transform:uppercase;letter-spacing:.04em">
              Total a transferir
            </td>
            <td style="padding:10px 6px;text-align:right;font-weight:800;font-size:14px">
              ${fmt(total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Firmas -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;min-height:88px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
                    color:#94a3b8;margin-bottom:8px">Recibe conforme · Rendidor</div>
        <div style="font-size:13px;font-weight:800;color:#1e3a8a;margin-bottom:28px">${_escapeHtml(ownerName)}</div>
        <div style="border-bottom:1px solid #cbd5e1"></div>
        <div style="font-size:9px;color:#94a3b8;margin-top:5px">${_escapeHtml(ownerEmail)}</div>
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;min-height:88px">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
                    color:#94a3b8;margin-bottom:8px">Autoriza transferencia</div>
        <div style="font-size:13px;font-weight:800;color:#1e3a8a;margin-bottom:28px">${_escapeHtml(payment.paymentByName || payment.paymentBy || '—')}</div>
        <div style="border-bottom:1px solid #cbd5e1"></div>
        <div style="font-size:9px;color:#94a3b8;margin-top:5px">${_escapeHtml(payment.paymentBy || '')}</div>
      </div>
    </div>

  </div><!-- /cuerpo -->
</div><!-- /página 1 -->

${attachments}

</body>
</html>`;
}

async function _persistPaymentStatus(expenses, payload) {
  const BATCH = 10;
  for (let i = 0; i < expenses.length; i += BATCH) {
    await Promise.all(
      expenses.slice(i, i + BATCH).map(async exp => {
        await updateExpensePayment(exp.rowIndex, payload);
        Object.assign(exp, payload);
      })
    );
  }
}

async function preparePaymentBatch() {
  const selected = _getSelectedContaExpenses();
  if (!selected.length) {
    toast('Selecciona al menos un documento disponible para preparar el lote.', 'info');
    return;
  }
  if (selected.some(exp => exp.email !== selected[0].email)) {
    toast('El lote de pago debe corresponder a un solo rendidor.', 'error');
    return;
  }

  const paymentDate = $('conta-pay-date')?.value || new Date().toISOString().split('T')[0];
  const paymentRef = ($('conta-pay-ref')?.value || '').trim();
  const paymentNotes = ($('conta-pay-notes')?.value || '').trim();
  if (!paymentRef) {
    toast('Ingresa una referencia del pago para la trazabilidad.', 'error');
    $('conta-pay-ref')?.focus();
    return;
  }

  const currentUser = getCurrentUser() || {};
  const paymentBatchId = _buildPaymentBatchId();
  const paymentBy = (currentUser.email || '').toLowerCase();

  loading(true);
  try {
    const snapshot = await _buildPaymentPrintSnapshot(selected);
    const paymentPayload = {
      paymentBatchId,
      paymentDate,
      paymentRef,
      paymentNotes,
      paymentBy,
      paymentByName: _getUserName(paymentBy),
      expenses: snapshot
    };
    const html = _buildPaymentPacketHtml(paymentPayload, { autoPrint: false });
    loading(true, 'Generando PDF...', 'El servidor está convirtiendo el comprobante, por favor espera.');
    const savedPacket = await savePaymentPacket(paymentBatchId, html);
    const rowIndexes = selected.map(exp => exp.rowIndex);
    const totalAmount = selected.reduce((sum, exp) => sum + exp.total, 0);
    const record = {
      paymentBatchId,
      createdAt: new Date().toISOString(),
      paymentStatus: 'EN_PREPARACION_PAGO',
      paymentDate,
      payeeEmail: selected[0].email,
      payeeName: _getUserName(selected[0].email),
      documentCount: selected.length,
      totalAmount,
      paymentRef,
      paymentNotes,
      processedBy: paymentBy,
      expenseRowsJson: JSON.stringify(rowIndexes),
      folios: selected.map(exp => exp.docNumber || `fila-${exp.rowIndex}`).join(', '),
      packetFileId: savedPacket.fileId || '',
      packetUrl: savedPacket.url || '',
      packetMime: savedPacket.mime || 'application/pdf'
    };
    await addPaymentRecord(record);
    const toUpdateStatus = selected.filter(exp => {
      const ps = _getPaymentStatus(exp);
      return ps !== 'PAGADO' && ps !== 'EN_PREPARACION_PAGO';
    });
    if (toUpdateStatus.length) {
      await _persistPaymentStatus(toUpdateStatus, {
        paymentStatus: 'EN_PREPARACION_PAGO',
        paymentBatchId,
        paymentDate,
        paymentRef,
        paymentBy,
        paymentNotes
      });
    }
    await addAudit('COMPROBANTE_GENERADO', paymentBy, { paymentBatchId, rows: rowIndexes, totalAmount, paymentRef });
    state.payments = await getPayments();

    clearContaSelection();
    filterConta();
    _renderPaymentBatches();

    if (savedPacket.url) {
      toastLink(
        `Comprobante generado · ${_getUserName(selected[0].email)} · ${selected.length} doc${selected.length === 1 ? '' : 's'} · ${fmt(totalAmount)}`,
        'Abrir comprobante PDF',
        savedPacket.url
      );
    } else {
      toast(`Comprobante guardado · ${_getUserName(selected[0].email)} · ${fmt(totalAmount)}`, 'success');
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading(false);
  }
}

async function finalizePaymentBatch(paymentRowIndex) {
  const payment = state.payments.find(item => item.rowIndex === paymentRowIndex);
  if (!payment || payment.paymentStatus !== 'EN_PREPARACION_PAGO') {
    toast('El lote seleccionado no está disponible para finalizar.', 'info');
    return;
  }

  const expenses = _getPaymentExpenses(payment);
  if (!expenses.length) {
    toast('No se encontraron documentos asociados al lote.', 'error');
    return;
  }

  loading(true);
  try {
    await _persistPaymentStatus(expenses, {
      paymentStatus: 'PAGADO',
      paymentBatchId: payment.paymentBatchId,
      paymentDate: payment.paymentDate,
      paymentRef: payment.paymentRef,
      paymentBy: payment.processedBy,
      paymentNotes: payment.paymentNotes
    });
    const updatedPayment = { ...payment, paymentStatus: 'PAGADO' };
    await updatePaymentRecord(payment.rowIndex, updatedPayment);
    await addAudit('PAGO_FINALIZADO', getCurrentUser()?.email || payment.processedBy, { paymentBatchId: payment.paymentBatchId, rows: expenses.map(exp => exp.rowIndex) });
    Object.assign(payment, updatedPayment);
    filterConta();
    _renderPaymentBatches();
    toast(`Lote ${payment.paymentBatchId} marcado como pagado.`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading(false);
  }
}

async function cancelPaymentBatch(paymentRowIndex) {
  const payment = state.payments.find(item => item.rowIndex === paymentRowIndex);
  if (!payment || (payment.paymentStatus !== 'EN_PREPARACION_PAGO' && payment.paymentStatus !== 'PAGADO')) {
    toast('El lote seleccionado no puede anularse.', 'info');
    return;
  }

  const expenses = _getPaymentExpenses(payment);
  if (!expenses.length) {
    toast('No se encontraron documentos asociados al lote.', 'error');
    return;
  }

  loading(true);
  try {
    await _persistPaymentStatus(expenses, {
      paymentStatus: 'ANULADO_PAGO',
      paymentBatchId: payment.paymentBatchId,
      paymentDate: payment.paymentDate,
      paymentRef: payment.paymentRef,
      paymentBy: payment.processedBy,
      paymentNotes: payment.paymentNotes
    });
    const updatedPayment = { ...payment, paymentStatus: 'ANULADO_PAGO' };
    await updatePaymentRecord(payment.rowIndex, updatedPayment);
    await addAudit('PAGO_ANULADO', getCurrentUser()?.email || payment.processedBy, { paymentBatchId: payment.paymentBatchId, rows: expenses.map(exp => exp.rowIndex) });
    Object.assign(payment, updatedPayment);
    filterConta();
    _renderPaymentBatches();
    toast(`Lote ${payment.paymentBatchId} anulado correctamente.`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading(false);
  }
}

async function reprintPaymentBatch(paymentRowIndex) {
  const payment = state.payments.find(item => item.rowIndex === paymentRowIndex);
  if (!payment) {
    toast('Lote no encontrado.', 'error');
    return;
  }
  if (payment.packetUrl) {
    toastLink('Comprobante listo', 'Abrir comprobante PDF', payment.packetUrl);
    return;
  }

  loading(true);
  try {
    const expenses = await _buildPaymentPrintSnapshot(_getPaymentExpenses(payment));
    const paymentPayload = {
      paymentBatchId: payment.paymentBatchId,
      paymentDate: payment.paymentDate,
      paymentRef: payment.paymentRef,
      paymentNotes: payment.paymentNotes,
      paymentBy: payment.processedBy,
      paymentByName: _getUserName(payment.processedBy),
      expenses
    };
    const html = _buildPaymentPacketHtml(paymentPayload, { autoPrint: false });
    const savedPacket = await savePaymentPacket(payment.paymentBatchId, html);
    if (savedPacket.url) {
      toastLink('Comprobante regenerado', 'Abrir comprobante PDF', savedPacket.url);
    } else {
      toast('Comprobante generado, revisa Google Drive.', 'success');
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading(false);
  }
}

async function generatePaymentPacket() {
  return preparePaymentBatch();
}

function _groupAndSum(exps, field) {
  const map = {};
  exps.forEach(e => {
    const key = e[field] || 'Sin especificar';
    map[key] = (map[key] || 0) + e.total;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function _renderBreakdown(entries, grandTotal) {
  if (!entries.length) return '<p class="text-muted" style="padding:16px">Sin datos</p>';
  return entries.map(([label, total]) => {
    const pct = grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0;
    return `
      <div style="padding:10px 18px;border-bottom:1px solid #f9fafb">
        <div style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px">
          <span style="font-weight:500">${label}</span>
          <span style="font-weight:700">${fmt(total)} <span style="color:#9ca3af;font-weight:400">(${pct}%)</span></span>
        </div>
        <div style="background:#f3f4f6;border-radius:4px;height:6px;overflow:hidden">
          <div style="background:#2563eb;height:100%;width:${pct}%;border-radius:4px;transition:width .4s"></div>
        </div>
      </div>`;
  }).join('');
}

function exportContaCSV() {
  const exps = state.expenses.filter(e => e.status === 'AUTORIZADO');
  const headers = ['N° Folio','Fecha','Tipo Doc','N° Documento','Proveedor','Categoría','Concepto','Empleado','Total','Estado pago','Fecha pago','Referencia pago','Lote pago','Pagado por','Observaciones pago','Autorizado por','Observaciones'];
  const rows = exps.map(e => [
    e.docNumber || '—',
    e.fechaGasto, e.docType, e.docNumber, e.provider,
    e.category, e.title, e.email, e.total,
    _getPaymentStatusLabel(_getPaymentStatus(e)), e.paymentDate, e.paymentRef,
    e.paymentBatchId, e.paymentBy, e.paymentNotes, e.approverEmail, e.observations
  ].map(v => `"${(v||'').toString().replace(/"/g,'""')}"`));
  const csv = '\uFEFF' + [headers.map(h=>`"${h}"`), ...rows].map(r => r.join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: `contabilidad_${new Date().toISOString().split('T')[0]}.csv`
  });
  a.click();
}
