// ─────────────────────────────────────────────────────────────────────────────
//  RINDEGASTOS — Google Apps Script Backend
//  Despliega como Web App:
//    Ejecutar como: Yo (sespinosa@mymgroup.org)
//    Quién tiene acceso: Cualquier usuario
// ─────────────────────────────────────────────────────────────────────────────

var SHEET_ID        = '1YCr7t4W0WMMRa4e_jS8vN4K8QNGrqYhgXxjakL4YJPU';
var DRIVE_FOLDER_ID = '1F6BHuiP1p1d2-4Kil09VnNxYnF0SpaTn';
var TOKEN_SECRET    = 'RGmymgroup2024secret'; // Cámbialo por algo único y secreto
var APP_VERSION     = '2026-06-02-payments-1';
var ADMIN_ROLES     = { ADMIN: true, SUPERADMIN: true };
var EMAIL_ROLES     = { APROBADOR: true, GERENTE: true, ADMIN: true, SUPERADMIN: true };

// ─── Entry points ─────────────────────────────────────────────────────────────

/* GET + JSONP: el cliente pasa ?callback=fnName&d={...} */
function doGet(e) {
  var output;
  try {
    var raw = e.parameter.d; // Apps Script ya decodifica el URL encoding
    if (!raw) { output = { error: 'Sin payload' }; }
    else {
      var body = JSON.parse(raw);
      output   = _handleBody(body);
    }
  } catch (err) {
    output = { error: err.toString() };
  }

  var cb = e.parameter.callback;
  if (cb) {
    // JSONP: envuelve la respuesta en la función callback
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(output) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

/* POST: usado solo para subida de archivos (payload demasiado grande para URL) */
function doPost(e) {
  var output;
  try {
    var body = JSON.parse(e.postData.contents);
    output   = _handleBody(body);
  } catch (err) {
    output = { error: err.toString() };
  }
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

function _handleBody(body) {
  var action = body.action;
  var token  = body.token;
  var params = body.params || {};

  if (action === 'healthcheck') {
    return _healthcheck();
  }
  if (action === 'driveCheck') {
    return _driveCheck();
  }
  if (action === 'uploadProbe') {
    return _uploadProbe();
  }
  if (action === 'login') {
    return _handleLogin(params.email, params.password);
  }
  var user = _validateToken(token);
  if (!user) {
    return { error: 'Sesión inválida o expirada. Inicia sesión nuevamente.' };
  }
  user = _getUserContext(user.email);
  if (!user.exists) {
    return { error: 'Usuario no registrado o sin permisos para usar la aplicación.' };
  }
  return _dispatch(action, params, user);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

function _dispatch(action, params, user) {
  switch (action) {
    case 'sheetsRead':
      return { values: _sheetsRead(params.range, user) };

    case 'sheetsAppend':
      _sheetsAppend(params.sheet, params.row, user);
      return { ok: true };

    case 'sheetsBatchUpdate':
      _sheetsBatchUpdate(params.data, user);
      return { ok: true };

    case 'addSheet':
      _addSheet(params.title, user);
      return { ok: true };

    case 'uploadFile':
      return _uploadFile(params.name, params.data, params.mime);

    case 'getReceiptContent':
      return _getReceiptContent(params.fileId, user);

    case 'ensureReceiptAccess':
      return _ensureReceiptAccess(params.fileId, user);

    case 'sendEmail':
      _requireAdmin(user, 'Solo administración puede usar sendEmail directamente.');
      _sendEmail(params.to, params.subject, params.htmlBody);
      return { ok: true };

    case 'sendReceiptEmail':
      return _sendReceiptEmail(params.rowIndex, params.to, user);

    case 'savePaymentPacket':
      return _savePaymentPacket(params, user);

    case 'setPassword':
      _setPassword(params.rowIndex, params.password, user);
      return { ok: true };

    case 'changeOwnPassword':
      return _changeOwnPassword(user.email, params.currentPassword, params.newPassword);

    default:
      return { error: 'Acción desconocida: ' + action };
  }
}

function _healthcheck() {
  return {
    ok: true,
    version: APP_VERSION,
    timestamp: new Date().toISOString()
  };
}

function _driveCheck() {
  try {
    var folder = _getUploadFolder();
    return {
      ok: true,
      version: APP_VERSION,
      folderId: folder.getId(),
      folderName: folder.getName()
    };
  } catch (e) {
    return {
      ok: false,
      version: APP_VERSION,
      error: e.message || String(e)
    };
  }
}

function _uploadProbe() {
  var probeName = 'upload-probe-' + new Date().getTime() + '.txt';
  try {
    var folder = _getUploadFolder();
    var blob = Utilities.newBlob('ok', 'text/plain', probeName);
    var file;
    try {
      file = folder.createFile(blob);
    } catch (createErr) {
      return {
        ok: false,
        version: APP_VERSION,
        step: 'createFile',
        error: createErr.message || String(createErr)
      };
    }

    var sharing = 'private';
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      sharing = 'anyone_with_link';
    } catch (publicErr) {
      try {
        file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
        sharing = 'domain_with_link';
      } catch (domainErr) {
        sharing = 'private';
      }
    }

    return {
      ok: true,
      version: APP_VERSION,
      step: 'done',
      fileId: file.getId(),
      fileName: file.getName(),
      sharing: sharing
    };
  } catch (e) {
    return {
      ok: false,
      version: APP_VERSION,
      step: 'folder',
      error: e.message || String(e)
    };
  }
}

// ─── Autenticación ────────────────────────────────────────────────────────────

function _handleLogin(email, password) {
  if (!email || !password) {
    return { success: false, error: 'Ingresa email y contraseña.' };
  }

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Usuarios');
  if (!sheet) return { success: false, error: 'Error de configuración (hoja Usuarios no existe).' };

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var rowEmail = String(rows[i][0] || '').toLowerCase().trim();
    if (!rowEmail) continue;
    if (rowEmail !== email.toLowerCase().trim()) continue;

    var pass = String(rows[i][4] || '').trim();
    if (!pass) {
      return { success: false, error: 'Este usuario no tiene contraseña configurada. Contacta al administrador.' };
    }
    if (pass !== password.trim()) {
      return { success: false, error: 'Contraseña incorrecta.' };
    }

    var nombre      = String(rows[i][2] || '');
    var apellido    = String(rows[i][3] || '');
    var displayName = (nombre || apellido) ? (nombre + ' ' + apellido).trim() : rowEmail;

    return {
      success: true,
      token:   _generateToken(rowEmail),
      user: {
        email:       rowEmail,
        role:        String(rows[i][1] || 'RENDIDOR'),
        nombre:      nombre,
        apellido:    apellido,
        displayName: displayName
      }
    };
  }

  return { success: false, error: 'Usuario no registrado.' };
}

function _generateToken(email) {
  var expiry  = Date.now() + 8 * 60 * 60 * 1000; // 8 horas
  var payload = email + ':' + expiry;
  var sig     = Utilities.computeHmacSha256Signature(payload, TOKEN_SECRET);
  var sigHex  = sig.map(function(b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
  return Utilities.base64EncodeWebSafe(payload + ':' + sigHex);
}

function _validateToken(token) {
  if (!token) return null;
  try {
    var decoded   = Utilities.newBlob(Utilities.base64DecodeWebSafe(token)).getDataAsString();
    var lastColon = decoded.lastIndexOf(':');
    var sigHex    = decoded.substring(lastColon + 1);
    var payload   = decoded.substring(0, lastColon);
    var colonIdx  = payload.indexOf(':');
    var email     = payload.substring(0, colonIdx);
    var expiry    = parseInt(payload.substring(colonIdx + 1));

    if (isNaN(expiry) || Date.now() > expiry) return null;

    var expectedSig = Utilities.computeHmacSha256Signature(payload, TOKEN_SECRET);
    var expectedHex = expectedSig.map(function(b) {
      return ('0' + (b & 0xff).toString(16)).slice(-2);
    }).join('');

    if (sigHex !== expectedHex) return null;
    return { email: email };
  } catch (e) {
    return null;
  }
}

function _normalizeEmail(value) {
  return String(value || '').toLowerCase().trim();
}

function _normalizeRole(value) {
  return String(value || 'RENDIDOR').toUpperCase().trim();
}

function _normalizePaymentStatus(value) {
  var normalized = String(value || '').toUpperCase().trim();
  if (!normalized) return 'PENDIENTE_PAGO';
  if (normalized === 'PENDIENTE') return 'PENDIENTE_PAGO';
  return normalized;
}

function _isAdminRole(role) {
  return !!ADMIN_ROLES[_normalizeRole(role)];
}

function _requireAdmin(user, message) {
  if (!_isAdminRole(user && user.role)) {
    throw new Error(message || 'Permiso denegado.');
  }
}

function _getUsersSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName('Usuarios');
}

function _getUserContext(email) {
  var normalized = _normalizeEmail(email);
  var sheet = _getUsersSheet();
  if (!sheet) {
    return { email: normalized, role: 'RENDIDOR', notifyEmail: '', empresa: '', rowIndex: 0, exists: false };
  }
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (_normalizeEmail(rows[i][0]) !== normalized) continue;
    return {
      email: normalized,
      role: _normalizeRole(rows[i][1]),
      nombre: String(rows[i][2] || '').trim(),
      apellido: String(rows[i][3] || '').trim(),
      notifyEmail: String(rows[i][5] || '').trim(),
      empresa: String(rows[i][6] || '').trim(),
      rowIndex: i + 1,
      exists: true
    };
  }
  return { email: normalized, role: 'RENDIDOR', notifyEmail: '', empresa: '', rowIndex: 0, exists: false };
}

function _getUserByRow(rowIndex) {
  var sheet = _getUsersSheet();
  if (!sheet || rowIndex < 2 || rowIndex > sheet.getLastRow()) return null;
  var row = sheet.getRange(rowIndex, 1, 1, 7).getValues()[0];
  var email = _normalizeEmail(row[0]);
  if (!email) return null;
  return {
    email: email,
    role: _normalizeRole(row[1]),
    notifyEmail: String(row[5] || '').trim(),
    empresa: String(row[6] || '').trim(),
    rowIndex: rowIndex
  };
}

function _getManagerCompanyScope(user) {
  if (!user || user.role !== 'GERENTE') return '';
  var key = _normalizeEmail(user.email).split('@')[0] || '';
  if (key === 'mmoreno') return '';
  if (key === 'jpalma') return 'C Y O';
  return String(user.empresa || '').trim();
}

function _parseReceipts(raw) {
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function _mapExpenseRow(row, rowIndex) {
  return {
    rowIndex: rowIndex,
    email: _normalizeEmail(row[2]),
    status: String(row[8] || 'PENDIENTE').trim().toUpperCase(),
    observations: String(row[11] || ''),
    approverEmail: _normalizeEmail(row[12]),
    title: String(row[3] || ''),
    category: String(row[4] || ''),
    total: Number(row[5] || 0),
    fechaGasto: row[1] instanceof Date ? row[1].toISOString().split('T')[0] : String(row[1] || '').split('T')[0],
    docType: String(row[13] || ''),
    docNumber: String(row[14] || ''),
    provider: String(row[15] || ''),
    empresa: String(row[18] || '').trim(),
    paymentStatus: _normalizePaymentStatus(row[19] || ''),
    paymentBatchId: String(row[20] || '').trim(),
    paymentDate: row[21] instanceof Date ? row[21].toISOString().split('T')[0] : String(row[21] || '').split('T')[0],
    paymentRef: String(row[22] || '').trim(),
    paymentBy: _normalizeEmail(row[23]),
    paymentNotes: String(row[24] || '').trim(),
    receipts: _parseReceipts(row[6])
  };
}

function _getExpenseByRowIndex(rowIndex) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Rendiciones');
  if (!sheet || rowIndex < 2 || rowIndex > sheet.getLastRow()) return null;
  var row = sheet.getRange(rowIndex, 1, 1, 25).getValues()[0];
  if (!row || !row.some(function(cell) { return cell !== ''; })) return null;
  return _mapExpenseRow(row, rowIndex);
}

function _getExpenseByReceiptId(fileId) {
  if (!fileId) return null;
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Rendiciones');
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var rows = sheet.getRange(2, 1, lastRow - 1, 25).getValues();
  for (var i = 0; i < rows.length; i++) {
    var expense = _mapExpenseRow(rows[i], i + 2);
    for (var j = 0; j < expense.receipts.length; j++) {
      if (String(expense.receipts[j] && expense.receipts[j].id || '') === String(fileId)) {
        return expense;
      }
    }
  }
  return null;
}

function _canUserAccessExpense(user, expense) {
  if (!user || !expense) return false;
  if (_isAdminRole(user.role)) return true;
  if (expense.approverEmail === _normalizeEmail(user.email)) return true;
  if (user.role === 'GERENTE') {
    var scope = _getManagerCompanyScope(user);
    return !scope || expense.empresa === scope;
  }
  return expense.email === _normalizeEmail(user.email);
}

function _assertReceiptAccess(fileId, user) {
  var expense = _getExpenseByReceiptId(fileId);
  if (!expense) {
    throw new Error('No se encontró una rendición asociada al adjunto solicitado.');
  }
  if (!_canUserAccessExpense(user, expense)) {
    throw new Error('No tienes permisos para acceder a este adjunto.');
  }
  return expense;
}

function _parseRangeMeta(rangeStr) {
  var excl = String(rangeStr || '').indexOf('!');
  var sheetName = excl >= 0 ? rangeStr.substring(0, excl) : String(rangeStr || '');
  var rangePart = excl >= 0 ? rangeStr.substring(excl + 1) : '';
  var parts = rangePart ? rangePart.split(':') : [];
  var start = parts[0] || 'A1';
  var end = parts[1] || start;
  var startMatch = start.match(/([A-Za-z]+)(\d*)/);
  var endMatch = end.match(/([A-Za-z]+)(\d*)/);
  var startCol = startMatch ? _colToNum(startMatch[1]) : 1;
  var endCol = endMatch ? _colToNum(endMatch[1]) : startCol;
  var startRow = startMatch && startMatch[2] ? parseInt(startMatch[2], 10) : 1;
  var endRow = endMatch && endMatch[2] ? parseInt(endMatch[2], 10) : startRow;
  return {
    sheetName: sheetName,
    startCol: startCol,
    endCol: endCol,
    startRow: startRow,
    endRow: endRow
  };
}

function _sanitizeUsersValues(values, startCol) {
  var passwordIndex = 5 - startCol;
  if (passwordIndex < 0) return values;
  return values.map(function(row) {
    var copy = row.slice();
    if (passwordIndex < copy.length) copy[passwordIndex] = '';
    return copy;
  });
}

function _filterExpenseReadValues(sheet, startRow, values, user) {
  if (!values || !values.length || _isAdminRole(user.role)) return values;

  var fullRows = sheet.getRange(startRow, 1, values.length, 19).getValues();
  var filtered = [];

  for (var i = 0; i < values.length; i++) {
    var fullRow = fullRows[i];
    if (!fullRow || !fullRow.some(function(cell) { return cell !== ''; })) continue;

    var expense = _mapExpenseRow(fullRow, startRow + i);
    if (_canUserAccessExpense(user, expense)) {
      filtered.push(values[i]);
    }
  }

  return filtered;
}

function _authorizeSheetRead(meta, user) {
  var sheetName = meta.sheetName;
  if ((sheetName === 'Audit' || sheetName === 'Pagos') && !_isAdminRole(user.role)) {
    throw new Error('Permiso denegado para leer ' + sheetName + '.');
  }
}

function _authorizeSheetAppend(sheetName, row, user) {
  if (sheetName === 'Rendiciones') {
    if (_normalizeEmail(row && row[2]) !== _normalizeEmail(user.email)) {
      throw new Error('No puedes crear rendiciones en nombre de otro usuario.');
    }
    return;
  }
  if (sheetName === 'Audit') {
    if (_normalizeEmail(row && row[2]) !== _normalizeEmail(user.email)) {
      throw new Error('No puedes registrar auditoría en nombre de otro usuario.');
    }
    return;
  }
  if (sheetName === 'Pagos') {
    _requireAdmin(user, 'Permiso denegado para insertar en Pagos.');
    if (String(row && row[0] || '').trim() === 'paymentBatchId') return;
    if (_normalizeEmail(row && row[10]) !== _normalizeEmail(user.email)) {
      throw new Error('El procesador del pago debe coincidir con el usuario autenticado.');
    }
    return;
  }
  _requireAdmin(user, 'Permiso denegado para insertar en ' + sheetName + '.');
  if (sheetName === 'Usuarios' && _normalizeRole(row && row[1]) === 'SUPERADMIN' && user.role !== 'SUPERADMIN') {
    throw new Error('Solo un SUPERADMIN puede crear otro SUPERADMIN.');
  }
}

function _authorizeUserRowMutation(meta, user, valueMatrix) {
  _requireAdmin(user, 'Permiso denegado para modificar usuarios.');
  var target = _getUserByRow(meta.startRow);
  if (target && target.role === 'SUPERADMIN' && user.role !== 'SUPERADMIN') {
    throw new Error('Solo un SUPERADMIN puede modificar otro SUPERADMIN.');
  }
  if (meta.startCol <= 5 && meta.endCol >= 5) {
    throw new Error('Usa setPassword o changeOwnPassword para modificar contraseñas.');
  }
  if (meta.startCol <= 2 && meta.endCol >= 2) {
    var newRole = _normalizeRole(valueMatrix && valueMatrix[0] && valueMatrix[0][0]);
    if (newRole === 'SUPERADMIN' && user.role !== 'SUPERADMIN') {
      throw new Error('Solo un SUPERADMIN puede asignar ese rol.');
    }
  }
}

function _authorizeExpenseStatusChange(rowIndex, newStatus, user) {
  var expense = _getExpenseByRowIndex(rowIndex);
  if (!expense) throw new Error('La rendición indicada no existe.');
  if (expense.paymentStatus === 'PAGADO' || expense.paymentStatus === 'EN_PREPARACION_PAGO') {
    throw new Error('No se puede cambiar el estado de una rendición que ya está en flujo de pago.');
  }
  var actorEmail = _normalizeEmail(user.email);
  if (expense.email === actorEmail && user.role !== 'SUPERADMIN') {
    throw new Error('No puedes decidir sobre tus propias rendiciones.');
  }
  var owner = _getUserContext(expense.email);
  var canApprove = _isAdminRole(user.role) || (user.role === 'APROBADOR' && expense.approverEmail === actorEmail);
  var canManageGerencia = (_isAdminRole(user.role) || user.role === 'GERENTE') && _canUserAccessExpense(user, expense);

  if (expense.status === 'PENDIENTE') {
    if (newStatus === 'APROBADO' || newStatus === 'RECHAZADO') {
      if (!canApprove) throw new Error('No tienes permisos para aprobar o rechazar esta rendición.');
      return expense;
    }
    if (newStatus === 'AUTORIZADO' && owner.role === 'GERENTE' && canApprove) {
      return expense;
    }
  }

  if (expense.status === 'APROBADO' && (newStatus === 'AUTORIZADO' || newStatus === 'RECHAZADO')) {
    if (!canManageGerencia) throw new Error('No tienes permisos gerenciales sobre esta rendición.');
    return expense;
  }

  throw new Error('Cambio de estado no permitido para la rendición seleccionada.');
}

function _authorizeExpensePaymentMutation(rowIndex, newPaymentStatus, user) {
  var expense = _getExpenseByRowIndex(rowIndex);
  if (!expense) throw new Error('La rendición indicada no existe.');
  _requireAdmin(user, 'Solo administración puede gestionar pagos.');
  if (expense.status !== 'AUTORIZADO') {
    throw new Error('Solo se pueden gestionar pagos sobre rendiciones autorizadas.');
  }

  var currentStatus = _normalizePaymentStatus(expense.paymentStatus);
  var nextStatus = _normalizePaymentStatus(newPaymentStatus);
  var allowed = {
    PENDIENTE_PAGO: { EN_PREPARACION_PAGO: true, PAGADO: true, ANULADO_PAGO: true },
    EN_PREPARACION_PAGO: { PENDIENTE_PAGO: true, PAGADO: true, ANULADO_PAGO: true },
    PAGADO: { ANULADO_PAGO: true },
    ANULADO_PAGO: { PENDIENTE_PAGO: true, EN_PREPARACION_PAGO: true }
  };

  if (currentStatus === nextStatus) return expense;
  if (!allowed[currentStatus] || !allowed[currentStatus][nextStatus]) {
    throw new Error('Cambio de estado de pago no permitido para la rendición seleccionada.');
  }
  return expense;
}

function _authorizeBatchUpdate(data, user) {
  var statusByRow = {};
  var paymentStatusByRow = {};
  (data || []).forEach(function(item) {
    var meta = _parseRangeMeta(item.range);
    if (meta.sheetName === 'Rendiciones' && meta.startCol === 9 && meta.endCol === 9) {
      statusByRow[meta.startRow] = String(item.values && item.values[0] && item.values[0][0] || '').toUpperCase().trim();
      return;
    }
    if (meta.sheetName === 'Rendiciones' && meta.startCol === 20 && meta.endCol === 20) {
      paymentStatusByRow[meta.startRow] = _normalizePaymentStatus(item.values && item.values[0] && item.values[0][0]);
    }
  });

  (data || []).forEach(function(item) {
    var meta = _parseRangeMeta(item.range);
    if (meta.sheetName === 'Rendiciones') {
      if (meta.startRow !== meta.endRow || meta.startCol !== meta.endCol) {
        throw new Error('Solo se permiten actualizaciones puntuales sobre rendiciones.');
      }
      if ([9, 12, 13, 20, 21, 22, 23, 24, 25].indexOf(meta.startCol) === -1) {
        throw new Error('No está permitido modificar esa columna de Rendiciones desde el cliente.');
      }
      if (meta.startCol === 9 || meta.startCol === 12 || meta.startCol === 13) {
        var newStatus = statusByRow[meta.startRow];
        if (!newStatus) {
          throw new Error('Las actualizaciones de rendición deben incluir el nuevo estado.');
        }
        _authorizeExpenseStatusChange(meta.startRow, newStatus, user);
        if (meta.startCol === 13) {
          var approverEmail = _normalizeEmail(item.values && item.values[0] && item.values[0][0]);
          if (approverEmail !== _normalizeEmail(user.email)) {
            throw new Error('El aprobador registrado debe coincidir con el usuario autenticado.');
          }
        }
        return;
      }

      var nextPaymentStatus = paymentStatusByRow[meta.startRow];
      if (!nextPaymentStatus) {
        throw new Error('Las actualizaciones de pago deben incluir el estado de pago.');
      }
      _authorizeExpensePaymentMutation(meta.startRow, nextPaymentStatus, user);
      if (meta.startCol === 24) {
        var paymentBy = _normalizeEmail(item.values && item.values[0] && item.values[0][0]);
        if (paymentBy !== _normalizeEmail(user.email)) {
          throw new Error('El usuario que procesa el pago debe coincidir con la sesión autenticada.');
        }
      }
      return;
    }

    if (meta.sheetName === 'Usuarios') {
      _authorizeUserRowMutation(meta, user, item.values);
      return;
    }

    if (meta.sheetName === 'Config' || meta.sheetName === 'Categorias' || meta.sheetName === 'CentrosCosto' || meta.sheetName === 'Empresas Grupo' || meta.sheetName === 'FondoFijo') {
      _requireAdmin(user, 'Permiso denegado para modificar ' + meta.sheetName + '.');
      return;
    }

    if (meta.sheetName === 'Pagos') {
      _requireAdmin(user, 'Permiso denegado para modificar Pagos.');
      return;
    }

    throw new Error('Actualización no permitida sobre la hoja ' + meta.sheetName + '.');
  });
}

function _sanitizeFileName(name) {
  return String(name || 'archivo')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function _applyFileSharing(file) {
  var sharing = 'private';
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    sharing = 'anyone_with_link';
  } catch (e) {
    try {
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
      sharing = 'domain_with_link';
    } catch (_) {
      sharing = 'private';
    }
  }
  return sharing;
}

function _embedDriveImages(html) {
  var token = ScriptApp.getOAuthToken();

  // Collect unique file IDs (preserve order, avoid duplicate fetches)
  var fileIds = [];
  var seen = {};
  var re = /src="drive-embed:\/\/([^"]+)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = true; fileIds.push(m[1]); }
  }
  if (!fileIds.length) return html;

  // Fetch all thumbnails in parallel — avoids sequential timeout with many receipts.
  // sz=w700-h900: readable when printed on A4, keeps each thumbnail ~60-150 KB.
  var requests = fileIds.map(function(id) {
    return {
      url: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w700-h900',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
      followRedirects: true
    };
  });

  var responses;
  try { responses = UrlFetchApp.fetchAll(requests); }
  catch (e) { Logger.log('fetchAll error: ' + e); return html; }

  var uriMap = {};
  fileIds.forEach(function(id, i) {
    try {
      var res = responses[i];
      var ct  = String(res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '');
      if (res.getResponseCode() === 200 && ct.indexOf('image') !== -1) {
        uriMap[id] = 'data:image/jpeg;base64,' + Utilities.base64Encode(res.getContent());
        return;
      }
    } catch (e) { /* skip */ }
    // Fallback: raw file only if ≤ 700 KB (avoids bloating the HTML)
    try {
      var blob = DriveApp.getFileById(id).getBlob();
      var raw  = blob.getBytes();
      if (raw.length <= 716800) {
        uriMap[id] = 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(raw);
      }
    } catch (fe) { /* skip */ }
  });

  return html.replace(/src="drive-embed:\/\/([^"]+)"/g, function(match, id) {
    return uriMap[id] ? 'src="' + uriMap[id] + '"' : 'src=""';
  });
}

