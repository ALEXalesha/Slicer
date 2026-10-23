// Общие вопросы «да / нет» в окне (диалог #confirm): отмена печати, нагрев, выбор принтера.
import { t } from './i18n.js';

const $ = (s) => document.querySelector(s);

export function ask(text, yes, no, { danger = true } = {}) {
  return new Promise((resolve) => {
    const dlg = $('#confirm');
    $('#confirm-text').textContent = text;
    $('#confirm-yes').textContent = yes;
    // В2: согласие «Печатать на нём» - не красная «опасная» кнопка; опасное - красным.
    $('#confirm-yes').className = danger ? 'danger' : 'primary';
    $('#confirm-no').textContent = no;
    const done = (v) => { dlg.close(); $('#confirm-yes').onclick = null; $('#confirm-no').onclick = null; dlg.oncancel = null; resolve(v); };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
    dlg.oncancel = () => done(false);
    dlg.showModal();
  });
}

/**
 * Адрес принтера не задан, а в сети кто-то ответил: спросить про каждый найденный по очереди
 * «Печатать на <имя> (<IP>)?». Возвращает выбранный адрес или null (человек отказался).
 */
export async function confirmHost(found) {
  for (const f of Array.isArray(found) ? found : []) {
    if (!f || typeof f.host !== 'string' || !f.host) continue;
    const text = t('printer.askHost', { name: f.name || 'Centauri Carbon', host: f.host });
    if (await ask(text, t('printer.yesHost'), t('printer.noHost'), { danger: false })) return f.host;
  }
  return null;
}
