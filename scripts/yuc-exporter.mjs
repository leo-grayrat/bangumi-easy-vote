import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEVICE_SCALE_FACTOR = 10 / 3;
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

function decodeHtml(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };

  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === '#') {
      const radix = body[1]?.toLowerCase() === 'x' ? 16 : 10;
      const digits = radix === 16 ? body.slice(2) : body.slice(1);
      const codePoint = Number.parseInt(digits, radix);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

function textFromHtml(value) {
  return decodeHtml(
    String(value ?? '')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s《》「」『』]/g, '');
}

export function parseYucCatalog(html) {
  const entries = [];
  const blocks = String(html ?? '').split(/<!--\s*#[^>]+-->/g).slice(1);

  for (const block of blocks) {
    const titleMatch = block.match(/<p\b[^>]*class=["'][^"']*\btitle_cn_r1?\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const imageArea = block.match(/<div\b[^>]*style=["'][^"']*float\s*:\s*left[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
    const imageMatch = imageArea.match(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["'][^>]*>/i);
    if (!titleMatch || !imageMatch) {
      continue;
    }

    const title = textFromHtml(titleMatch[1]);
    if (title) {
      entries.push({ title, visualUrl: decodeHtml(imageMatch[1]) });
    }
  }

  return entries;
}

export function matchCatalogEntry(catalog, requestedTitle) {
  const key = normalizeTitle(requestedTitle);
  const matches = catalog.filter((entry) => normalizeTitle(entry.title) === key);
  return matches.length === 1 ? matches[0] : null;
}

export function outputBasename(index, title) {
  const order = String(Number(index) + 1).padStart(2, '0');
  const safeTitle = String(title ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();
  return `${order}-${safeTitle || '未命名动画'}`;
}

export function validateYucUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    throw new Error('请输入完整的 YUC 季度地址。');
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'yuc.wiki') {
    throw new Error('只支持 yuc.wiki 的 HTTP 或 HTTPS 地址。');
  }
  return url;
}

function seasonFromUrl(url) {
  return url.pathname.match(/\/(20\d{4})(?:\/|$)/)?.[1] ?? 'yuc-export';
}

async function findChrome() {
  const configured = process.env.BANGUMI_VOTE_CHROME?.trim();
  const candidates = configured ? [configured, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next normal Chrome installation path.
    }
  }
  throw new Error('没有找到 Google Chrome。可用 BANGUMI_VOTE_CHROME 指定 chrome.exe。');
}

export function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

export function waitForProcessExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 Chrome 退出超时。')), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

class CdpClient {
  #nextId = 0;
  #pending = new Map();
  #eventWaiters = new Map();

  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('无法连接 Chrome 调试端口。')), {
        once: true,
      });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.#pending.get(message.id);
        if (pending) {
          this.#pending.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }

      const waiters = this.#eventWaiters.get(message.method);
      if (waiters?.length) {
        const waiter = waiters.shift();
        waiter.resolve(message.params);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    this.#nextId += 1;
    const id = this.#nextId;
    const response = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  waitFor(method, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const waiters = this.#eventWaiters.get(method) ?? [];
      waiters.push(waiter);
      this.#eventWaiters.set(method, waiters);
      const timer = setTimeout(() => {
        const current = this.#eventWaiters.get(method) ?? [];
        const index = current.indexOf(waiter);
        if (index >= 0) {
          current.splice(index, 1);
        }
        reject(new Error(`等待 Chrome 页面事件 ${method} 超时。`));
      }, timeoutMs);
      waiter.resolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
    });
  }

  close() {
    this.socket.close();
  }
}

async function startChrome() {
  const chromePath = await findChrome();
  const debuggingPort = await findAvailablePort();
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'bangumi-easy-vote-chrome-'));
  const sandboxArgs = process.env.BANGUMI_VOTE_CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      ...sandboxArgs,
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${profileDirectory}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
  );

  const browserWebSocketUrl = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('启动 Chrome 超时。')), 20000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome 启动失败，退出码 ${code}。`));
    });
  });

  const endpoint = new URL(browserWebSocketUrl);
  const pagesResponse = await fetch(`http://${endpoint.host}/json/list`);
  const pages = await pagesResponse.json();
  const page = pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) {
    child.kill();
    await rm(profileDirectory, { recursive: true, force: true });
    throw new Error('Chrome 没有创建可截图页面。');
  }

  return {
    child,
    client: new CdpClient(page.webSocketDebuggerUrl),
    profileDirectory,
  };
}

async function stopChrome(chrome) {
  chrome.client.close();
  chrome.child.kill();
  await waitForProcessExit(chrome.child);
  await rm(chrome.profileDirectory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 100,
  });
}

async function loadYucPage(client, url) {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 1200,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    mobile: false,
  });
  const loaded = client.waitFor('Page.loadEventFired');
  const navigation = await client.send('Page.navigate', { url: url.href });
  if (navigation.errorText) {
    throw new Error(`Chrome 无法打开 YUC：${navigation.errorText}`);
  }
  await loaded;
  await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: `(async () => {
      document.querySelectorAll('img[data-src]').forEach((image) => {
        image.src = image.dataset.src;
      });
      if (document.fonts?.ready) await document.fonts.ready;
      await Promise.all([...document.images].map((image) => {
        if (image.complete) return image.decode?.().catch(() => {});
        return new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        });
      }));
      return true;
    })()`,
  });
}

