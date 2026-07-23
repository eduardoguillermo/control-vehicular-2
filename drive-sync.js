/* drive-sync.js — v1.0.0 (DEV)
   Este entorno DEV lee el backup REAL de PROD en Drive ("ControlVehicular" /
   control-vehicular_backup.json) para poder probar con datos parecidos a
   los reales — pero tiene la escritura de ese archivo en vivo bloqueada a
   nivel de código: subirBackup() nunca llama a la API de Drive, pase lo
   que pase en app.js. Así no hay forma de que una prueba en DEV corrompa
   o sobreescriba el backup real de PROD.
   Los backups HISTÓRICOS sí escriben de verdad, pero en su propia carpeta
   separada ("ControlVehicular-DEV"), nunca en la de PROD.
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

  // ── BACKUPS HISTÓRICOS DE DEV (carpeta propia, separada de PROD) ────────
  // A diferencia del archivo en vivo (bloqueado arriba), esto SÍ escribe de
  // verdad — pero en una carpeta propia de DEV ('ControlVehicular-DEV'),
  // jamás en la carpeta real de PROD. Sirve para poder probar la función de
  // backups históricos sin ningún riesgo de tocar los datos reales.
  const CARPETA_DEV = 'ControlVehicular-DEV';
  const PREFIJO_HIST = 'backup_dev_';
  const MAX_BACKUPS_HIST_DEV = 10;
  let folderIdDev = null;
  let _folderDevPromise = null;

  async function ensureFolderDev() {
    if (folderIdDev) return folderIdDev;
    if (_folderDevPromise) return _folderDevPromise;
    _folderDevPromise = (async () => {
      const q = encodeURIComponent(`name='${CARPETA_DEV}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const resp = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await resp.json();
      if (data.files && data.files.length) { folderIdDev = data.files[0].id; return folderIdDev; }
      const createResp = await api('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: CARPETA_DEV, mimeType: 'application/vnd.google-apps.folder' })
      });
      const created = await createResp.json();
      folderIdDev = created.id;
      return folderIdDev;
    })();
    try { return await _folderDevPromise; } finally { _folderDevPromise = null; }
  }

  function _nombreBackupHistoricoDev() {
    const f = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${PREFIJO_HIST}${f.getFullYear()}-${p(f.getMonth()+1)}-${p(f.getDate())}_${p(f.getHours())}${p(f.getMinutes())}.json`;
  }

  async function _subirJSONDev(obj, nombreArchivo) {
    const folder = await ensureFolderDev();
    const boundary = 'cveh_boundary_dev';
    const metadata = { name: nombreArchivo, parents: [folder], mimeType: 'application/json' };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
    const resp = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    const data = await resp.json();
    return data.id;
  }

  async function listarBackupsHistoricos() {
    const folder = await ensureFolderDev();
    const q = encodeURIComponent(`name contains '${PREFIJO_HIST}' and '${folder}' in parents and trashed=false`);
    const resp = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime)&orderBy=createdTime desc&pageSize=50`);
    const data = await resp.json();
    return data.files || [];
  }

  async function bajarBackupPorId(fileId) {
    const resp = await api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return resp.json();
  }

  async function _limpiarBackupsViejosDev() {
    try {
      const files = await listarBackupsHistoricos();
      if (files.length <= MAX_BACKUPS_HIST_DEV) return;
      const sobrantes = files.slice(MAX_BACKUPS_HIST_DEV);
      for (const f of sobrantes) {
        try { await api(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' }); } catch (e) {}
      }
    } catch (e) { log('Error limpiando backups viejos de DEV', e); }
  }

  async function subirBackupHistorico(datosCompletos) {
    await _subirJSONDev(datosCompletos, _nombreBackupHistoricoDev());
    _limpiarBackupsViejosDev();
  }

  return {
    init, conectar, forzarReconexion,
    subirBackup, bajarBackup,
    subirBackupHistorico, listarBackupsHistoricos, bajarBackupPorId,
    onToken(fn){ onTokenCallback = fn; },
    get conectado() { return !!accessToken; },
    get soloLectura() { return true; }
  };
})();
