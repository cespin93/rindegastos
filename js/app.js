// ─── Estado global ────────────────────────────
const state = {
  role:           null,  // RENDIDOR | APROBADOR | GERENTE | ADMIN
  expenses:       [],
  categories:     [],
  users:          [],
  currentExpense: null,
  prevView:       null,
  detailContext:  null   // 'dashboard' | 'approvals' | 'gerencia'
};

// ─── Helpers DOM ──────────────────────────────
const $ = id => document.getElementById(id);

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

function loading(show) { $('loading').classList.toggle('hidden', !show); }

function showView(id) {
  state.prevView = document.querySelector('.view:not(.hidden)')?.id || null;
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
  document.querySelectorAll('[data-view]').forEach(btn =>
    btn.classList.toggle('active-nav', btn.dataset.view === id)
  );
}

function goBack() { showView(state.prevView || 'view-dashboard'); }

const fmt     = n => '$' + Number(n).toLocaleString('es-CL');
const fmtDate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('es-CL') : '—';

function badge(status) {
  const cls = {
    PENDIENTE:  'badge-yellow',
    APROBADO:   'badge-green',
    AUTORIZADO: 'badge-purple',
    RECHAZADO:  'badge-red'
  };
  return `<span class="badge ${cls[status] || 'badge-gray'}">${status}</span>`;
}

// ─── Arranque ─────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await _loadViews();
  initAuth(onSignIn);
});

async function _loadViews() {
  const main = document.getElementById('main-content');
  const views = ['dashboard', 'new-expense', 'detail', 'approvals', 'gerencia', 'contabilidad', 'admin'];
  // Detecta la base URL automáticamente (funciona en localhost Y en GitHub Pages)
  const base = document.querySelector('base')?.href || (location.href.replace(/\/[^/]*$/, '/'));
  for (const name of views) {
    const res  = await fetch(`${base}views/${name}.html`);
    const html = await res.text();
    main.insertAdjacentHTML('beforeend', html);
  }
}

