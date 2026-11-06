// 로컬 서버: 정적 파일 + 무료 AI 중계(/api/convert) + 관리자 설정(/api/admin/*). Node 기본 모듈만 사용.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_INPUT, getCharacter } from './characters.js';
import { PROVIDERS, callProvider } from './ai.js';
import { createLimiter, createRateLimiter } from './limiter.js';
import { createStore } from './store.js';
import { hashPassword, verifyPassword } from './auth.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MIN_PASSWORD = 6;

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const store = createStore(path.join(DATA_DIR, 'settings.json'));
const limiter = createLimiter({ perDay: () => store.read().free.perDay });
const loginLimiter = createRateLimiter({ max: 5, windowMs: 60_000 });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};
// 브라우저가 가져갈 수 있는 파일만
const PUBLIC = new Set(['index.html', 'style.css', 'app.js', 'characters.js', 'rules.js', 'ai.js']);

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
}

function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- 무료 AI ----------
function freeState() {
  const f = store.read().free;
  const on = Boolean(f.enabled && f.apiKey && PROVIDERS[f.provider]);
  return { ...f, on };
}

async function handleStatus(req, res) {
  const f = freeState();
  const { remaining } = limiter.check(clientIp(req));
  return send(res, 200, { enabled: f.on, provider: f.on ? PROVIDERS[f.provider].name : null, remaining, perDay: f.perDay });
}

async function handleConvert(req, res) {
  const f = freeState();
  if (!f.on) return send(res, 503, { error: 'disabled', message: '무료 AI가 꺼져 있어요' });
  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'bad_request', message: '요청이 이상해요' });
  }
  const text = String(body.text ?? '').trim();
  if (!text || text.length > MAX_INPUT) return send(res, 400, { error: 'too_long', message: `${MAX_INPUT}자까지만 돼요` });
  let ch;
  try {
    ch = getCharacter(String(body.characterId ?? ''));
  } catch {
    return send(res, 400, { error: 'bad_character', message: '모르는 친구예요' });
  }
  const ip = clientIp(req);
  const gate = limiter.consume(ip);
  if (!gate.ok) return send(res, 429, { error: 'quota', message: '오늘 무료 AI는 다 썼어요', remaining: 0 });
  try {
    const out = await callProvider(f.provider, { apiKey: f.apiKey, model: f.model, characterId: ch.id, text });
    return send(res, 200, { text: out, remaining: gate.remaining, provider: PROVIDERS[f.provider].name });
  } catch (e) {
    console.error('[convert]', e.message, e.detail ? `— ${e.detail}` : '');
    // 운영자 키·제공사 쪽 문제면 방문자 횟수는 돌려준다.
    limiter.refund(ip);
    const quota = e.status === 429;
    const rejected = e.status === 400 || e.status === 401 || e.status === 403;
    const badModel = e.status === 404;
    return send(res, quota ? 429 : 502, {
      error: quota ? 'quota' : 'upstream',
      message: quota
        ? '무료 AI 한도가 끝났어요'
        : rejected ? '무료 AI 키가 거절됐어요'
        : badModel ? '무료 AI 모델 이름이 맞지 않아요'
        : 'AI가 잠깐 응답을 못 했어요',
      remaining: gate.remaining + 1,
    });
  }
}

// ---------- 관리자 ----------
// 관리자 비밀번호를 통과한 응답에만 쓴다(키 전체 포함).
function adminFree(f) {
  return {
    enabled: Boolean(f.enabled),
    provider: f.provider,
    model: f.model,
    perDay: f.perDay,
    apiKey: f.apiKey || '',
  };
}

// 비밀번호 검사. 통과하면 body 반환, 아니면 응답을 보내고 null 반환.
// 틀린 시도만 센다(IP당 분당 5회).
async function requireAdmin(req, res) {
  const ip = clientIp(req);
  if (loginLimiter.blocked(ip)) {
    send(res, 429, { error: 'too_many', message: '잠깐 쉬었다가 다시 해 주세요' });
    return null;
  }
  let body;
  try {
    body = await readJson(req);
  } catch {
    send(res, 400, { error: 'bad_request', message: '요청이 이상해요' });
    return null;
  }
  const { adminHash } = store.read();
  if (!adminHash) {
    send(res, 409, { error: 'not_setup', message: '관리자 비밀번호를 먼저 만들어야 해요' });
    return null;
  }
  if (!verifyPassword(String(body.password ?? ''), adminHash)) {
    loginLimiter.hit(ip);
    send(res, 401, { error: 'bad_password', message: '비밀번호가 달라요' });
    return null;
  }
  return body;
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= MIN_PASSWORD && pw.length <= 200;
}