function _savePaymentPacket(params, user) {
  _requireAdmin(user, 'Solo administración puede guardar comprobantes de pago.');
  var html = String(params && params.html || '').trim();
  if (!html) throw new Error('El comprobante no contiene contenido para guardar.');

  // Embed all Drive images server-side before PDF conversion.
  html = _embedDriveImages(html);

  var batchId = String(params && params.paymentBatchId || 'pago').trim();
  var fileName = _sanitizeFileName('comprobante-' + batchId + '.pdf');
  var folder = _getUploadFolder();
  var pdfBlob = HtmlService.createHtmlOutput(html).getBlob().getAs(MimeType.PDF);
  pdfBlob.setName(fileName);

  var file = folder.createFile(pdfBlob);
  var sharing = _applyFileSharing(file);
  return {
    ok: true,
    fileId: file.getId(),
    fileName: file.getName(),
    url: file.getUrl(),
    mime: 'application/pdf',
    sharing: sharing
  };
}

function _buildReceiptEmailHtml(expense, recipient) {
  var isOwner = _normalizeEmail(recipient) === _normalizeEmail(expense.email);
  var statusLabel = {
    APROBADO: 'aprobada ✅',
    AUTORIZADO: 'autorizada ✅',
    RECHAZADO: 'rechazada ❌',
    PENDIENTE: 'pendiente'
  }[expense.status] || expense.status;
  var statusColor = {
    APROBADO: '#16a34a',
    AUTORIZADO: '#7c3aed',
    RECHAZADO: '#dc2626',
    PENDIENTE: '#d97706'
  }[expense.status] || '#6b7280';
  var monto = '$' + Number(expense.total || 0).toLocaleString('es-CL');
  return {
    subject: isOwner ? 'Tu rendición fue ' + statusLabel + ' - ' + expense.title : '[Rindegastos] ' + expense.status + ' - ' + expense.title,
    html: '<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#111827">'
      + '<div style="background:#1e40af;padding:24px;border-radius:10px 10px 0 0"><h1 style="margin:0;color:#fff;font-size:18px">Comprobante de Rendición de Gastos</h1></div>'
      + '<div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 10px 10px">'
      + '<table style="width:100%;border-collapse:collapse;font-size:14px">'
      + '<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280;width:130px">Empleado</td><td style="padding:9px 0">' + expense.email + '</td></tr>'
      + '<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Concepto</td><td style="padding:9px 0;font-weight:bold">' + expense.title + '</td></tr>'
      + '<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Categoría</td><td style="padding:9px 0">' + expense.category + '</td></tr>'
      + '<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Fecha gasto</td><td style="padding:9px 0">' + expense.fechaGasto + '</td></tr>'
      + '<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Documento</td><td style="padding:9px 0">' + expense.docType + ' ' + (expense.docNumber || '') + '</td></tr>'
      + '<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Proveedor</td><td style="padding:9px 0">' + (expense.provider || '—') + '</td></tr>'
      + '<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:9px 0;color:#6b7280">Monto</td><td style="padding:9px 0;font-size:20px;font-weight:bold">' + monto + '</td></tr>'
      + '<tr><td style="padding:9px 0;color:#6b7280">Estado</td><td style="padding:9px 0"><span style="background:' + statusColor + ';color:#fff;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:bold">' + expense.status + '</span></td></tr>'
      + (expense.observations ? '<tr><td style="padding:9px 0;color:#6b7280">Observaciones</td><td style="padding:9px 0">' + expense.observations + '</td></tr>' : '')
      + '</table></div><p style="font-size:11px;color:#9ca3af;margin-top:12px">Rindegastos &bull; ' + new Date().toLocaleString('es-CL') + '</p></div>'
  };
}