async function onSignIn(user) {
  loading(true);
  try {
    state.role = await getUserRole(user.email);

    $('user-name').textContent  = user.name;
    $('user-email').textContent = user.email;
    if (user.picture) $('user-avatar').src = user.picture;

    // Mostrar/ocultar nav según rol
    document.querySelectorAll('[data-role]').forEach(el => {
      const roles = el.dataset.role.split(',');
      el.classList.toggle('hidden', !roles.includes(state.role));
    });

    await Promise.all([_loadCategories(), _loadUsers()]);

    $('login-screen').classList.add('hidden');
    $('app-screen').classList.remove('hidden');

    if (state.role === 'APROBADOR') {
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

async function _loadUsers() {
  state.users = await getUsers();
  // Excluir al propio usuario de la lista de aprobadores
  const currentEmail = getCurrentUser()?.email?.toLowerCase();
  const approvers = state.users.filter(u =>
    (u.role === 'APROBADOR' || u.role === 'ADMIN') && u.email !== currentEmail
  );
  _fillSelect('form-approver',  approvers.map(u => ({ val: u.email, label: u.email })), 'Sin aprobador asignado');
  _fillSelect('bulk-approver',  approvers.map(u => ({ val: u.email, label: u.email })), 'Sin aprobador asignado');
}

function _fillSelect(id, items, placeholder) {
  const sel = $(id);
  if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map(i => `<option value="${i.val}">${i.label}</option>`).join('');
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
    const all = await getExpenses();
    _mergeExpenses(all);
    const mine = state.role === 'ADMIN'
      ? all
      : all.filter(e => e.email === getCurrentUser().email.toLowerCase());
    _renderStats(mine);
    _renderTable(mine);
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
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

function _renderTable(exps) {
  const tbody = $('exp-tbody');
  if (!exps.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No hay rendiciones registradas</td></tr>';
    return;
  }
  tbody.innerHTML = exps.map(e => `
    <tr class="table-row" onclick="openDetail(${e.rowIndex},'dashboard')">
      <td class="td">${fmtDate(e.fechaGasto)}</td>
      <td class="td td-bold">${e.title}</td>
      <td class="td td-muted">${e.category}</td>
      <td class="td td-muted">${e.docType}</td>
      <td class="td td-muted">${e.docNumber || '—'}</td>
      <td class="td td-bold">${fmt(e.total)}</td>
      <td class="td">${badge(e.status)}</td>
      <td class="td td-muted">${e.approverEmail || '—'}</td>
    </tr>`).join('');
}

function filterTable() {
  const q = $('search').value.toLowerCase();
  const s = $('filter-status').value;
  const user = getCurrentUser();
  let exps = state.role === 'ADMIN'
    ? state.expenses
    : state.expenses.filter(e => e.email === user.email.toLowerCase());
  exps = exps.filter(e =>
    (!q || e.title.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || (e.provider || '').toLowerCase().includes(q)) &&
    (!s || e.status === s)
  );
  _renderStats(exps);
  _renderTable(exps);
}

function exportCSV() {
  const user = getCurrentUser();
  const exps = state.role === 'ADMIN'
    ? state.expenses
    : state.expenses.filter(e => e.email === user.email.toLowerCase());
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
  $('d-approver').textContent     = e.approverEmail || '—';
  $('d-observations').textContent = e.observations  || '—';

  $('d-receipts').innerHTML = e.receipts?.length
    ? e.receipts.map(r => `<a href="${r.url}" target="_blank" class="receipt-link">📎 ${r.name}</a>`).join('')
    : '<p class="text-muted">Sin archivos adjuntos</p>';

  const user = getCurrentUser();

  // Nivel 1: APROBADOR/ADMIN puede aprobar PENDIENTE que no sea suyo
  const canL1 =
    context === 'approvals' &&
    e.status === 'PENDIENTE' &&
    (state.role === 'APROBADOR' || state.role === 'ADMIN') &&
    e.email !== user.email.toLowerCase();

  // Nivel 2: GERENTE/ADMIN puede autorizar APROBADO
  const canL2 =
    context === 'gerencia' &&
    e.status === 'APROBADO' &&
    (state.role === 'GERENTE' || state.role === 'ADMIN');

  $('d-actions-l1').classList.toggle('hidden', !canL1);
  $('d-actions-l2').classList.toggle('hidden', !canL2);
  if (canL1) $('d-comment-l1').value = '';
  if (canL2) $('d-comment-l2').value = '';

  showView('view-detail');
}

async function doDecision(newStatus) {
  const e    = state.currentExpense;
  if (!e) return;
  const user = getCurrentUser();
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
    if (state.role === 'ADMIN') {
      // Admin ve todos los PENDIENTE
      pending = all.filter(e => e.status === 'PENDIENTE');
    } else if (state.role === 'GERENTE') {
      // Gerente ve todos los PENDIENTE (solo lectura)
      pending = all.filter(e => e.status === 'PENDIENTE');
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
    // Solo rendiciones con APROBADO (esperando autorización gerencial)
    const toAuthorize = all.filter(e => e.status === 'APROBADO');
    _renderGerencia(toAuthorize);
    const countText = toAuthorize.length
      ? `${toAuthorize.length} pendiente${toAuthorize.length > 1 ? 's' : ''} de autorización`
      : 'Sin rendiciones pendientes de autorización';
    $('gerencia-subtitle').textContent  = countText;
    $('nav-gerencia-count').textContent = toAuthorize.length || '';
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

function _renderGerencia(exps) {
  const el = $('gerencia-list');
  if (!exps.length) {
    el.innerHTML = `
      <div class="empty-approvals">
        <div style="font-size:48px;margin-bottom:12px">🏛</div>
        <p>Sin rendiciones pendientes de autorización gerencial</p>
      </div>`;
    return;
  }
  el.innerHTML = exps.map(e => `
    <div onclick="openDetail(${e.rowIndex},'gerencia')" class="approval-card approval-card-gerencia">
      <div class="approval-card-header">
        <div>
          <h3 class="approval-title">${e.title}</h3>
          <p class="approval-email">${e.email}
            <span style="margin-left:6px;font-size:11px;color:#059669">• Aprobado por ${e.approverEmail || '—'}</span>
          </p>
        </div>
        <span class="approval-amount">${fmt(e.total)}</span>
      </div>
      <div class="approval-tags">
        <span class="tag">${e.category}</span>
        <span class="tag">${e.docType}</span>
        <span class="tag">${fmtDate(e.fechaGasto)}</span>
        ${e.receipts?.length ? `<span class="tag tag-purple">📎 ${e.receipts.length} archivo(s)</span>` : ''}
        ${badge('APROBADO')}
      </div>
    </div>`).join('');
}

// ─── NUEVA RENDICIÓN ──────────────────────────
async function navNewExpense() {
  $('expense-form').reset();
  $('file-preview').innerHTML = '';
  window._receipts      = [];
  window._originalFiles = [];
  const autofillBtn = $('autofill-btn-wrap');
  if (autofillBtn) autofillBtn.style.display = 'none';
  _resetBulk();
  setExpenseMode('single');
  await _loadCategories();
  await _loadUsers();
  showView('view-new-expense');
}

// ── Modo Individual ──
window._receipts      = [];
window._originalFiles = []; // archivos originales para OCR

async function handleFiles(input) {
  const preview = $('file-preview');
  for (const file of Array.from(input.files)) {
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
    }
  }
  // Mostrar botón de autocompletar si hay al menos un archivo subido
  const btn = $('autofill-btn-wrap');
  if (btn) btn.style.display = window._originalFiles.length ? 'flex' : 'none';
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
    if (data.total)    inputs[2].value  = Math.round(Number(data.total));
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
    if (data.total)     $('f-total').value    = Math.round(Number(data.total));
    if (data.date)      $('f-date').value     = data.date;

    toast('Datos extraídos correctamente — revisa y ajusta si es necesario', 'success');
  } catch (e) {
    toast('No se pudo extraer datos: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Autocompletar con IA'; }
  }
}

async function submitExpense(ev) {
  ev.preventDefault();
  const f = ev.target;
  const exp = {
    fechaGasto:    f.fechaGasto.value,
    title:         f.title.value.trim(),
    category:      f.category.value,
    total:         parseFloat(f.total.value),
    docType:       f.docType.value,
    docNumber:     f.docNumber.value.trim(),
    provider:      f.provider.value.trim(),
    notes:         f.notes.value.trim(),
    approverEmail: f.approverEmail.value,
    receipts:      window._receipts || []
  };
  loading(true);
  try {
    await addExpense(exp, getCurrentUser().email);
    await addAudit('CREAR', getCurrentUser().email, { title: exp.title, total: exp.total });
    toast('Rendición registrada exitosamente', 'success');
    window._receipts = [];
    await navDashboard();
  } catch (e) {
    toast(e.message, 'error');
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
  $('expense-form').classList.toggle('hidden', !isSingle);
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
      <input type="number" class="input-field-sm" placeholder="0" min="1" step="1" required style="width:100px">
    </td>
    <td class="bulk-td">
      <select class="input-field-sm" required>
        <option value="">— Cat —</option>
        ${_catOptions()}
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
      statusEl.textContent = `❌ Error`;
      statusEl.style.color = '#dc2626';
    }
  }
  window._bulkUploading.delete(rowId);
}

async function submitBulk() {
  if (window._bulkUploading.size > 0) {
    toast('Espera a que terminen de subir los archivos', 'info');
    return;
  }
  const rows = Array.from($('bulk-tbody').querySelectorAll('tr.bulk-row'));
  if (!rows.length) { toast('Agrega al menos una fila', 'error'); return; }

  const approverEmail = $('bulk-approver').value;
  const userEmail     = getCurrentUser().email;
  const expenses = [];

  for (const row of rows) {
    const inputs  = row.querySelectorAll('input, select');
    const id      = parseInt(row.id.replace('bulk-row-', ''));
    // inputs: [concepto, fecha, monto, categoria, docType, docNumber, proveedor]
    // (el file input está dentro de la label, lo saltamos)
    const textInputs = Array.from(inputs).filter(i => i.type !== 'file');
    const [title, fechaGasto, total, category, docType, docNumber, provider] =
      textInputs.map(i => i.value.trim());

    if (!title || !fechaGasto || !total || !category || !docType) {
      toast('Completa todos los campos obligatorios en cada fila', 'error');
      return;
    }
    expenses.push({
      title, fechaGasto, total: parseFloat(total),
      category, docType, docNumber, provider,
      notes: '', approverEmail,
      receipts: window._bulkReceipts.get(id) || []
    });
  }

  loading(true);
  try {
    for (const exp of expenses) {
      await addExpense(exp, userEmail);
    }
    await addAudit('CREAR_MULTIPLE', userEmail, { count: expenses.length });
    toast(`${expenses.length} rendiciones registradas exitosamente`, 'success');
    _resetBulk();
    await navDashboard();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    loading(false);
  }
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
  if (tab === 'tab-users')      await _loadAdminUsers();
  if (tab === 'tab-categories') await _loadAdminCats();
}

const ALL_ROLES = ['RENDIDOR', 'APROBADOR', 'GERENTE', 'ADMIN'];

async function _loadAdminUsers() {
  const users = await getUsers();
  $('users-tbody').innerHTML = users.length
    ? users.map((u, i) => `
        <tr class="table-row">
          <td class="td">${u.email}</td>
          <td class="td">
            <select onchange="updateUserRole(${i+2}, this.value)" class="select-sm">
              ${ALL_ROLES.map(r => `<option ${u.role===r?'selected':''}>${r}</option>`).join('')}
            </select>
          </td>
          <td class="td">
            <button onclick="deleteUser(${i+2})" class="btn-danger-sm">Eliminar</button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="3" class="empty-row">Sin usuarios registrados</td></tr>';
}

async function addUser() {
  const email = prompt('Email del nuevo usuario:')?.toLowerCase().trim();
  if (!email) return;
  const role = prompt('Rol (RENDIDOR / APROBADOR / GERENTE / ADMIN):', 'RENDIDOR')?.toUpperCase().trim();
  if (!ALL_ROLES.includes(role)) { toast('Rol inválido', 'error'); return; }
  loading(true);
  try {
    await sheetsAppend('Usuarios', [email, role]);
    state.users = await getUsers();
    await _loadAdminUsers();
    toast('Usuario agregado', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

async function updateUserRole(rowIndex, role) {
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
    await sheetsBatchUpdate([{ range: `Usuarios!A${rowIndex}:B${rowIndex}`, values: [['','']] }]);
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

// ─── CONTABILIDAD ─────────────────────────────
// Cache de los documentos autorizados filtrados actualmente visibles
let _contaData = [];

async function navContabilidad() {
  loading(true);
  try {
    showView('view-contabilidad');
    const all = await getExpenses();
    _mergeExpenses(all);

    // Solo rendiciones AUTORIZADAS
    _contaData = all.filter(e => e.status === 'AUTORIZADO');

    // Poblar filtro de categorías
    const cats = [...new Set(_contaData.map(e => e.category).filter(Boolean))].sort();
    const catSel = $('conta-filter-cat');
    catSel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats.map(c => `<option>${c}</option>`).join('');

    _renderConta(_contaData);
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
}

function filterConta() {
  const q     = $('conta-search').value.toLowerCase();
  const tipo  = $('conta-filter-tipo').value;
  const cat   = $('conta-filter-cat').value;
  const desde = $('conta-filter-desde').value;
  const hasta = $('conta-filter-hasta').value;

  const all = state.expenses.filter(e => e.status === 'AUTORIZADO');
  const filtered = all.filter(e => {
    if (q && !`${e.docNumber} ${e.provider} ${e.title} ${e.category}`.toLowerCase().includes(q)) return false;
    if (tipo && e.docType !== tipo)      return false;
    if (cat  && e.category !== cat)     return false;
    if (desde && e.fechaGasto < desde)  return false;
    if (hasta && e.fechaGasto > hasta)  return false;
    return true;
  });
  _renderConta(filtered);
}

function _renderConta(exps) {
  // ── KPIs ──
  const total   = exps.reduce((s, e) => s + e.total, 0);
  const boletas = exps.filter(e => e.docType === 'BOLETA').length;
  const facturas= exps.filter(e => e.docType === 'FACTURA').length;
  const otros   = exps.filter(e => e.docType !== 'BOLETA' && e.docType !== 'FACTURA').length;

  $('conta-kpi-count').textContent   = exps.length;
  $('conta-kpi-total').textContent   = fmt(total);
  $('conta-kpi-boleta').textContent  = boletas;
  $('conta-kpi-factura').textContent = facturas;
  $('conta-kpi-otros').textContent   = otros;
  $('conta-subtitle').textContent    = exps.length
    ? `${exps.length} documento${exps.length > 1 ? 's' : ''} autorizado${exps.length > 1 ? 's' : ''}`
    : 'Sin documentos autorizados';

  // ── Tabla principal ──
  const tbody = $('conta-tbody');
  if (!exps.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Sin documentos autorizados</td></tr>';
  } else {
    // Número de folio = rowIndex en la hoja (identificador único estable)
    tbody.innerHTML = exps.map(e => `
      <tr class="table-row" onclick="openDetail(${e.rowIndex},'dashboard')">
        <td class="td td-bold conta-folio">${e.docNumber || '—'}</td>
        <td class="td">${fmtDate(e.fechaGasto)}</td>
        <td class="td"><span class="tag">${e.docType}</span></td>
        <td class="td td-bold">${e.provider || '—'}</td>
        <td class="td td-muted">${e.category}</td>
        <td class="td">${e.title}</td>
        <td class="td td-muted">${e.email}</td>
        <td class="td td-bold" style="color:#111827">${fmt(e.total)}</td>
        <td class="td td-muted" style="font-size:12px">${e.approverEmail || '—'}</td>
        <td class="td">
          ${e.receipts?.length
            ? e.receipts.map(r => `<a href="${r.url}" target="_blank" class="conta-file-link">📎</a>`).join(' ')
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
  const headers = ['N° Folio','Fecha','Tipo Doc','N° Documento','Proveedor','Categoría','Concepto','Empleado','Total','Autorizado por','Observaciones'];
  const rows = exps.map(e => [
    e.docNumber || '—',
    e.fechaGasto, e.docType, e.docNumber, e.provider,
    e.category, e.title, e.email, e.total,
    e.approverEmail, e.observations
  ].map(v => `"${(v||'').toString().replace(/"/g,'""')}"`));
  const csv = '\uFEFF' + [headers.map(h=>`"${h}"`), ...rows].map(r => r.join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    download: `contabilidad_${new Date().toISOString().split('T')[0]}.csv`
  });
  a.click();
}
