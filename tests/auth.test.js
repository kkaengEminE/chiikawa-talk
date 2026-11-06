import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../auth.js';

test('해시는 평문을 담지 않고, 같은 비밀번호라도 매번 다르다', () => {
  const a = hashPassword('secret-1');
  const b = hashPassword('secret-1');
  assert.ok(!a.includes('secret-1'));
  assert.notEqual(a, b);
});

test('맞는 비밀번호만 통과', () => {
  const h = hashPassword('secret-1');
  assert.equal(verifyPassword('secret-1', h), true);
  assert.equal(verifyPassword('secret-2', h), false);
  assert.equal(verifyPassword('', h), false);
});

test('깨진 해시는 조용히 거절', () => {
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.equal(verifyPassword('x', null), false);
});
