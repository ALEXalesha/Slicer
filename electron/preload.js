// Единственный мост между окном и Node: window.slicer.
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listen = (channel) => (cb) => {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};
const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('slicer', {
  settings: { get: call('settings:get'), set: call('settings:set') },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  openModels: call('models:open'),
  loadModel: call('models:load'),
  preview: call('preview'),
  presetsInfo: call('presets:info'),
  presetsFull: call('presets:full'),
  slice: call('slice'),
  exportGcode: call('export'),
  print: call('print'),
  onSendStep: listen('send:step'),
  printer: {
    discover: call('printer:discover'),
    connect: call('printer:connect'),
    disconnect: call('printer:disconnect'),
    command: call('printer:command'),
    control: call('printer:control'),
    camera: call('printer:camera'),
    onStatus: listen('printer:status'),
    onLost: listen('printer:lost'),
  },
  ai: { poll: call('aifp:poll'), dismiss: call('aifp:dismiss') },
});
