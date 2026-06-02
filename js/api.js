// ─────────────────────────────────────────────
//  SHEETS via Apps Script
// ─────────────────────────────────────────────

async function sheetsGet(range) {
  try {
    const d = await callBackend('sheetsRead', { range });
    return d.values || [];
  } catch (e) {
    console.warn('[Rindegastos] sheetsGet falló para:', range, '→', e.message);
    return [];
  }
}

async function sheetsAppend(sheet, row) {
  return callBackend('sheetsAppend', { sheet, row });
}

async function sheetsBatchUpdate(data) {
  return callBackend('sheetsBatchUpdate', { data });
}

// ─── Mapeo fila ↔ objeto ─────────────────────
function _rowToExpense(row, rowIndex) {
  return {
    rowIndex,
    timestamp:     row[0]  || '',
    fechaGasto:    (row[1] ? String(row[1]).split('T')[0] : ''),
    email:        (row[2]  || '').toLowerCase(),
    title:         row[3]  || '',
    category:      row[4]  || '',
    total:         parseFloat(row[5]) || 0,
    receipts:      _tryJson(row[6], []),
    notes:         row[7]  || '',
    status:        row[8]  || 'PENDIENTE',
    observations:  row[11] || '',
    approverEmail:(row[12] || '').toLowerCase(),
    docType:       String(row[13] || ''),
    docNumber:     String(row[14] || ''),
    provider:      String(row[15] || ''),
    batchName:     String(row[16] || ''),
    costCenter:    String(row[17] || ''),
    empresa:       String(row[18] || ''),
    paymentStatus: String(row[19] || ''),
    paymentBatchId:String(row[20] || ''),
    paymentDate:   String(row[21] || ''),
    paymentRef:    String(row[22] || ''),
    paymentBy:     String(row[23] || '').toLowerCase(),
    paymentNotes:  String(row[24] || '')
  };
}

function _expenseToRow(exp, userEmail, empresa) {
  return [
    new Date().toISOString(), // A TimestampCreacion
    exp.fechaGasto,           // B FechaGasto
    userEmail,                // C RequesterEmail
    exp.title,                // D Title
    exp.category,             // E Category
    exp.total,                // F Total
    JSON.stringify(exp.receipts || []), // G ReceiptsJson
    exp.notes || '',          // H Notes
    'PENDIENTE',              // I Status
    '', '',                   // J Token, K TokenExpiry (vacíos)
    '',                       // L Observations
    exp.approverEmail || '',  // M ApproverEmail
    exp.docType    || '',     // N DocumentType
    exp.docNumber  || '',     // O DocumentNumber
    exp.provider   || '',     // P Provider
    exp.batchName  || '',     // Q BatchName
    exp.costCenter || '',     // R CostCenter
    empresa        || '',     // S Empresa
    '',                       // T PaymentStatus
    '',                       // U PaymentBatchId
    '',                       // V PaymentDate
    '',                       // W PaymentReference
    '',                       // X PaymentBy
    ''                        // Y PaymentNotes
  ];
}

function _tryJson(str, def) { try { return JSON.parse(str); } catch { return def; } }

// ─── CRUD Gastos ─────────────────────────────
async function getExpenses() {
  const rows = await sheetsGet('Rendiciones!A2:Y');
  return rows.map((r, i) => _rowToExpense(r, i + 2));
}

async function addExpense(exp, userEmail, empresa) {
  return sheetsAppend('Rendiciones', _expenseToRow(exp, userEmail, empresa));
}

async function updateExpenseStatus(rowIndex, status, observations, approverEmail) {
  const col = n => String.fromCharCode(64 + n);
  return sheetsBatchUpdate([
    { range: `Rendiciones!${col(9)}${rowIndex}`,  values: [[status]] },
    { range: `Rendiciones!${col(12)}${rowIndex}`, values: [[observations]] },
    { range: `Rendiciones!${col(13)}${rowIndex}`, values: [[approverEmail]] }
  ]);
}

async function updateExpensePayment(rowIndex, payment) {
  const col = n => String.fromCharCode(64 + n);
  const payload = payment || {};
  return sheetsBatchUpdate([
    { range: `Rendiciones!${col(20)}${rowIndex}`, values: [[payload.paymentStatus || '']] },
    { range: `Rendiciones!${col(21)}${rowIndex}`, values: [[payload.paymentBatchId || '']] },
    { range: `Rendiciones!${col(22)}${rowIndex}`, values: [[payload.paymentDate || '']] },
    { range: `Rendiciones!${col(23)}${rowIndex}`, values: [[payload.paymentRef || '']] },
    { range: `Rendiciones!${col(24)}${rowIndex}`, values: [[payload.paymentBy || '']] },
    { range: `Rendiciones!${col(25)}${rowIndex}`, values: [[payload.paymentNotes || '']] }
  ]);
}

