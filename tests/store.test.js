import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, DEFAULT_SETTINGS } from '../store.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-store-'));
  return path.join(dir, 'nested', 'settings.json');
}

test('파일이 없으면 기본값', () => {
  const s = createStore(tmpFile());
  assert.deepEqual(s.read(), DEFAULT_SETTINGS);
});

test('쓰면 폴더까지 만들고, 다시 읽으면 그대로', () => {
  const file = tmpFile();
  const s = createStore(file);
  s.write({ ...DEFAULT_SETTINGS, free: { ...DEFAULT_SETTINGS.free, provider: 'openai', apiKey: 'K' } });
  assert.equal(createStore(file).read().free.apiKey, 'K');
  assert.equal(createStore(file).read().free.provider, 'openai');
});

test('깨진 파일이면 기본값으로 돌아간다', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(createStore(file).read(), DEFAULT_SETTINGS);
});

test('update는 일부만 바꾸고 나머지는 유지', () => {
  const s = createStore(tmpFile());
  s.update((cur) => ({ ...cur, adminHash: 'H' }));
  assert.equal(s.read().adminHash, 'H');
  assert.deepEqual(s.read().free, DEFAULT_SETTINGS.free);
});
