// Поиск принтера в сети: UDP «M99999» на порт 3000, принтер отвечает JSON с
// Data.MainboardIP. В сети могут ответить и другие устройства - берём только ответы с
// MainboardIP (так же в n8n_pc/camera_server.py).
'use strict';
const dgram = require('dgram');

function parseReply(buf, fromAddress) {
  let j;
  try { j = JSON.parse(String(buf)); } catch { return null; }
  const d = j && typeof j === 'object' && j.Data && typeof j.Data === 'object' ? j.Data : null;
  if (!d || typeof d.MainboardIP !== 'string' || !d.MainboardIP) return null;
  return {
    host: d.MainboardIP,
    name: typeof d.Name === 'string' ? d.Name : '',
    model: typeof d.MachineName === 'string' ? d.MachineName : '',
    mainboardId: typeof d.MainboardID === 'string' ? d.MainboardID : '',
    from: fromAddress || '',
  };
}

/** @returns {Promise<Array<{host, name, model, mainboardId}>>} */
function discover({ timeoutMs = 2000, port = 3000, address = '255.255.255.255' } = {}) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const found = new Map();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { sock.close(); } catch { /* закрыт */ }
      resolve([...found.values()]);
    };
    sock.on('error', finish);
    sock.on('message', (buf, rinfo) => {
      const r = parseReply(buf, rinfo.address);
      if (r && !found.has(r.host)) found.set(r.host, r);
    });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* не важно для одиночного адреса */ }
      sock.send(Buffer.from('M99999'), port, address, (err) => { if (err) finish(); });
      setTimeout(finish, timeoutMs);
    });
  });
}

module.exports = { discover, parseReply };
