// Каналы между окном и главным процессом. Каждый канал проверяет вход: окно - чужой код
// с точки зрения Node, пути и адреса из него не принимаются как есть.
'use strict';
const { ipcMain } = require('electron');
const path = require('path');
const Settings = require('../src/core/settings');

function registerIpc(ctx) {
  const settingsFile = path.join(ctx.userData, 'settings.json');
  let settings = Settings.load(settingsFile);
  const persist = () => { if (!ctx.test || process.env.SLICER_TEST_SAVE === '1') Settings.save(settingsFile, settings); };

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    settings = Settings.normalize(Object.assign({}, settings, patch && typeof patch === 'object' ? patch : {}));
    persist();
    return settings;
  });
  return { get settings() { return settings; } };
}

module.exports = { registerIpc };
