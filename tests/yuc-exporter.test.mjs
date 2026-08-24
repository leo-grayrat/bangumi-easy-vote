import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  findAvailablePort,
  matchCatalogEntry,
  outputBasename,
  parseYucCatalog,
  waitForProcessExit,
} from '../scripts/yuc-exporter.mjs';

const DETAIL_HTML = `
  <!--#B16-->
  <div style="float:left"><img width="180px"
    data-src="https://img.example/world.jpg" referrerPolicy="no-referrer"></div>
  <div><table width="500px"><tr><td class="title_main_r" colspan="2" rowspan="2">
  <p class="title_cn_r">世界舞动</p>
  <p class="title_jp_r">ワールド イズ ダンシング</p></td></tr></table></div>
  <div style="clear:both"></div>
  <!--#B17-->
  <div style="float:left"><img width="180px" data-src="https://img.example/grand-blue.jpg"></div>
  <div><table width="500px"><tr><td class="title_main_r" colspan="2" rowspan="2">
  <p class="title_cn_r1">碧蓝之海<br>第3期</p></td></tr></table></div>
  <div style="clear:both"></div>
`;

test('parseYucCatalog reads the Chinese detail title and its original visual URL', () => {
  assert.deepEqual(parseYucCatalog(DETAIL_HTML), [
    { title: '世界舞动', visualUrl: 'https://img.example/world.jpg' },
    { title: '碧蓝之海 第3期', visualUrl: 'https://img.example/grand-blue.jpg' },
  ]);
});

test('matchCatalogEntry accepts harmless spacing differences but not a different title', () => {
  const catalog = parseYucCatalog(DETAIL_HTML);

  assert.equal(matchCatalogEntry(catalog, '碧蓝之海第3期')?.visualUrl, 'https://img.example/grand-blue.jpg');
  assert.equal(matchCatalogEntry(catalog, '碧蓝之海 第2期'), null);
});

test('outputBasename produces ordered Windows-safe filenames', () => {
  assert.equal(outputBasename(0, '相反的你和我 第2期'), '01-相反的你和我 第2期');
  assert.equal(outputBasename(11, '标题:测试/版本?'), '12-标题-测试-版本-');
});

test('findAvailablePort returns a concrete loopback port for Chrome debugging', async () => {
  const port = await findAvailablePort();
  assert.ok(Number.isInteger(port));
  assert.ok(port > 0 && port <= 65535);
});

test('waitForProcessExit does not return until a killed child process has exited', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']);
  child.kill();
  await waitForProcessExit(child, 2000);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