async function detailCardRect(client, title) {
  const requested = JSON.stringify(normalizeTitle(title));
  const result = await client.send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const normalize = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\\s《》「」『』]/g, '');
      const candidates = [...document.querySelectorAll('p.title_cn_r, p.title_cn_r1')];
      const matches = candidates.filter((node) => normalize(node.textContent) === ${requested});
      if (matches.length !== 1) return { count: matches.length, candidates: candidates.length, href: location.href };
      const table = matches[0].closest('table');
      const sourceTableWrap = table?.parentElement?.classList.contains('table-container')
        ? table.parentElement.parentElement
        : table?.parentElement;
      const visualWrap = sourceTableWrap?.previousElementSibling;
      if (!table || !visualWrap) return { count: 0, candidates: candidates.length, href: location.href };
      const first = visualWrap.getBoundingClientRect();
      const second = table.getBoundingClientRect();
      const left = Math.min(first.left, second.left) + scrollX;
      const top = Math.min(first.top, second.top) + scrollY;
      const right = Math.max(first.right, second.right) + scrollX;
      const bottom = Math.max(first.bottom, second.bottom) + scrollY;
      return { count: 1, x: left, y: top, width: right - left, height: bottom - top };
    })()`,
  });
  if (result.exceptionDetails) {
    throw new Error(`Chrome 定位资料卡时执行失败：${result.exceptionDetails.text}`);
  }
  return result.result.value;
}

async function captureDetailCard(client, title) {
  const rect = await detailCardRect(client, title);
  if (rect?.count !== 1 || rect.width <= 0 || rect.height <= 0) {
    const detail = rect
      ? `页面 ${rect.href ?? '未知'} 有 ${rect.candidates ?? 0} 个资料标题，匹配到 ${rect.count ?? 0} 个`
      : 'Chrome 未返回定位结果';
    throw new Error(`没有唯一定位到“${title}”的横版资料卡：${detail}。`);
  }

  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
  });
  return Buffer.from(screenshot.data, 'base64');
}

function extensionFromImage(contentType, url) {
  const type = String(contentType ?? '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  return ['.png', '.webp', '.gif', '.jpg', '.jpeg'].includes(extension) ? extension : '.jpg';
}

async function downloadVisual(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36' },
  });
  if (!response.ok) {
    throw new Error(`视觉图下载失败：HTTP ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    extension: extensionFromImage(response.headers.get('content-type'), url),
  };
}

function publicExportPath(season, filename) {
  return `/exports/${encodeURIComponent(season)}/${encodeURIComponent(filename)}`;
}

export async function exportYucAssets({ rootDirectory, sourceUrl, entries }) {
  const url = validateYucUrl(sourceUrl);
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36' },
  });
  if (!response.ok) {
    throw new Error(`YUC 页面读取失败：HTTP ${response.status}`);
  }

  const catalog = parseYucCatalog(await response.text());
  const season = seasonFromUrl(url);
  const outputDirectory = path.join(rootDirectory, 'exports', season);
  await mkdir(outputDirectory, { recursive: true });

  const prepared = entries.map((entry, index) => ({
    ...entry,
    index,
    match: matchCatalogEntry(catalog, entry.title),
  }));
  const matched = prepared.filter((entry) => entry.match);
  let chrome;

  if (matched.length > 0) {
    chrome = await startChrome();
    await loadYucPage(chrome.client, url);
  }

  try {
    const results = [];
    for (const entry of prepared) {
      if (!entry.match) {
        results.push({ entryId: entry.entryId, requestedTitle: entry.title, status: 'not-found' });
        continue;
      }

      try {
        const base = outputBasename(entry.index, entry.match.title);
        const visual = await downloadVisual(entry.match.visualUrl);
        const visualFilename = `${base}-视觉图${visual.extension}`;
        const cardFilename = `${base}-资料卡.png`;
        const card = await captureDetailCard(chrome.client, entry.match.title);
        await writeFile(path.join(outputDirectory, visualFilename), visual.buffer);
        await writeFile(path.join(outputDirectory, cardFilename), card);
        results.push({
          entryId: entry.entryId,
          requestedTitle: entry.title,
          matchedTitle: entry.match.title,
          status: 'ok',
          visual: {
            filename: visualFilename,
            url: publicExportPath(season, visualFilename),
          },
          infoCard: {
            filename: cardFilename,
            url: publicExportPath(season, cardFilename),
          },
        });
      } catch (error) {
        results.push({
          entryId: entry.entryId,
          requestedTitle: entry.title,
          matchedTitle: entry.match.title,
          status: 'error',
          message: error.message,
        });
      }
    }

    return { catalogSize: catalog.length, outputDirectory, results, season };
  } finally {
    if (chrome) {
      await stopChrome(chrome);
    }
  }
}

const isDirectRun = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  const [sourceUrl, ...titles] = process.argv.slice(2);
  if (!sourceUrl || titles.length === 0) {
    process.stderr.write('用法：node scripts/yuc-exporter.mjs <YUC季度地址> <动画名...>\n');
    process.exitCode = 1;
  } else {
    const result = await exportYucAssets({
      rootDirectory: process.cwd(),
      sourceUrl,
      entries: titles.map((title, index) => ({ entryId: `cli-${index + 1}`, title })),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.results.some((entry) => entry.status !== 'ok')) {
      process.exitCode = 2;
    }
  }
}
