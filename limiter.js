// 사람(IP)당 하루 N회 — 한국 시간(KST) 날짜 기준, 메모리에만 저장.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDay(ms) {
  return Math.floor((ms + KST_OFFSET_MS) / 86400000);
}

// perDay 는 숫자 또는 함수(설정이 바뀌면 바로 반영되게)
export function createLimiter({ perDay = 30, now = Date.now } = {}) {
  const cap = () => Math.max(0, Number(typeof perDay === 'function' ? perDay() : perDay) || 0);
  let day = null;
  let counts = new Map();

  function roll() {
    const d = kstDay(now());
    if (d !== day) {
      day = d;
      counts = new Map();
    }
  }

  return {
    check(ip) {
      roll();
      const used = counts.get(ip) ?? 0;
      return { ok: used < cap(), remaining: Math.max(0, cap() - used) };
    },
    consume(ip) {
      roll();
      const used = counts.get(ip) ?? 0;
      if (used >= cap()) return { ok: false, remaining: 0 };
      counts.set(ip, used + 1);
      return { ok: true, remaining: cap() - used - 1 };
    },
    refund(ip) {
      roll();
      const used = counts.get(ip) ?? 0;
      if (used > 0) counts.set(ip, used - 1);
    },
  };
}

// 짧은 창 제한(로그인 시도 등): windowMs 안에 max번까지.
export function createRateLimiter({ max = 5, windowMs = 60_000, now = Date.now } = {}) {
  const hits = new Map(); // ip -> [timestamps]
  return {
    blocked(ip) {
      const t = now();
      return (hits.get(ip) ?? []).filter((x) => t - x < windowMs).length >= max;
    },
    hit(ip) {
      const t = now();
      const arr = (hits.get(ip) ?? []).filter((x) => t - x < windowMs);
      if (arr.length >= max) {
        hits.set(ip, arr);
        return false;
      }
      arr.push(t);
      hits.set(ip, arr);
      return true;
    },
  };
}
