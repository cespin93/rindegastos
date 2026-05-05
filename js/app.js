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
const _isAdmin = () => state.role === 'ADMIN' || state.role === 'SUPERADMIN';
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
  for (const name of views) {
    const res  = await fetch(new URL(`views/${name}.html`, baseUrl));
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

    await Promise.all([_loadCategories(), _loadCostCenters(), _loadUsers(), _loadFondoFijo()]);

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

async function _loadCostCenters() {
  state.costCenters = await getCostCenters();
  _fillSelect('form-cost-center', state.costCenters.map(c => ({ val: c, label: c })), '— Centro de Costo —');
}

async function _loadFondoFijo() {
  state.fondoFijo = await getFondoFijo();
}

async function _loadUsers() {
  state.users = await getUsers();
  const currentEmail = getCurrentUser()?.email?.toLowerCase();
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
    const mine = (_isAdmin() || state.role === 'GERENTE')
      ? all
      : all.filter(e => e.email === getCurrentUser().email.toLowerCase());
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
    ? `⚠️ Excedido ${fmt(Math.abs(saldo))}`
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
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No hay rendiciones registradas</td></tr>';
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
      </tr>`);
  }

  // Filas individuales
  for (const e of singles) {
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
      </tr>`);
  }

  tbody.innerHTML = rows.join('');
}