async function handleAdmin(req, res, url) {
  const sub = url.pathname.slice('/api/admin/'.length);

  if (req.method === 'GET' && sub === 'status') {
    return send(res, 200, { setup: Boolean(store.read().adminHash) });
  }

  if (req.method === 'POST' && sub === 'setup') {
    if (loginLimiter.blocked(clientIp(req))) return send(res, 429, { error: 'too_many', message: '잠깐 쉬었다가 다시 해 주세요' });
    if (store.read().adminHash) {
      loginLimiter.hit(clientIp(req));
      return send(res, 409, { error: 'already', message: '이미 관리자가 있어요' });
    }
    let body;
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, { error: 'bad_request', message: '요청이 이상해요' });
    }
    if (!validPassword(body.password)) return send(res, 400, { error: 'weak', message: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요` });
    store.update((cur) => ({ ...cur, adminHash: hashPassword(body.password) }));
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && sub === 'settings') {
    const body = await requireAdmin(req, res);
    if (!body) return;
    return send(res, 200, { free: adminFree(store.read().free) });
  }

  if (req.method === 'PUT' && sub === 'settings') {
    const body = await requireAdmin(req, res);
    if (!body) return;
    const provider = String(body.provider ?? '');
    if (!PROVIDERS[provider]) return send(res, 400, { error: 'bad_provider', message: '모르는 제공사예요' });
    const perDay = Number(body.perDay);
    if (!Number.isInteger(perDay) || perDay < 0 || perDay > 10000) return send(res, 400, { error: 'bad_per_day', message: '하루 횟수는 0~10000 사이 정수' });
    const model = String(body.model ?? '').trim().slice(0, 100);
    const apiKey = String(body.apiKey ?? '').trim().slice(0, 500);
    // 칸에 적힌 그대로 저장: 비워서 저장하면 키가 지워진다.
    const next = store.update((cur) => ({
      ...cur,
      free: { enabled: Boolean(body.enabled), provider, model, perDay, apiKey },
    }));
    return send(res, 200, { free: adminFree(next.free) });
  }

  if (req.method === 'POST' && sub === 'password') {
    const body = await requireAdmin(req, res);
    if (!body) return;
    if (!validPassword(body.newPassword)) return send(res, 400, { error: 'weak', message: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 해요` });
    store.update((cur) => ({ ...cur, adminHash: hashPassword(body.newPassword) }));
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'not_found' });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/status') return handleStatus(req, res);
  if (req.method === 'POST' && url.pathname === '/api/convert') return handleConvert(req, res);
  if (url.pathname.startsWith('/api/admin/')) return handleAdmin(req, res, url);
  return send(res, 404, { error: 'not_found' });
}

function serveStatic(req, res, url) {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const isIcon = rel.startsWith('icons/') && !rel.includes('..');
  if (!PUBLIC.has(rel) && !isIcon) return send(res, 404, '없는 파일이에요', 'text/plain; charset=utf-8');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, '없는 파일이에요', 'text/plain; charset=utf-8');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) handleApi(req, res, url).catch((e) => send(res, 500, { error: 'server', message: e.message }));
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else send(res, 405, 'method not allowed', 'text/plain');
  })
  .listen(PORT, () => {
    const f = freeState();
    console.log(`먼작귀 말투 변환기 → http://localhost:${PORT}`);
    console.log(`관리자: ${store.read().adminHash ? '설정됨' : '아직 없음 (화면 맨 아래 "관리자 설정"에서 비밀번호 만들기)'}`);
    console.log(`무료 AI: ${f.on ? `켜짐 (${PROVIDERS[f.provider].name}, 하루 ${f.perDay}회/IP)` : '꺼짐 (관리자 설정에서 키 입력)'}`);
  });
