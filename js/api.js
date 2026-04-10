// ─────────────────────────────────────────────
//  SHEETS API
// ─────────────────────────────────────────────
const _BASE = 'https://sheets.googleapis.com/v4/spreadsheets/' + CONFIG.SHEET_ID;

async function sheetsGet(range) {
  try {
    const d = await fetchWithAuth(`${_BASE}/values/${encodeURIComponent(range)}`);
    return d.values || [];
  } catch (e) {
    // Si la pestaña no existe en el Sheet, devuelve vacío en vez de romper
    console.warn('[Rindegastos] sheetsGet falló para:', range, '→', e.message);
    return [];
  }
}

async function sheetsAppend(sheet, row) {
  return fetchWithAuth(
    `${_BASE}/values/${encodeURIComponent(sheet + '!A:Z')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) }
  );
}

async function sheetsBatchUpdate(data) {
  return fetchWithAuth(`${_BASE}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data })
  });
}

// ─── Mapeo fila ↔ objeto ─────────────────────
function _rowToExpense(row, rowIndex) {
  return {
    rowIndex,
    timestamp:     row[0]  || '',
    fechaGasto:    row[1]  || '',
    email:        (row[2]  || '').toLowerCase(),
    title:         row[3]  || '',
    category:      row[4]  || '',
    total:         parseFloat(row[5]) || 0,
    receipts:      _tryJson(row[6], []),
    notes:         row[7]  || '',
    status:        row[8]  || 'PENDIENTE',
    // row[9]=token, row[10]=tokenExpiry (legado, no se usan)
    observations:  row[11] || '',
    approverEmail:(row[12] || '').toLowerCase(),
    docType:       row[13] || '',
    docNumber:     row[14] || '',
    provider:      row[15] || ''
  };
}

function _expenseToRow(exp, userEmail) {
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
    exp.docType   || '',      // N DocumentType
    exp.docNumber || '',      // O DocumentNumber
    exp.provider  || ''       // P Provider
  ];
}

function _tryJson(str, def) { try { return JSON.parse(str); } catch { return def; } }

// ─── CRUD Gastos ─────────────────────────────
async function getExpenses() {
  const rows = await sheetsGet('Rendiciones!A2:P');
  return rows.map((r, i) => _rowToExpense(r, i + 2));
}

async function addExpense(exp, userEmail) {
  return sheetsAppend('Rendiciones', _expenseToRow(exp, userEmail));
}

async function updateExpenseStatus(rowIndex, status, observations, approverEmail) {
  const col = n => String.fromCharCode(64 + n); // 9→I, 12→L, 13→M
  return sheetsBatchUpdate([
    { range: `Rendiciones!${col(9)}${rowIndex}`,  values: [[status]] },
    { range: `Rendiciones!${col(12)}${rowIndex}`, values: [[observations]] },
    { range: `Rendiciones!${col(13)}${rowIndex}`, values: [[approverEmail]] }
  ]);
}

// ─── Datos de referencia ──────────────────────
async function getCategories() {
  const rows = await sheetsGet('Categorias!A2:A');
  return rows.map(r => r[0]).filter(Boolean);
}

async function getUsers() {
  const rows = await sheetsGet('Usuarios!A2:B');
  return rows
    .map(r => ({ email: (r[0] || '').toLowerCase(), role: r[1] || 'RENDIDOR' }))
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
//  DRIVE API
// ─────────────────────────────────────────────
async function uploadFile(file) {
  const meta = { name: file.name, parents: [CONFIG.DRIVE_FOLDER_ID] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', file);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType',
    { method: 'POST', headers: { Authorization: 'Bearer ' + getAccessToken() }, body: form }
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || 'Error al subir archivo');
  }
  const data = await res.json();

  // Hacer el archivo viewable por cualquiera con el link
  await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + getAccessToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' })
  });

  return { id: data.id, name: data.name, url: data.webViewLink, mime: data.mimeType };
}

// ─────────────────────────────────────────────
//  GEMINI OCR API
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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
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

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No se pudo interpretar la respuesta de la IA');
  return JSON.parse(match[0]);
}

// ─────────────────────────────────────────────
//  GMAIL API
// ─────────────────────────────────────────────
async function sendReceipt(expense, toEmail) {
  const recipient = toEmail || CONFIG.RECEIPTS_EMAIL;
  if (!recipient) return;

  const statusColor = { APROBADO: '#16a34a', RECHAZADO: '#dc2626', PENDIENTE: '#d97706' }[expense.status] || '#6b7280';
  const monto = '$' + Number(expense.total).toLocaleString('es-CL');

  const html = `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#111827">
  <div style="background:#1e40af;padding:24px;border-radius:10px 10px 0 0">
    <h1 style="margin:0;color:#fff;font-size:18px">Comprobante de Rendición de Gastos</h1>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 10px 10px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280;width:130px">Empleado</td><td style="padding:9px 0">${expense.email}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Concepto</td><td style="padding:9px 0;font-weight:bold">${expense.title}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Categoría</td><td style="padding:9px 0">${expense.category}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Fecha gasto</td><td style="padding:9px 0">${expense.fechaGasto}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Documento</td><td style="padding:9px 0">${expense.docType} ${expense.docNumber || ''}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Proveedor</td><td style="padding:9px 0">${expense.provider || '—'}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Monto</td><td style="padding:9px 0;font-size:20px;font-weight:bold">${monto}</td></tr>
      <tr><td style="padding:9px 0;color:#6b7280">Estado</td>
          <td style="padding:9px 0"><span style="background:${statusColor};color:#fff;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:bold">${expense.status}</span></td></tr>
      ${expense.observations ? `<tr><td style="padding:9px 0;color:#6b7280">Observaciones</td><td style="padding:9px 0">${expense.observations}</td></tr>` : ''}
    </table>
  </div>
  <p style="font-size:11px;color:#9ca3af;margin-top:12px">Rindegastos &bull; ${new Date().toLocaleString('es-CL')}</p>
</div>`;

  const raw = [
    `To: ${recipient}`,
    `Subject: [Rindegastos] ${expense.status} - ${expense.title}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html
  ].join('\r\n');

  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return fetchWithAuth('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw: encoded })
  });
}
