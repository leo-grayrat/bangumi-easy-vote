import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import * as yucExporter from '../scripts/yuc-exporter.mjs';

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
  <!--#B18-->
  <div style="float:left"><img width="180px" data-src="https://img.example/clevatess.jpg"></div>
  <div><table width="500px"><tr><td class="title_main_r" colspan="2" rowspan="2">
  <p class="title_cn_r2">Clevatess 第2期<br>魔兽之王与虚假的勇者传承</p></td></tr></table></div>
  <div style="clear:both"></div>
  <!--#B19-->
  <div style="float:left"><img width="180px" data-src="https://img.example/re-zero.jpg"></div>
  <div><table width="500px"><tr><td class="title_main_r" colspan="2" rowspan="2">
  <p class="title_cn_r3">Re:从零开始的异世界生活<br>第4期 Part.2 夺还篇</p></td></tr></table></div>
  <div style="clear:both"></div>
  <!--#B20-->
  <div style="float:left"><img width="180px" data-src="https://img.example/maid.jpg"></div>
  <div><table width="500px"><tr><td class="title_main_r" colspan="2" rowspan="2">
  <p class="title_cn_r4">女主角？圣女？<br>不，我是杂役女仆（自豪）！</p></td></tr></table></div>
  <div style="clear:both"></div>
`;

test('parseYucCatalog reads the Chinese detail title and its original visual URL', () => {
  assert.deepEqual(parseYucCatalog(DETAIL_HTML), [
    { title: '世界舞动', visualUrl: 'https://img.example/world.jpg' },
    { title: '碧蓝之海 第3期', visualUrl: 'https://img.example/grand-blue.jpg' },
    {
      title: 'Clevatess 第2期 魔兽之王与虚假的勇者传承',
      visualUrl: 'https://img.example/clevatess.jpg',
    },
    {
      title: 'Re:从零开始的异世界生活 第4期 Part.2 夺还篇',
      visualUrl: 'https://img.example/re-zero.jpg',
    },
    {
      title: '女主角？圣女？ 不，我是杂役女仆（自豪）！',
      visualUrl: 'https://img.example/maid.jpg',
    },
  ]);
});

test('matchCatalogEntry accepts harmless spacing differences but not a different title', () => {
  const catalog = parseYucCatalog(DETAIL_HTML);

  assert.equal(matchCatalogEntry(catalog, '碧蓝之海第3期')?.visualUrl, 'https://img.example/grand-blue.jpg');
  assert.equal(matchCatalogEntry(catalog, '碧蓝之海 第2期'), null);
});

test('matchCatalogEntry accepts a unique partial title in either direction', () => {
  const catalog = parseYucCatalog(DETAIL_HTML);

  assert.equal(matchCatalogEntry(catalog, 'Clevatess')?.visualUrl, 'https://img.example/clevatess.jpg');
  assert.equal(
    matchCatalogEntry([{ title: '才女的侍从', visualUrl: 'servant.jpg' }], '才女的侍从 在贵族学校照顾大小姐')?.visualUrl,
    'servant.jpg',
  );
});

test('matchCatalogEntry rejects ambiguous partial titles but keeps an exact match', () => {
  const catalog = [
    { title: '碧蓝', visualUrl: 'exact.jpg' },
    { title: '碧蓝之海 第3期', visualUrl: 'grand-blue.jpg' },
    { title: '碧蓝航线 微速前行 第2期', visualUrl: 'azur-lane.jpg' },
  ];

  assert.equal(matchCatalogEntry(catalog, '碧蓝')?.visualUrl, 'exact.jpg');
  assert.equal(matchCatalogEntry(catalog.slice(1), '碧蓝'), null);
});

test('outputBasename produces ordered Windows-safe filenames', () => {
  assert.equal(outputBasename(0, '相反的你和我 第2期'), '01-相反的你和我 第2期');
  assert.equal(outputBasename(11, '标题:测试/版本?'), '12-标题-测试-版本-');
});

test('contentAwareCardBounds keeps overflowing staff text below the table box', () => {
  const bounds = yucExporter.contentAwareCardBounds({
    visual: { left: 20, top: 100, right: 200, bottom: 500 },
    table: { left: 200, top: 100, right: 700, bottom: 420 },
    content: [
      { left: 220, top: 140, right: 680, bottom: 418 },
      { left: 420, top: 160, right: 690, bottom: 610 },
    ],
  });

  assert.deepEqual(bounds, { x: 20, y: 100, width: 680, height: 510 });
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
