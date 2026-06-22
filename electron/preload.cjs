const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  // ── Version ────────────────────────────────────────────────────────────────
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // ── Update actions ─────────────────────────────────────────────────────────
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:  () => ipcRenderer.invoke('download-update'),
  installUpdate:   () => ipcRenderer.invoke('install-update'),

  // ── Update events (main → renderer) ───────────────────────────────────────
  onUpdateAvailable:        (cb) => ipcRenderer.on('update-available',         (_, d) => cb(d)),
  onUpdateNotAvailable:     (cb) => ipcRenderer.on('update-not-available',     (_, d) => cb(d)),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_, d) => cb(d)),
  onUpdateDownloaded:       (cb) => ipcRenderer.on('update-downloaded',        (_, d) => cb(d)),
  onUpdateError:            (cb) => ipcRenderer.on('update-error',             (_, d) => cb(d)),

  // ── Menu navigation events (main menu → renderer) ─────────────────────────
  onMenuNavigate:       (cb) => ipcRenderer.on('menu-navigate',        (_, d) => cb(d)),
  onMenuExportExcel:    (cb) => ipcRenderer.on('menu-export-excel',    (_, d) => cb(d)),
  onMenuFocusSearch:    (cb) => ipcRenderer.on('menu-focus-search',    (_, d) => cb(d)),
  onMenuFilterInvoices: (cb) => ipcRenderer.on('menu-filter-invoices', (_, d) => cb(d)),
  onMenuAddClient:      (cb) => ipcRenderer.on('menu-add-client',      (_, d) => cb(d)),

  // ── Clean up all listeners when component unmounts ─────────────────────────
  removeAllMenuListeners: () => {
    [
      'update-available', 'update-not-available', 'update-download-progress',
      'update-downloaded', 'update-error',
      'menu-navigate', 'menu-export-excel', 'menu-focus-search',
      'menu-filter-invoices', 'menu-add-client',
    ].forEach(ch => ipcRenderer.removeAllListeners(ch));
  },

  // ── Misc ────────────────────────────────────────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  isElectron: true,
});