function openBatchDetail(batchName, context = 'dashboard') {
  const list = state.expenses.filter(e => e.batchName === batchName);
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
  const list      = state.expenses.filter(e => e.batchName === batchName && e.status === 'APROBADO');
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
  const list       = state.expenses.filter(e => e.batchName === batchName_);
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
  const user = getCurrentUser();
  let exps = (_isAdmin() || state.role === 'GERENTE')
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
  const exps = (_isAdmin() || state.role === 'GERENTE')
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
  $('d-approver').textContent     = _getUserName(e.approverEmail);
  $('d-observations').textContent = e.observations  || '—';

  $('d-receipts').innerHTML = e.receipts?.length
    ? e.receipts.map(r => `<a href="${r.url}" target="_blank" class="receipt-link">📎 ${r.name}</a>`).join('')
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
    (e.email !== user.email.toLowerCase() || state.role === 'SUPERADMIN');

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

  // Agrupar por batchName
  const batches = {};
  const singles = [];
  for (const e of exps) {
    if (e.batchName) (batches[e.batchName] = batches[e.batchName] || []).push(e);
    else singles.push(e);
  }

  let html = '';

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
            <h3 class="approval-title">${e.title}</h3>
            <p class="approval-email">${e.email}
              <span style="margin-left:6px;font-size:11px;color:#059669">• Aprobado por ${_getUserName(e.approverEmail)}</span>
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
  const autofillBtn = $('autofill-btn-wrap');
  if (autofillBtn) autofillBtn.style.display = 'none';
  const batchNameInput = $('bulk-batch-name');
  if (batchNameInput) batchNameInput.value = '';
  _resetBulk();
  setExpenseMode('single');
  await Promise.all([_loadCategories(), _loadCostCenters(), _loadUsers()]);
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
  const prov = provider.trim().toLowerCase();
  const num  = docNumber.trim().toLowerCase();
  const existing = (state.expenses || []).find(e =>
    e.status !== 'RECHAZADO' &&
    e.provider.trim().toLowerCase() === prov &&
    e.docNumber.trim().toLowerCase() === num
  );
  if (existing) return existing;
  // Check within the provided list (for batch mode)
  const inBatch = excludeExpenses.find(e =>
    (e.provider || '').trim().toLowerCase() === prov &&
    (e.docNumber || '').trim().toLowerCase() === num
  );
  return inBatch || null;
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
    costCenter:    f.costCenter.value,
    receipts:      window._receipts || []
  };
  const dup = _checkDuplicateFolio(exp.provider, exp.docNumber);
  if (dup) {
    toast(`Folio "${exp.docNumber}" ya existe para el proveedor "${exp.provider}"`, 'error');
    return;
  }
  const ffCheck = _checkFondoFijo(exp.total);
  if (ffCheck?.tipo === 'block') {
    toast(`Sin saldo disponible. Saldo actual: ${fmt(Math.max(ffCheck.saldo, 0))}`, 'error');
    return;
  }
  if (ffCheck?.tipo === 'warn') {
    if (!confirm(`Esta rendición llevará tu fondo al ${ffCheck.pct}% (${fmt(ffCheck.saldo - exp.total)} disponible tras registrar). ¿Continuar?`)) return;
  }
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
      <input type="number" class="input-field-sm" placeholder="0" min="1" step="1" required style="width:100px">
    </td>
    <td class="bulk-td">
      <select class="input-field-sm" required>
        <option value="">— Cat —</option>
        ${_catOptions()}
      </select>
    </td>
    <td class="bulk-td">
      <select class="input-field-sm">
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
  const batchName = $('bulk-batch-name').value.trim();
  if (!batchName) { toast('Ingresa un nombre para el conjunto', 'error'); return; }

  const rows = Array.from($('bulk-tbody').querySelectorAll('tr.bulk-row'));
  if (!rows.length) { toast('Agrega al menos una fila', 'error'); return; }

  const approverEmail = $('bulk-approver').value;
  const userEmail     = getCurrentUser().email;
  const expenses = [];

  for (const row of rows) {
    const inputs     = row.querySelectorAll('input, select');
    const id         = parseInt(row.id.replace('bulk-row-', ''));
    const textInputs = Array.from(inputs).filter(i => i.type !== 'file');
    const [title, fechaGasto, total, category, costCenter, docType, docNumber, provider] =
      textInputs.map(i => i.value.trim());

    if (!title || !fechaGasto || !total || !category || !docType) {
      toast('Completa todos los campos obligatorios en cada fila', 'error');
      return;
    }
    expenses.push({
      title, fechaGasto, total: parseFloat(total),
      category, costCenter, docType, docNumber, provider,
      notes: '', approverEmail, batchName,
      receipts: window._bulkReceipts.get(id) || []
    });
  }

  // Validate folio duplicates (system-wide + within batch)
  const seen = [];
  for (const exp of expenses) {
    const dup = _checkDuplicateFolio(exp.provider, exp.docNumber, seen);
    if (dup) {
      toast(`Folio "${exp.docNumber}" duplicado para el proveedor "${exp.provider}"`, 'error');
      return;
    }
    if (exp.provider && exp.docNumber) seen.push(exp);
  }

  // Validate fondo fijo for the full batch total
  const bulkTotal  = expenses.reduce((s, e) => s + e.total, 0);
  const ffBulk     = _checkFondoFijo(bulkTotal);
  if (ffBulk?.tipo === 'block') {
    toast(`Sin saldo suficiente para el conjunto. Saldo disponible: ${fmt(Math.max(ffBulk.saldo, 0))}`, 'error');
    return;
  }
  if (ffBulk?.tipo === 'warn') {
    if (!confirm(`Este conjunto llevará tu fondo al ${ffBulk.pct}%. ¿Continuar?`)) return;
  }

  loading(true);
  try {
    for (const exp of expenses) {
      await addExpense(exp, userEmail);
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
                   class="input-field" style="width:190px;margin:0;font-size:12px"
                   onblur="saveNotifyEmail(${i+2}, this.value)">`
              : (u.notifyEmail || '—')}
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
    : '<tr><td colspan="7" class="empty-row">Sin usuarios registrados</td></tr>';
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
  loading(true);
  try {
    await sheetsAppend('Usuarios', [email, role, nombre, apellido, password, notifyEmail]);
    state.users = await getUsers();
    await _loadAdminUsers();
    toast('Usuario agregado', 'success');
  } catch (e) { toast(e.message, 'error'); } finally { loading(false); }
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
    await sheetsBatchUpdate([{ range: `CentrosCosto!A${rowIndex}`, values: [['']] }]);
    state.costCenters = await getCostCenters();
    await _loadAdminCostCenters();
    toast('Centro de costo eliminado', 'success');
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
                 type="number" min="0" step="1000"
                 value="${monto}"
                 placeholder="Sin fondo"
                 class="input-field" style="width:160px;margin:0">
        </td>
        <td class="td">
          <button onclick="saveFondoFijo('${u.email}')"
                  class="btn-primary" style="font-size:12px;padding:5px 14px">
            Guardar
          </button>
        </td>
      </tr>`;
  }).join('');
}

async function saveFondoFijo(email) {
  const month = $('ff-month-picker')?.value;
  if (!month) { toast('Selecciona un mes', 'error'); return; }
  const inputId = 'ff-input-' + email.replace(/[@.]/g, '_');
  const val     = $(inputId)?.value.trim();
  const monto   = parseFloat(val);
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
        <td class="td td-muted" style="font-size:12px">${_getUserName(e.approverEmail)}</td>
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
