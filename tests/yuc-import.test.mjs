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

test('stream reader emits complete progress records across split network chunks', async () => {
  assert.equal(typeof yucImport.readYucImportEvents, 'function');
  const encoder = new TextEncoder();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"entry-start","index":1'));
        controller.enqueue(encoder.encode('}\n{"type":"entry-result","index":1}\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
  );
  const events = [];

  await yucImport.readYucImportEvents(response, (event) => events.push(event));

  assert.deepEqual(events, [
    { type: 'entry-start', index: 1 },
    { type: 'entry-result', index: 1 },
  ]);
});
