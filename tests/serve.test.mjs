import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { contentType, resolveExportPath, resolveRequestPath } from '../scripts/serve.mjs';

const root = path.resolve('D:/File/Git/bangumi-easy-vote');

test('resolveRequestPath maps the root and public assets inside the repository', () => {
  assert.equal(resolveRequestPath('/', root), path.join(root, 'index.html'));
  assert.equal(resolveRequestPath('/images.html', root), path.join(root, 'images.html'));
  assert.equal(resolveRequestPath('/src/app.js', root), path.join(root, 'src', 'app.js'));
  assert.equal(
    resolveRequestPath('/form-import-findings.md', root),
    path.join(root, 'form-import-findings.md'),
  );
});

test('resolveRequestPath rejects traversal and files outside the public surface', () => {
  assert.equal(resolveRequestPath('/../package.json', root), null);
  assert.equal(resolveRequestPath('/%2e%2e/package.json', root), null);
  assert.equal(resolveRequestPath('/package.json', root), null);
  assert.equal(resolveRequestPath('/.git/config', root), null);
});

test('resolveExportPath serves generated images but rejects paths outside exports', () => {
  assert.equal(
    resolveExportPath('/exports/202607/01-%E5%B0%BC%E5%8F%A4%E5%96%B5%E5%96%B5.png', root),
    path.join(root, 'exports', '202607', '01-尼古喵喵.png'),
  );
  assert.equal(resolveExportPath('/exports/../README.md', root), null);
  assert.equal(resolveExportPath('/src/app.js', root), null);
});

test('contentType returns browser-safe MIME types', () => {
  assert.equal(contentType('index.html'), 'text/html; charset=utf-8');
  assert.equal(contentType('styles.css'), 'text/css; charset=utf-8');
  assert.equal(contentType('app.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentType('notes.md'), 'text/markdown; charset=utf-8');
});
