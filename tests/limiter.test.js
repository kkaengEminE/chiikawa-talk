import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, createRateLimiter } from '../limiter.js';

test('하루 한도까지는 허용하고 그다음은 거절', () => {
  let t = Date.UTC(2026, 10, 6, 3, 0, 0); // 2026-11-06 12:00 KST
  const lim = createLimiter({ perDay: 3, now: () => t });
  assert.deepEqual(lim.consume('1.1.1.1'), { ok: true, remaining: 2 });
  assert.deepEqual(lim.consume('1.1.1.1'), { ok: true, remaining: 1 });
  assert.deepEqual(lim.consume('1.1.1.1'), { ok: true, remaining: 0 });
  assert.deepEqual(lim.consume('1.1.1.1'), { ok: false, remaining: 0 });
});

test('다른 사람은 따로 센다', () => {
  const lim = createLimiter({ perDay: 1, now: () => Date.UTC(2026, 10, 6, 3) });
  lim.consume('a');
  assert.equal(lim.consume('b').ok, true);
});

test('한국 시간 기준 날짜가 바뀌면 다시 센다', () => {
  let t = Date.UTC(2026, 10, 6, 14, 30); // 2026-11-06 23:30 KST
  const lim = createLimiter({ perDay: 1, now: () => t });
  assert.equal(lim.consume('a').ok, true);
  assert.equal(lim.consume('a').ok, false);
  t = Date.UTC(2026, 10, 6, 15, 10); // 2026-11-07 00:10 KST
  assert.equal(lim.consume('a').ok, true);
});

test('check는 소비하지 않고 남은 횟수만 알려준다', () => {
  const lim = createLimiter({ perDay: 2, now: () => Date.UTC(2026, 10, 6, 3) });
  assert.deepEqual(lim.check('a'), { ok: true, remaining: 2 });
  lim.consume('a');
  assert.deepEqual(lim.check('a'), { ok: true, remaining: 1 });
});

test('refund는 한 번 쓴 횟수를 돌려주고, 0 아래로는 안 내려간다', () => {
  const lim = createLimiter({ perDay: 2, now: () => Date.UTC(2026, 10, 6, 3) });
  lim.consume('a');
  lim.refund('a');
  assert.deepEqual(lim.check('a'), { ok: true, remaining: 2 });
  lim.refund('a');
  assert.deepEqual(lim.check('a'), { ok: true, remaining: 2 });
});

test('하루 한도를 함수로 주면 바뀐 값이 바로 반영된다', () => {
  let cap = 1;
  const lim = createLimiter({ perDay: () => cap, now: () => Date.UTC(2026, 10, 6, 3) });
  assert.equal(lim.consume('a').ok, true);
  assert.equal(lim.consume('a').ok, false);
  cap = 3;
  assert.deepEqual(lim.consume('a'), { ok: true, remaining: 1 });
});

test('blocked는 기록하지 않고 막혔는지만 알려준다', () => {
  let t = 0;
  const rl = createRateLimiter({ max: 2, windowMs: 60_000, now: () => t });
  assert.equal(rl.blocked('a'), false);
  rl.hit('a');
  rl.hit('a');
  assert.equal(rl.blocked('a'), true);
  assert.equal(rl.blocked('a'), true); // 여러 번 물어도 그대로
  t = 61_000;
  assert.equal(rl.blocked('a'), false);
});

test('짧은 창 제한: 1분에 5번까지, 창이 지나면 다시', () => {
  let t = 0;
  const rl = createRateLimiter({ max: 5, windowMs: 60_000, now: () => t });
  for (let i = 0; i < 5; i++) assert.equal(rl.hit('a'), true);
  assert.equal(rl.hit('a'), false);
  t = 61_000;
  assert.equal(rl.hit('a'), true);
});