function _sendReceiptEmail(rowIndex, to, user) {
  var expense = _getExpenseByRowIndex(Number(rowIndex));
  if (!expense) return { error: 'La rendición indicada no existe.' };
  if (!_canUserAccessExpense(user, expense)) {
    return { error: 'No tienes permisos para enviar este comprobante.' };
  }
  var recipient = String(to || '').trim();
  if (!recipient) return { error: 'Debes indicar un destinatario.' };
  if (user.role === 'RENDIDOR' && _normalizeEmail(recipient) !== expense.email) {
    return { error: 'Los rendidores solo pueden enviarse comprobantes a sí mismos.' };
  }
  var payload = _buildReceiptEmailHtml(expense, recipient);
  _sendEmail(recipient, payload.subject, payload.html);
  return { ok: true };
}

// ─── Sheets ───────────────────────────────────────────────────────────────────

function _colToNum(col) {
  var n = 0;
  col   = col.toUpperCase();
  for (var i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n;
}

function _sheetsRead(rangeStr, user) {
  var meta      = _parseRangeMeta(rangeStr);
  var excl      = rangeStr.indexOf('!');
  var sheetName = excl >= 0 ? rangeStr.substring(0, excl) : rangeStr;
  var rangePart = excl >= 0 ? rangeStr.substring(excl + 1) : null;

  _authorizeSheetRead(meta, user);

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var startRow = 1;
  var startCol = 1;
  var endCol   = sheet.getLastColumn();
  var lastRow  = sheet.getLastRow();

  if (rangePart) {
    var parts      = rangePart.split(':');
    var startMatch = parts[0].match(/([A-Za-z]+)(\d*)/);
    if (startMatch) {
      startCol = _colToNum(startMatch[1]);
      if (startMatch[2]) startRow = parseInt(startMatch[2]);
    }
    if (parts[1]) {
      var endMatch = parts[1].match(/([A-Za-z]+)/);
      if (endMatch) endCol = _colToNum(endMatch[1]);
    }
  }

  // Evitar excepción si el rango solicitado supera las columnas reales de la hoja
  var maxCols = sheet.getMaxColumns();
  if (endCol > maxCols) endCol = maxCols;

  if (lastRow < startRow || endCol < startCol) return [];

  var numRows = lastRow - startRow + 1;
  var numCols = endCol - startCol + 1;

  var values = sheet.getRange(startRow, startCol, numRows, numCols).getValues();
  var serialized = values
    .map(function(r) {
      return r.map(function(c) {
        // Convertir fechas a string ISO para que el JSON sea serializable
        return (c instanceof Date) ? c.toISOString() : (c === null ? '' : c);
      });
    })
    .filter(function(r) {
      return r.some(function(c) { return c !== ''; });
    });

  if (sheetName === 'Usuarios') {
    serialized = _sanitizeUsersValues(serialized, startCol);
  }

  return serialized;
}

function _sheetsAppend(sheetName, row, user) {
  _authorizeSheetAppend(sheetName, row, user);
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.appendRow(row);
}

function _sheetsBatchUpdate(data, user) {
  _authorizeBatchUpdate(data, user);
  var ss = SpreadsheetApp.openById(SHEET_ID);
  data.forEach(function(item) {
    ss.getRange(item.range).setValues(item.values);
  });
}

function _addSheet(title, user) {
  _requireAdmin(user, 'Permiso denegado para crear hojas.');
  var ss = SpreadsheetApp.openById(SHEET_ID);
  if (!ss.getSheetByName(title)) ss.insertSheet(title);
}

function _setPassword(rowIndex, password, user) {
  _requireAdmin(user, 'Permiso denegado para cambiar contraseñas de otros usuarios.');
  var target = _getUserByRow(Number(rowIndex));
  if (!target) throw new Error('Usuario no encontrado.');
  if (target.role === 'SUPERADMIN' && user.role !== 'SUPERADMIN') {
    throw new Error('Solo un SUPERADMIN puede cambiar la contraseña de otro SUPERADMIN.');
  }
  var sheet = _getUsersSheet();
  if (!sheet) throw new Error('Hoja Usuarios no encontrada');
  sheet.getRange('E' + rowIndex).setValue(password);
}

// ─── Drive ────────────────────────────────────────────────────────────────────

function _getUploadFolder() {
  _assertDriveAccess();
  // Primero intenta usar el folder configurado
  try {
    var f = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    f.getName(); // fuerza validación de acceso
    return f;
  } catch (e) {
    Logger.log('DRIVE_FOLDER_ID inaccesible: ' + e.toString());
  }
  // Fallback: busca o crea "Rindegastos Archivos" en My Drive
  var it = DriveApp.getFoldersByName('Rindegastos Archivos');
  if (it.hasNext()) return it.next();
  var created = DriveApp.createFolder('Rindegastos Archivos');
  Logger.log('Folder creado: ' + created.getId() + ' — actualiza DRIVE_FOLDER_ID con este valor.');
  return created;
}

function _assertDriveAccess() {
  try {
    DriveApp.getRootFolder().getId();
  } catch (e) {
    throw new Error(
      'El backend no tiene permisos de Google Drive. Reautoriza el proyecto de Apps Script y vuelve a desplegar la Web App.'
    );
  }
}

function _uploadFile(name, base64data, mime) {
  try {
    var folder = _getUploadFolder();
    var bytes  = Utilities.base64Decode(base64data);
    var blob   = Utilities.newBlob(bytes, mime || 'application/octet-stream', name);
    var file;
    try {
      file = folder.createFile(blob);
    } catch (createErr) {
      return {
        error: 'No se pudo crear el archivo en Google Drive [' + APP_VERSION + ']: ' + (createErr.message || String(createErr))
      };
    }
    var sharing = 'private';
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      sharing = 'anyone_with_link';
    } catch (e) {
      try {
        file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
        sharing = 'domain_with_link';
      } catch (shareErr) {
        Logger.log('No se pudo cambiar el sharing del archivo %s: %s', file.getName(), shareErr.toString());
      }
    }
    return {
      id:   file.getId(),
      name: file.getName(),
      url:  file.getUrl(),
      mime: mime,
      sharing: sharing
    };
  } catch (e) {
    return {
      error: 'No se pudo subir el archivo a Google Drive [' + APP_VERSION + ']: ' + (e.message || String(e))
    };
  }
}

