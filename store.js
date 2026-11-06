// 서버 설정 저장소 — 기본은 JSON 파일 하나.
// 올리는 곳에 파일 저장이 없으면(KV 등) 이 파일의 read/write만 바꾸면 된다.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SETTINGS = Object.freeze({
  adminHash: null, // 관리자 비밀번호 해시. null이면 아직 설정 전
  free: Object.freeze({
    enabled: true,
    provider: 'gemini',
    model: '',
    apiKey: '',
    perDay: 30,
  }),
});

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

export function createStore(file) {
  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...clone(DEFAULT_SETTINGS), ...raw, free: { ...clone(DEFAULT_SETTINGS.free), ...(raw.free || {}) } };
    } catch {
      return clone(DEFAULT_SETTINGS);
    }
  }
  function write(settings) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  function update(fn) {
    const next = fn(read());
    write(next);
    return next;
  }
  return { read, write, update };
}
