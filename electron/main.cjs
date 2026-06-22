const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path  = require('path');
const { autoUpdater } = require('electron-updater');

const isDev  = !app.isPackaged;
const isMac  = process.platform === 'darwin';

autoUpdater.autoDownload         = false;
autoUpdater.autoInstallOnAppQuit = true;
if (isDev) {
  autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
}

let mainWindow = null;

function send(channel, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function navTo(page) {
  send('menu-navigate', { page });
}

function buildMenu() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),

    {
      label: 'File',
      submenu: [
        { label: 'New Invoice',         accelerator: 'CmdOrCtrl+N',       click: () => navTo('new') },
        { type: 'separator' },
        { label: 'All Invoices',        accelerator: 'CmdOrCtrl+I',       click: () => navTo('invoices') },
        { label: 'Clients',             accelerator: 'CmdOrCtrl+L',       click: () => navTo('clients') },
        { label: 'Reports',             accelerator: 'CmdOrCtrl+Shift+R', click: () => navTo('reports') },
        { label: 'Settings',            accelerator: 'CmdOrCtrl+,',       click: () => navTo('settings') },
        { type: 'separator' },
        { label: 'Export to Excel',     accelerator: 'CmdOrCtrl+E',       click: () => send('menu-export-excel') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },

    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Search Invoices',
          accelerator: 'CmdOrCtrl+F',
          click: () => { navTo('invoices'); setTimeout(() => send('menu-focus-search'), 300); },
        },
      ],
    },

    {
      label: 'View',
      submenu: [
        { label: 'Dashboard',    accelerator: 'CmdOrCtrl+D', click: () => navTo('dashboard') },
        { label: 'All Invoices', accelerator: 'CmdOrCtrl+I', click: () => navTo('invoices') },
        { label: 'Clients',      accelerator: 'CmdOrCtrl+L', click: () => navTo('clients') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    {
      label: 'Invoices',
      submenu: [
        { label: 'New Invoice',         accelerator: 'CmdOrCtrl+N', click: () => navTo('new') },
        { label: 'View All Invoices',                               click: () => navTo('invoices') },
        { type: 'separator' },
        { label: 'Show Unpaid Only',    click: () => send('menu-filter-invoices', { status: 'unpaid' }) },
        { label: 'Show Paid Only',      click: () => send('menu-filter-invoices', { status: 'paid' }) },
        { label: 'Makkah Branch',       click: () => send('menu-filter-invoices', { branch: 'makkah' }) },
        { label: 'Madinah Branch',      click: () => send('menu-filter-invoices', { branch: 'madinah' }) },
        { label: 'Clear Filters',       click: () => send('menu-filter-invoices', { clear: true }) },
        { type: 'separator' },
        { label: 'Export to Excel',     accelerator: 'CmdOrCtrl+E', click: () => send('menu-export-excel') },
      ],
    },

    {
      label: 'Clients',
      submenu: [
        { label: 'View Clients',  click: () => navTo('clients') },
        {
          label: 'Add New Client',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => { navTo('clients'); setTimeout(() => send('menu-add-client'), 300); },
        },
      ],
    },

    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },

    {
      label: 'Help',
      submenu: [
        {
          label: 'About Aqsa Invoice',
          click: async () => {
            await dialog.showMessageBox(mainWindow, {
              type:    'info',
              title:   'About Aqsa Invoice',
              message: 'Aqsa Invoice Management System',
              detail:  `Version ${app.getVersion()}\n\n© 2025 Aqsa Hotels. All rights reserved.`,
              buttons: ['OK'],
            });
          },
        },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          click: () => checkForUpdates(true),
        },
        { type: 'separator' },
        {
          label: 'Keyboard Shortcuts',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type:    'info',
              title:   'Keyboard Shortcuts',
              message: 'Aqsa Invoice — Keyboard Shortcuts',
              detail: [
                'Ctrl + N          New Invoice',
                'Ctrl + I          All Invoices',
                'Ctrl + L          Clients',
                'Ctrl + D          Dashboard',
                'Ctrl + Shift+R    Reports',
                'Ctrl + ,          Settings',
                'Ctrl + E          Export to Excel',
                'Ctrl + F          Search Invoices',
                'Ctrl + Shift+C    Add New Client',
                'F11               Toggle Fullscreen',
                'Alt  + F4         Exit',
              ].join('\n'),
              buttons: ['OK'],
            });
          },
        },
        { type: 'separator' },
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(app.getPath('userData')),
        },
        {
          label: 'Report a Problem',
          click: () => shell.openExternal('mailto:support@aqsahotels.com?subject=Bug Report - Aqsa Invoice v' + app.getVersion()),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    icon: path.join(__dirname, '../public/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    titleBarStyle: 'default',
    show: false,
  });

  buildMenu();

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (!isDev) setTimeout(() => checkForUpdates(false), 3000);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });

function checkForUpdates(manual = false) {
  autoUpdater.checkForUpdates().catch(err => {
    if (manual) dialog.showMessageBox(mainWindow, { type:'error', title:'Update Check Failed', message: err.message, buttons:['OK'] });
  });
}

autoUpdater.on('update-available',     (info)     => send('update-available',         { version:info.version, releaseDate:info.releaseDate, releaseNotes:info.releaseNotes||'' }));
autoUpdater.on('update-not-available', ()         => send('update-not-available',      {}));
autoUpdater.on('download-progress',    (progress) => send('update-download-progress',  { percent:Math.round(progress.percent), bytesPerSecond:progress.bytesPerSecond, transferred:progress.transferred, total:progress.total }));
autoUpdater.on('update-downloaded',    (info)     => send('update-downloaded',         { version:info.version }));
autoUpdater.on('error',                (err)      => send('update-error',              { message:err.message }));

ipcMain.handle('check-for-updates', () => checkForUpdates(true));
ipcMain.handle('download-update',   () => autoUpdater.downloadUpdate());
ipcMain.handle('install-update',    () => autoUpdater.quitAndInstall(false, true));
ipcMain.handle('get-app-version',   () => app.getVersion());
ipcMain.handle('open-external', (_, url) => shell.openExternal(url));
