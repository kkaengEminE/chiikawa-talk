import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildRequest, extractText, cleanOutput, callProvider, PROVIDERS } from '../ai.js';

test('시스템 프롬프트에 캐릭터 규칙과 예시, 공통 제한이 들어간다', () => {
  const p = buildSystemPrompt('usagi');
  assert.ok(p.includes('방방곡곡'));
  assert.ok(p.includes('우라!'));
  assert.ok(p.includes('100자'));
  assert.ok(p.includes('피자 먹고 싶어'));
});

test('Gemini 요청: 키는 헤더, 시스템 프롬프트는 system_instruction', () => {
  const r = buildRequest('gemini', { apiKey: 'K', model: 'gemini-2.5-flash-lite', system: 'S', text: '안녕' });
  assert.equal(r.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent');
  assert.equal(r.headers['x-goog-api-key'], 'K');
  assert.equal(r.body.system_instruction.parts[0].text, 'S');
  assert.equal(r.body.contents[0].parts[0].text, '안녕');
});

test('OpenAI 요청: Bearer 헤더와 system/user 메시지', () => {
  const r = buildRequest('openai', { apiKey: 'K', model: 'gpt-5-mini', system: 'S', text: '안녕' });
  assert.equal(r.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(r.headers.Authorization, 'Bearer K');
  assert.deepEqual(r.body.messages, [
    { role: 'system', content: 'S' },
    { role: 'user', content: '안녕' },
  ]);
});

test('Claude 요청: x-api-key, 브라우저 직접 호출 헤더, system 필드', () => {
  const r = buildRequest('claude', { apiKey: 'K', model: 'claude-haiku-5-5', system: 'S', text: '안녕' });
  assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(r.headers['x-api-key'], 'K');
  assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(r.body.system, 'S');
  assert.deepEqual(r.body.messages, [{ role: 'user', content: '안녕' }]);
});

test('응답에서 본문 추출: 제공사별 모양', () => {
  assert.equal(extractText('gemini', { candidates: [{ content: { parts: [{ text: '우라!' }] } }] }), '우라!');
  assert.equal(extractText('openai', { choices: [{ message: { content: '우라!' } }] }), '우라!');
  assert.equal(extractText('claude', { stop_reason: 'end_turn', content: [{ type: 'text', text: '우라!' }] }), '우라!');
});

test('Claude가 거절(refusal)하면 에러', () => {
  assert.throws(() => extractText('claude', { stop_reason: 'refusal', content: [] }), /거절/);
});

test('cleanOutput: 따옴표·줄바꿈 정리, 100자 제한', () => {
  assert.equal(cleanOutput('"우라!\n야하!"'), '우라! 야하!');
  assert.equal(cleanOutput('가'.repeat(150)).length, 100);
});

test('제공사 목록에 키 발급 링크와 기본 모델이 있다', () => {
  for (const id of ['gemini', 'openai', 'claude']) {
    assert.ok(PROVIDERS[id].keyUrl.startsWith('https://'));
    assert.ok(PROVIDERS[id].defaultModel);
  }
});

test('Gemini 기본 모델은 현재 제공되는 가장 싼 모델(gemini-3.5-flash-lite)', () => {
  assert.equal(PROVIDERS.gemini.defaultModel, 'gemini-3.5-flash-lite');
});

test('callProvider: 실패 응답이면 상태 코드와 제공사 오류 문구를 에러에 담는다', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ error: { code: 404, message: 'models/nope is not found for API version v1beta' } }),
  });
  await assert.rejects(
    callProvider('gemini', { apiKey: 'K', model: 'nope', characterId: 'usagi', text: '안녕' }, fetchImpl),
    (e) => e.status === 404 && /is not found/.test(e.detail),
  );
});