function _ensureReceiptAccess(fileId, user) {
  if (!fileId) {
    return { error: 'fileId requerido' };
  }
  if (!user || !user.email) {
    return { error: 'Usuario no autenticado' };
  }
  try {
    _assertReceiptAccess(fileId, user);
    var file = DriveApp.getFileById(fileId);
    try {
      file.addViewer(user.email);
    } catch (viewerErr) {
      Logger.log('No se pudo agregar viewer %s al archivo %s: %s', user.email, fileId, viewerErr.toString());
    }
    return {
      ok: true,
      fileId: file.getId(),
      url: file.getUrl()
    };
  } catch (e) {
    return { error: 'No se pudo dar acceso al adjunto: ' + (e.message || String(e)) };
  }
}

function _getReceiptContent(fileId, user) {
  if (!fileId) {
    return { error: 'fileId requerido' };
  }
  if (!user || !user.email) {
    return { error: 'Usuario no autenticado' };
  }
  try {
    _assertReceiptAccess(fileId, user);
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    return {
      ok: true,
      fileId: file.getId(),
      name: file.getName(),
      mime: blob.getContentType() || file.getMimeType() || 'application/octet-stream',
      data: Utilities.base64Encode(blob.getBytes())
    };
  } catch (e) {
    return { error: 'No se pudo obtener el adjunto: ' + (e.message || String(e)) };
  }
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

function _sendEmail(to, subject, htmlBody) {
  if (!to) return;
  GmailApp.sendEmail(to, subject, '', { htmlBody: htmlBody });
}

function _changeOwnPassword(email, currentPassword, newPassword) {
  if (!currentPassword || !newPassword) return { error: 'Debes ingresar ambas contraseñas.' };
  if (newPassword.length < 6) return { error: 'La nueva contraseña debe tener al menos 6 caracteres.' };

  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Usuarios');
  if (!sheet) return { error: 'Error de configuración.' };

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var rowEmail = String(rows[i][0] || '').toLowerCase().trim();
    if (rowEmail !== email.toLowerCase().trim()) continue;

    var stored = String(rows[i][4] || '').trim();
    if (stored !== currentPassword.trim()) return { error: 'La contraseña actual es incorrecta.' };

    sheet.getRange('E' + (i + 1)).setValue(newPassword.trim());
    return { ok: true };
  }
  return { error: 'Usuario no encontrado.' };
}

// ─── Test / Re-autorización ───────────────────────────────────────────────────
// Ejecuta esta función desde el editor de Apps Script para re-autorizar DriveApp.
// Una vez que el log diga "OK", elimínala y vuelve a desplegar.
function testDriveAccess() {
  var root = DriveApp.getRootFolder();
  Logger.log('Drive OK — Carpeta raíz: ' + root.getName());
  var folder = _getUploadFolder();
  Logger.log('Carpeta de subida: ' + folder.getName() + ' (' + folder.getId() + ')');
}