function _rowToPayment(row, rowIndex) {
  return {
    rowIndex,
    paymentBatchId: String(row[0] || ''),
    createdAt: String(row[1] || ''),
    paymentStatus: String(row[2] || ''),
    paymentDate: String(row[3] || ''),
    payeeEmail: String(row[4] || '').toLowerCase(),
    payeeName: String(row[5] || ''),
    documentCount: parseInt(row[6], 10) || 0,
    totalAmount: parseFloat(row[7]) || 0,
    paymentRef: String(row[8] || ''),
    paymentNotes: String(row[9] || ''),
    processedBy: String(row[10] || '').toLowerCase(),
    expenseRowsJson: String(row[11] || ''),
    folios: String(row[12] || ''),
    packetFileId: String(row[13] || ''),
    packetUrl: String(row[14] || ''),
    packetMime: String(row[15] || '')
  };
}

function _paymentToRow(payment) {
  const payload = payment || {};
  return [
    payload.paymentBatchId || '',
    payload.createdAt || new Date().toISOString(),
    payload.paymentStatus || 'EN_PREPARACION_PAGO',
    payload.paymentDate || '',
    payload.payeeEmail || '',
    payload.payeeName || '',
    payload.documentCount || 0,
    payload.totalAmount || 0,
    payload.paymentRef || '',
    payload.paymentNotes || '',
    payload.processedBy || '',
    payload.expenseRowsJson || '',
    payload.folios || '',
    payload.packetFileId || '',
    payload.packetUrl || '',
    payload.packetMime || ''
  ];
}

async function ensurePaymentsSheet() {
  const headers = ['paymentBatchId','createdAt','paymentStatus','paymentDate','payeeEmail','payeeName','documentCount','totalAmount','paymentRef','paymentNotes','processedBy','expenseRowsJson','folios','packetFileId','packetUrl','packetMime'];
  await _ensureSheet('Pagos');
  const rows = await sheetsGet('Pagos!A1:P');
  if (!rows.length) {
    await sheetsAppend('Pagos', headers);
  }
}

async function getPayments() {
  await ensurePaymentsSheet();
  const rows = await sheetsGet('Pagos!A2:P');
  return rows.map((r, i) => _rowToPayment(r, i + 2)).filter(p => p.paymentBatchId);
}

async function addPaymentRecord(payment) {
  await ensurePaymentsSheet();
  return sheetsAppend('Pagos', _paymentToRow(payment));
}

async function updatePaymentRecord(rowIndex, payment) {
  await ensurePaymentsSheet();
  return sheetsBatchUpdate([
    { range: `Pagos!A${rowIndex}:P${rowIndex}`, values: [_paymentToRow(payment)] }
  ]);
}

