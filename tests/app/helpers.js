// Запуск настоящего окна для тестов: SLICER_TEST=1 (окно невидимо), своя папка userData,
// захват мыши заглушён до загрузки страницы.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

const ROOT = path.join(__dirname, '..', '..');

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

async function launch({ dataDir = tmp('slicercc-app-'), env = {} } = {}) {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [ROOT, '--user-data-dir=' + dataDir],
    env: Object.assign({}, process.env, { SLICER_TEST: '1' }, env),
    cwd: ROOT,
  });
  const win = await app.firstWindow();
  // Заглушка захвата мыши: и для следующих загрузок (addInitScript), и для уже открытой
  // страницы. Настоящий requestPointerLock в тестах не вызывается никогда.
  const stub = () => {
    Element.prototype.requestPointerLock = function () { window.__pl = (window.__pl || 0) + 1; };
    document.exitPointerLock = function () {};
  };
  await win.addInitScript(stub);
  await win.evaluate(stub);
  await win.waitForFunction(() => window.slicerApp && window.slicerApp.ready(), null, { timeout: 60000 });
  return { app, win, dataDir };
}

module.exports = { launch, tmp, ROOT };
