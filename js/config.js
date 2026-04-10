const CONFIG = {
  CLIENT_ID:       '455263097487-8eo55fa15bvq0ctcnhi1l8clet3pctp0.apps.googleusercontent.com',
  SHEET_ID:        '1YCr7t4W0WMMRa4e_jS8vN4K8QNGrqYhgXxjakL4YJPU',
  DRIVE_FOLDER_ID: '1F6BHuiP1p1d2-4Kil09VnNxYnF0SpaTn',
  GEMINI_API_KEY:  'AIzaSyBdbVCzK7L0GdYj3dZqEVhkxkZe7FCPC2U',
  RECEIPTS_EMAIL:  '', // ← Pon aquí el Gmail que crees para recibir comprobantes
  SCOPES: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/gmail.send',
    'openid', 'email', 'profile'
  ].join(' ')
};
