// Главный процесс: окно и связь окна с src/core (диск, движок, принтер).
//
// SLICER_TEST=1 - режим тестов: окно никогда не показывается, не берёт фокус, стоит за
// экраном, разрешения (захват мыши, камера, уведомления) отклонены. Тесты Playwright
// управляют им без единого видимого окна на экране пользователя.
'use strict';
const { app, BrowserWindow, Menu, screen, session } = require('electron');
const path = require('path');
const WindowState = require('./window-state');
const { registerIpc } = require('./ipc');

const TEST = process.env.SLICER_TEST === '1';
const SIZE = { width: 1280, height: 820, minWidth: 980, minHeight: 640 };
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
let win = null;

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const areas = [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => d.workArea);
  const placed = WindowState.restore(WindowState.load(stateFile()), areas, SIZE);
  win = new BrowserWindow({
    ...(TEST ? { x: -20000, y: -20000 } : placed.x !== undefined ? { x: placed.x, y: placed.y } : {}),
    width: placed.width,
    height: placed.height,
    minWidth: SIZE.minWidth,
    minHeight: SIZE.minHeight,
    title: 'Slicer CC',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    backgroundColor: '#12101f',
    show: false,
    focusable: !TEST,
    skipTaskbar: TEST,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  if (!TEST) {
    if (placed.maximized) win.maximize();
    win.once('ready-to-show', () => win.show());
  }
  const remember = () => { if (win && !win.isDestroyed() && !win.isMinimized() && !TEST) WindowState.save(stateFile(), WindowState.capture(win)); };
  for (const event of ['resized', 'moved', 'maximize', 'unmaximize']) win.on(event, remember);
  win.on('close', () => { if (win && !TEST) WindowState.save(stateFile(), WindowState.capture(win)); });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Брошенный мимо стола файл не должен заменить страницу: меню и перезагрузки нет.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  Menu.setApplicationMenu(null);
  app.on('second-instance', () => {
    if (!win || TEST) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    registerIpc({ getWindow: () => win, userData: app.getPath('userData'), test: TEST });
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
