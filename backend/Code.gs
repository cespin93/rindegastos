// ─────────────────────────────────────────────────────────────────────────────
//  RINDEGASTOS — Google Apps Script Backend
//  Despliega como Web App:
//    Ejecutar como: Yo (sespinosa@mymgroup.org)
//    Quién tiene acceso: Cualquier usuario
// ─────────────────────────────────────────────────────────────────────────────

var SHEET_ID        = '1YCr7t4W0WMMRa4e_jS8vN4K8QNGrqYhgXxjakL4YJPU';
var DRIVE_FOLDER_ID = '1F6BHuiP1p1d2-4Kil09VnNxYnF0SpaTn';
var TOKEN_SECRET    = 'RGmymgroup2024secret'; // Cámbialo por algo único y secreto
var APP_VERSION     = '2026-05-05-stable-1';

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
  return _dispatch(action, params, user);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

function _dispatch(action, params, user) {
  switch (action) {
    case 'sheetsRead':
      return { values: _sheetsRead(params.range) };

    case 'sheetsAppend':
      _sheetsAppend(params.sheet, params.row);
      return { ok: true };

    case 'sheetsBatchUpdate':
      _sheetsBatchUpdate(params.data);
      return { ok: true };

    case 'addSheet':
      _addSheet(params.title);
      return { ok: true };

    case 'uploadFile':
      return _uploadFile(params.name, params.data, params.mime);

    case 'getReceiptContent':
      return _getReceiptContent(params.fileId, user);

    case 'ensureReceiptAccess':
      return _ensureReceiptAccess(params.fileId, user);

    case 'sendEmail':
      _sendEmail(params.to, params.subject, params.htmlBody);
      return { ok: true };

    case 'setPassword':
      _setPassword(params.rowIndex, params.password);
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

function _getReceiptContent(fileId, user) {
  if (!fileId) {
    return { error: 'fileId requerido' };
  }
  if (!user || !user.email) {
    return { error: 'Usuario no autenticado' };
  }
  try {
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

// ─── Sheets ───────────────────────────────────────────────────────────────────

function _colToNum(col) {
  var n = 0;
  col   = col.toUpperCase();
  for (var i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n;
}

function _sheetsRead(rangeStr) {
  var excl      = rangeStr.indexOf('!');
  var sheetName = excl >= 0 ? rangeStr.substring(0, excl) : rangeStr;
  var rangePart = excl >= 0 ? rangeStr.substring(excl + 1) : null;

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

  if (lastRow < startRow || endCol < startCol) return [];

  var numRows = lastRow - startRow + 1;
  var numCols = endCol - startCol + 1;

  var values = sheet.getRange(startRow, startCol, numRows, numCols).getValues();
  return values
    .map(function(r) {
      return r.map(function(c) {
        // Convertir fechas a string ISO para que el JSON sea serializable
        return (c instanceof Date) ? c.toISOString() : (c === null ? '' : c);
      });
    })
    .filter(function(r) {
      return r.some(function(c) { return c !== ''; });
    });
}

function _sheetsAppend(sheetName, row) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.appendRow(row);
}

function _sheetsBatchUpdate(data) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  data.forEach(function(item) {
    ss.getRange(item.range).setValues(item.values);
  });
}

function _addSheet(title) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  if (!ss.getSheetByName(title)) ss.insertSheet(title);
}

function _setPassword(rowIndex, password) {
  var ss    = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName('Usuarios');
  if (!sheet) throw new Error('Hoja Usuarios no encontrada');
  sheet.getRange('E' + rowIndex).setValue(password);
}

// ─── Drive ────────────────────────────────────────────────────────────────────

function _getUploadFolder() {
  _assertDriveAccess();
  try {
    var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    folder.getName();
    return folder;
  } catch (e) {
    Logger.log('DRIVE_FOLDER_ID inaccesible: ' + e.toString());
  }
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
function testDriveAccess() {
  var root = DriveApp.getRootFolder();
  Logger.log('Drive OK — Carpeta raíz: ' + root.getName());
  var folder = _getUploadFolder();
  Logger.log('Carpeta de subida: ' + folder.getName() + ' (' + folder.getId() + ')');
}
