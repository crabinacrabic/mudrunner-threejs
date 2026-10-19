import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Запуск Chrome headless с отладкой на порту', PORT);
  const tmpDir = path.resolve('temp_chrome_profile');
  const proc = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${tmpDir}`,
    `--remote-debugging-port=${PORT}`,
    '--window-size=1600,1000',
    'about:blank'
  ]);

  proc.on('error', err => console.error('Ошибка процесса Chrome:', err));

  // Ожидание старта CDP
  let version = null;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    try {
      version = await getJson(`http://127.0.0.1:${PORT}/json/version`);
      if (version) break;
    } catch {}
  }

  if (!version) {
    console.error('Не удалось подключиться к CDP Chrome');
    proc.kill();
    process.exit(1);
  }

  console.log('CDP подключен:', version.Browser);

  // Создаем новую страницу
  const newTab = await getJson(`http://127.0.0.1:${PORT}/json/new?http://127.0.0.1:8765/tools/road_editor.html`);
  console.log('Открыта страница редактора:', newTab.id);

  // Подключаемся к WebSocket
  const WebSocket = (await import('node:http')).default;
  // Node 20+ has global WebSocket!
  const ws = new globalThis.WebSocket(newTab.webSocketDebuggerUrl);

  let id = 1;
  const callbacks = new Map();

  function sendCmd(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      callbacks.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id);
      callbacks.delete(msg.id);
      if (msg.error) cb.reject(msg.error);
      else cb.resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map(a => a.value || a.description).join(' ');
      console.log(`[Browser Console ${msg.params.type}]`, text);
    }
  };

  await new Promise(r => ws.onopen = r);
  console.log('WebSocket CDP открыт');

  await sendCmd('Runtime.enable');
  await sendCmd('Page.enable');

  // Ждем загрузки карты и отрисовки
  await sleep(2500);

  // Снимок 1: Заир
  const shot1 = await sendCmd('Page.captureScreenshot', { format: 'png' });
  const outPath1 = path.resolve('screenshot_zaire_editor.png');
  fs.writeFileSync(outPath1, Buffer.from(shot1.data, 'base64'));
  console.log('✅ Скриншот редактора Заир сохранён:', outPath1, 'размер:', fs.statSync(outPath1).size, 'байт');

  // Переключаем карту на Филиппины для проверки switchEditorMap
  console.log('Тест переключения карты на Филиппины...');
  await sendCmd('Runtime.evaluate', { expression: 'switchEditorMap("philippines")' });
  await sleep(1500);

  const shot2 = await sendCmd('Page.captureScreenshot', { format: 'png' });
  const outPath2 = path.resolve('screenshot_philippines_editor.png');
  fs.writeFileSync(outPath2, Buffer.from(shot2.data, 'base64'));
  console.log('✅ Скриншот редактора Филиппины сохранён:', outPath2, 'размер:', fs.statSync(outPath2).size, 'байт');

  // Переключаем обратно на Заир и проверяем сохранение через кнопку saveToProject()
  console.log('Тест сохранения карты Заир...');
  await sendCmd('Runtime.evaluate', { expression: 'switchEditorMap("zaire")' });
  await sleep(1000);
  const saveResult = await sendCmd('Runtime.evaluate', { expression: 'saveToProject()', awaitPromise: true });
  console.log('Результат вызова saveToProject():', saveResult);
  await sleep(1000);

  ws.close();
  proc.kill();
  console.log('Тестирование успешно завершено!');
}

main().catch(err => {
  console.error('Ошибка скрипта:', err);
  process.exit(1);
});
