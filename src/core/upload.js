// Загрузка файла на принтер так же, как ElegooSlicer (его журнал elegoolink.log):
// POST http://<ip>:3030/uploadFile/upload, куски по 1 048 576 байт, поля S-File-MD5,
// Check, Offset, Uuid, TotalSize, File. Ответ {"success": true, "code": "000000"}.
'use strict';
const http = require('http');
const crypto = require('crypto');
const { splitHost } = require('./printer-client');

const CHUNK = 1048576;

class UploadError extends Error {
  constructor(code, detail) {
    super(code + (detail ? ': ' + detail : ''));
    this.code = code;
    this.detail = detail || '';
  }
}

function multipart(fields, file) {
  const boundary = '----SlicerCC' + crypto.randomBytes(12).toString('hex');
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="File"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(file.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: 'multipart/form-data; boundary=' + boundary };
}

function post({ hostname, port, body, contentType, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: '/uploadFile/upload', method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': contentType, 'Content-Length': body.length } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * @returns {Promise<{md5: string, size: number}>}
 * Кусок, на который принтер не ответил или ответил ошибкой сети/5xx, повторяется до
 * retriesPerChunk раз. Отказ принтера по существу (MD5, параметры) - сразу ошибка.
 */
async function uploadFile({ host, port, buffer, remoteName, chunkSize = CHUNK, retriesPerChunk = 3, chunkTimeoutMs = 30000, onProgress = () => {}, signal = null }) {
  const { hostname, port: p } = splitHost(host, port);
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');
  const uuid = crypto.randomUUID();
  const total = buffer.length;
  let offset = 0;
  do {
    // Отмена отправки (обзор 23.10 Б4) - между кусками: начатый кусок доходит до конца.
    if (signal && signal.aborted) throw new UploadError('canceled');
    const data = buffer.subarray(offset, Math.min(total, offset + chunkSize));
    const { body, contentType } = multipart({ 'S-File-MD5': md5, Check: 1, Offset: offset, Uuid: uuid, TotalSize: total }, { name: remoteName, data });
    let lastErr = null;
    for (let i = 0; i <= retriesPerChunk; i++) {
      let r;
      try {
        r = await post({ hostname, port: p, body, contentType, timeoutMs: chunkTimeoutMs });
      } catch (e) { lastErr = new UploadError('network', e.message); continue; }
      if (r.status >= 500 || r.status === 0) { lastErr = new UploadError('http', String(r.status)); continue; }
      let j = null;
      try { j = JSON.parse(r.text); } catch { /* не JSON */ }
      if (r.status !== 200 || !j || j.success !== true) {
        const msg = j && Array.isArray(j.messages) && j.messages[0] && j.messages[0].message;
        throw new UploadError(/md5/i.test(String(msg)) ? 'md5' : 'rejected', msg || 'HTTP ' + r.status);
      }
      lastErr = null;
      break;
    }
    if (lastErr) throw lastErr;
    offset += data.length;
    onProgress({ sent: offset, total });
  } while (offset < total);
  return { md5, size: total };
}

module.exports = { uploadFile, UploadError, multipart, CHUNK };
