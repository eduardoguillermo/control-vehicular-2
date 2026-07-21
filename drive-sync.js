/* drive-sync.js — v1.0.0 (DEV, SOLO LECTURA)
   A propósito, este entorno DEV lee el backup REAL de PROD en Drive
   ("ControlVehicular" / control-vehicular_backup.json) para poder probar
   con datos parecidos a los reales — pero tiene la escritura bloqueada a
   nivel de código: subirBackup() nunca llama a la API de Drive, pase lo
   que pase en app.js. Así no hay forma de que una prueba en DEV corrompa
   o sobreescriba el backup real de PROD.
*/
const DriveSync = (() => {
  const CLIENT_ID = '1049169592532-is5j1j4s1bmgrc9tsq48slrgul8fbj17.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  // OJO: esta es la carpeta REAL de producción. DEV solo lee de acá, nunca escribe.
  const CARPETA = 'ControlVehicular';
  const ARCHIVO_BACKUP = 'control-vehicular_backup.json';

  let tokenClient = null;
  let accessToken = null;
  let folderId = null;
  let backupFileId = null;
  let renewTimer = null;
  let onTokenCallback = null;
  const TOKEN_KEY = 'cveh_dev_drive_token';

  function log(...args) { console.log('[DriveSync DEV]', ...args); }

  function guardarToken(token, expiresInSeg) {
    const vencimiento = Date.now() + (expiresInSeg * 1000) - 60000;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, vencimiento }));
  }
  function tokenGuardadoValido() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const { token, vencimiento } = JSON.parse(raw);
      if (Date.now() < vencimiento) return token;
      return null;
    } catch (e) { return null; }
  }

  function init(onReady) {
    if (!window.google || !google.accounts) {
      log('Google Identity Services todavía no cargó, reintentando...');
      setTimeout(() => init(onReady), 400);
      return;
    }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) { log('Error de token', resp); return; }
          accessToken = resp.access_token;
          guardarToken(accessToken, resp.expires_in || 3600);
          programarRenovacion();
          if (onReady) onReady();
          if (onTokenCallback) onTokenCallback();
        },
        error_callback: (err) => { log('Intento de token falló (silencioso):', err && err.type); }
      });
    }
    const guardado = tokenGuardadoValido();
    if (guardado) {
      accessToken = guardado;
      programarRenovacion();
      if (onReady) onReady();
    } else if (localStorage.getItem(TOKEN_KEY)) {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  function conectar() {
    if (accessToken) return;
    if (!tokenClient) { log('tokenClient no inicializado todavía'); return; }
    tokenClient.requestAccessToken({ prompt: '' });
  }

  function forzarReconexion() {
    accessToken = null;
    localStorage.removeItem(TOKEN_KEY);
    if (tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  function programarRenovacion() {
    if (renewTimer) clearTimeout(renewTimer);
    let delay = 50 * 60 * 1000;
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (raw) {
        const { vencimiento } = JSON.parse(raw);
        delay = Math.max(vencimiento - Date.now() - 60000, 5000);
      }
    } catch (e) { /* usar delay por defecto */ }
    renewTimer = setTimeout(() => {
      tokenClient.requestAccessToken({ prompt: '' });
    }, delay);
  }

  async function api(url, opts = {}) {
    const resp = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${accessToken}` }
    });
    if (!resp.ok) throw new Error(`Drive API ${resp.status}: ${await resp.text()}`);
    return resp;
  }

  let _folderPromise = null;
  async function ensureFolder() {
    if (folderId) return folderId;
    if (_folderPromise) return _folderPromise;
    _folderPromise = (async () => {
      const q = encodeURIComponent(`name='${CARPETA}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const resp = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await resp.json();
      if (data.files && data.files.length) { folderId = data.files[0].id; return folderId; }
      // DEV no crea la carpeta de PROD si no existe — eso significaría que
      // todavía no se sincronizó nada desde producción.
      throw new Error('No se encontró la carpeta de PROD en Drive todavía. Sincronizá primero desde la app de producción.');
    })();
    try { return await _folderPromise; } finally { _folderPromise = null; }
  }

  let _backupFilePromise = null;
  async function ensureBackupFile() {
    if (backupFileId) return backupFileId;
    if (_backupFilePromise) return _backupFilePromise;
    _backupFilePromise = (async () => {
      await ensureFolder();
      const q = encodeURIComponent(`name='${ARCHIVO_BACKUP}' and '${folderId}' in parents and trashed=false`);
      const resp = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await resp.json();
      if (data.files && data.files.length) { backupFileId = data.files[0].id; return backupFileId; }
      // DEV no crea el archivo de backup de PROD si no existe.
      throw new Error('No se encontró el backup de PROD en Drive todavía. Sincronizá primero desde la app de producción.');
    })();
    try { return await _backupFilePromise; } finally { _backupFilePromise = null; }
  }

  // ── ESCRITURA BLOQUEADA A PROPÓSITO ──────────────────────────────────────
  // Estas funciones existen porque app.js las llama igual que en producción
  // (auto-guardado, botón Salir, Sincronizar), pero acá son no-ops seguros:
  // nunca hacen ningún request de escritura a la API de Drive, pase lo que
  // pase. Así no hay ningún camino de código por el que DEV pueda pisar el
  // backup real de PROD.
  async function subirJSON(obj, creando = false, keepalive = false) {
    log('⛔ Subida bloqueada (DEV es de solo lectura). No se escribió nada en Drive.');
    return null;
  }
  async function subirBackup(datosCompletos, keepalive = false) {
    log('⛔ Subida bloqueada (DEV es de solo lectura). No se escribió nada en Drive.');
    return;
  }

  async function bajarBackup() {
    await ensureBackupFile();
    const resp = await api(`https://www.googleapis.com/drive/v3/files/${backupFileId}?alt=media`);
    return resp.json();
  }

  return {
    init, conectar, forzarReconexion,
    subirBackup, bajarBackup,
    onToken(fn){ onTokenCallback = fn; },
    get conectado() { return !!accessToken; },
    get soloLectura() { return true; }
  };
})();