async function savePaymentPacket(paymentBatchId, html) {
  const body = {
    action: 'savePaymentPacket',
    token: getSessionToken(),
    params: { paymentBatchId, html }
  };
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Error al guardar comprobante (' + res.status + ')');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ─── Datos de referencia ──────────────────────
async function getCategories() {
  const rows = await sheetsGet('Categorias!A2:A');
  return rows.map(r => r[0]).filter(Boolean);
}

async function getCostCenters(empresa) {
  const rows = await sheetsGet('CentrosCosto!A2:B');
  return rows
    .map(r => ({ name: r[0] || '', empresa: (r[1] || '').trim() }))
    .filter(r => r.name && (!empresa || !r.empresa || r.empresa === empresa))
    .map(r => r.name);
}

async function getEmpresas() {
  const rows = await sheetsGet('Empresas Grupo!A2:B');
  return rows
    .map(r => ({ nombre: (r[0] || '').trim(), rut: (r[1] || '').trim() }))
    .filter(e => e.nombre);
}

async function getEmpresasFull() {
  const rows = await sheetsGet('Empresas Grupo!A2:B');
  return rows
    .map((r, i) => ({ nombre: (r[0] || '').trim(), rut: (r[1] || '').trim(), rowIndex: i + 2 }))
    .filter(e => e.nombre);
}

async function getCostCentersFull() {
  const rows = await sheetsGet('CentrosCosto!A2:B');
  return rows
    .map((r, i) => ({ name: (r[0] || '').trim(), empresa: (r[1] || '').trim(), rowIndex: i + 2 }))
    .filter(c => c.name);
}

async function _ensureSheet(title) {
  try {
    await callBackend('addSheet', { title });
  } catch (_) {}
}

async function getFondoFijo() {
  const rows = await sheetsGet('FondoFijo!A1:C');
  return rows
    .map((r, i) => ({
      rowIndex: i + 1,
      email:    (r[0] || '').toLowerCase(),
      month:    r[1] || '',
      monto:    parseFloat(r[2]) || 0
    }))
    .filter(r => r.email && r.month);
}

async function setFondoFijo(email, month, monto) {
  await _ensureSheet('FondoFijo');
  const rows  = await getFondoFijo();
  const found = rows.find(r => r.email === email.toLowerCase() && r.month === month);
  if (found) {
    await sheetsBatchUpdate([
      { range: `FondoFijo!A${found.rowIndex}:C${found.rowIndex}`, values: [[email, month, monto]] }
    ]);
  } else {
    await sheetsAppend('FondoFijo', [email, month, monto]);
  }
}

async function deleteFondoFijo(rowIndex) {
  await sheetsBatchUpdate([{ range: `FondoFijo!A${rowIndex}:C${rowIndex}`, values: [['', '', '']] }]);
}

async function getUsers() {
  // Columnas A-G: email, rol, nombre, apellido, (contraseña se omite), notifyEmail, empresa
  const rows = await sheetsGet('Usuarios!A2:G');
  return rows
    .map(r => {
      const nombre   = r[2] || '';
      const apellido = r[3] || '';
      const email    = (r[0] || '').toLowerCase();
      return {
        email,
        role:        r[1] || 'RENDIDOR',
        nombre,
        apellido,
        displayName: (nombre || apellido) ? `${nombre} ${apellido}`.trim() : email,
        notifyEmail: (r[5] || '').trim(),
        empresa:     (r[6] || '').trim()
      };
    })
    .filter(u => u.email);
}

async function getUserRole(email) {
  const users = await getUsers();
  const found = users.find(u => u.email === email.toLowerCase());
  return found ? found.role : 'RENDIDOR';
}

async function addAudit(action, userEmail, details) {
  return sheetsAppend('Audit', [new Date().toISOString(), action, userEmail, JSON.stringify(details)]);
}

// ─────────────────────────────────────────────
//  DRIVE via Apps Script (envía el archivo en base64)
// ─────────────────────────────────────────────
async function uploadFile(file) {
  const toBase64 = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  const base64 = await toBase64(file);
  const mime   = file.type || 'application/octet-stream';

  // Usa POST para el archivo (payload muy grande para URL)
  const body = {
    action: 'uploadFile',
    token:  getSessionToken(),
    params: { name: file.name, data: base64, mime }
  };
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    body:   JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Error al subir archivo (' + res.status + ')');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function getReceiptContent(fileId) {
  const body = {
    action: 'getReceiptContent',
    token:  getSessionToken(),
    params: { fileId }
  };
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    body:   JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Error al obtener adjunto (' + res.status + ')');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ─────────────────────────────────────────────
//  CONFIG DEL SHEET (clave Gemini, etc.)
// ─────────────────────────────────────────────
let _geminiKeyCache = null;

async function getGeminiKey() {
  if (_geminiKeyCache) return _geminiKeyCache;
  const rows = await sheetsGet('Config!A:B');
  const row  = rows.find(r => r[0] === 'GEMINI_API_KEY');
  _geminiKeyCache = row?.[1] || '';
  return _geminiKeyCache;
}

async function setGeminiKey(key) {
  const rows = await sheetsGet('Config!A:B');
  const idx  = rows.findIndex(r => r[0] === 'GEMINI_API_KEY');
  if (idx >= 0) {
    await sheetsBatchUpdate([{ range: `Config!B${idx + 1}`, values: [[key]] }]);
  } else {
    await sheetsAppend('Config', ['GEMINI_API_KEY', key]);
  }
  _geminiKeyCache = key;
}

// ─────────────────────────────────────────────
//  GEMINI OCR API (llamada directa, no pasa por Apps Script)
// ─────────────────────────────────────────────
async function extractFromDocument(file) {
  const toBase64 = f => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });

  const base64 = await toBase64(file);
  const mime   = file.type || 'image/jpeg';

  const prompt = `Analiza este documento (boleta, factura o comprobante de pago) y extrae los siguientes campos en formato JSON:
{
  "docType": "BOLETA | FACTURA | BOUCHER | OTRO",
  "docNumber": "número del documento, folio o código",
  "provider": "nombre del proveedor o empresa emisora",
  "total": número total a pagar (solo el número, sin símbolo de moneda ni puntos de miles),
  "date": "fecha del documento en formato YYYY-MM-DD"
}
Si no puedes determinar algún campo con seguridad, usa null. Responde ÚNICAMENTE con el objeto JSON, sin texto adicional.`;

  const geminiKey = await getGeminiKey();
  if (!geminiKey) throw new Error('Falta la clave Gemini. Configúrala en Administración → Configuración.');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mime, data: base64 } }
          ]
        }]
      })
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Error al analizar el documento con IA');
  }

  const data  = await res.json();
  const text  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No se pudo interpretar la respuesta de la IA');
  return JSON.parse(match[0]);
}

// ─────────────────────────────────────────────
//  EMAIL via Apps Script
// ─────────────────────────────────────────────
async function sendReceipt(expense, toEmail) {
  const recipient = toEmail || CONFIG.RECEIPTS_EMAIL;
  if (!recipient) return;
  return callBackend('sendReceiptEmail', {
    rowIndex: expense.rowIndex,
    to: recipient
  });
}
