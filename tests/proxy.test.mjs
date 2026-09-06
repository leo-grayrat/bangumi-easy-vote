import test from 'node:test';
import assert from 'node:assert/strict';
import { configureEnvironmentProxy, describeFetchError } from '../scripts/serve.mjs';

test('configureEnvironmentProxy enables native env proxy and protects local addresses', () => {
  let received = null;
  const httpModule = {
    setGlobalProxyFromEnv(proxyEnv) {
      received = proxyEnv;
      return () => {};
    },
  };
  const result = configureEnvironmentProxy({
    env: {
      HTTP_PROXY: 'http://127.0.0.1:7897',
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      NO_PROXY: 'example.local',
    },
    httpModule,
  });

  assert.equal(result.enabled, true);
  assert.equal(received.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.equal(received.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.match(received.NO_PROXY, /example\.local/);
  assert.match(received.NO_PROXY, /localhost/);
  assert.match(received.NO_PROXY, /127\.0\.0\.1/);
});

test('configureEnvironmentProxy is a no-op when no proxy variables exist', () => {
  let called = false;
  const result = configureEnvironmentProxy({
    env: {},
    httpModule: {setGlobalProxyFromEnv() { called = true; }},
  });
  assert.equal(result.enabled, false);
  assert.equal(called, false);
});

test('configureEnvironmentProxy reports unsupported Node runtimes instead of crashing', () => {
  const result = configureEnvironmentProxy({
    env: {HTTPS_PROXY: 'http://127.0.0.1:7897'},
    httpModule: {},
  });
  assert.equal(result.enabled, false);
  assert.equal(result.unsupported, true);
  assert.match(result.message, /Node 24\.14/);
});

test('describeFetchError exposes nested undici causes', () => {
  const cause = Object.assign(new Error('Connect Timeout Error'), {code: 'UND_ERR_CONNECT_TIMEOUT'});
  const error = new TypeError('fetch failed', {cause});
  assert.equal(describeFetchError(error), 'fetch failed；原因：UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error');
});
