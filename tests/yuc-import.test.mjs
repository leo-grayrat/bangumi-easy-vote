import assert from 'node:assert/strict';
import test from 'node:test';

const yucImport = await import('../src/yuc-import.js').catch(() => ({}));

test('a plain-text 404 explains that the local service must be restarted', async () => {
  assert.equal(typeof yucImport.readYucImportResponse, 'function');
  await assert.rejects(
    yucImport.readYucImportResponse(
      new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
    ),
    /本地服务尚未更新.*重新启动/,
  );
});

test('a successful YUC response returns its JSON payload', async () => {
  const payload = { season: '202607', results: [] };
  assert.deepEqual(
    await yucImport.readYucImportResponse(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
    payload,
  );
});
