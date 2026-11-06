import { CHARACTERS, MAX_INPUT, getCharacter } from './characters.js';
import { convert } from './rules.js';
import { PROVIDERS, callProvider } from './ai.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'ct.ai';
const CHAR_KEY = 'ct.char';

const state = {
  characterId: localStorage.getItem(CHAR_KEY) || CHARACTERS[0].id,
  ai: loadAi(),
  free: { enabled: false, provider: null, remaining: 0, perDay: 30 },
  lastText: '',
};

function loadAi() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && PROVIDERS[v.provider] && v.apiKey ? v : null;
  } catch {
    return null;
  }
}
function saveAi(v) {
  if (v) localStorage.setItem(STORE_KEY, JSON.stringify(v));
  else localStorage.removeItem(STORE_KEY);
  state.ai = v;
  renderAiButton();
}

async function postJson(url, body, method = 'POST') {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j.message || `오류 ${r.status}`);
    e.status = r.status;
    e.code = j.error;
    e.data = j;
    throw e;
  }
  return j;
}

// ---------- 캐릭터 ----------
function renderChars() {
  const box = $('chars');
  box.innerHTML = '';
  for (const c of CHARACTERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'char';
    b.dataset.id = c.id;
    b.setAttribute('aria-pressed', String(c.id === state.characterId));
    b.innerHTML = `<img src="${c.icon}" alt="" /><span class="name">${c.name}</span><span class="tag">${c.tagline}</span>`;
    b.addEventListener('click', () => selectChar(c.id));
    box.appendChild(b);
  }
  applyTheme();
}
function selectChar(id) {
  state.characterId = id;
  localStorage.setItem(CHAR_KEY, id);
  for (const b of document.querySelectorAll('.char')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  applyTheme();
  if (state.lastText) run(state.lastText);
}
function applyTheme() {
  const t = getCharacter(state.characterId).theme;
  const r = document.documentElement.style;
  r.setProperty('--bg', t.bg);
  r.setProperty('--accent', t.accent);
  r.setProperty('--ink', t.ink);
}

// ---------- 입력 ----------
const input = $('input');
input.maxLength = MAX_INPUT;
$('max').textContent = MAX_INPUT;
function updateCount() {
  const n = input.value.length;
  $('count').textContent = n;
  $('count').parentElement.classList.toggle('full', n >= MAX_INPUT);
}
input.addEventListener('input', updateCount);
input.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('go').click();
});
$('go').addEventListener('click', () => run(input.value));
$('again').addEventListener('click', () => state.lastText && run(state.lastText));
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('result').textContent);
    flash($('copy'), '복사됨!');
  } catch {
    flash($('copy'), '실패…');
  }
});
function flash(btn, msg) {
  const old = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => (btn.textContent = old), 1200);
}

// ---------- 변환: 내 키 → 무료 AI → 규칙 ----------
let busy = false;
async function run(raw) {
  const text = raw.trim().slice(0, MAX_INPUT);
  if (!text || busy) return;
  state.lastText = text;
  busy = true;
  $('go').disabled = true;
  $('again').disabled = true;
  showNote('');

  const ch = getCharacter(state.characterId);
  let out = '';
  let mode = '';
  try {
    if (state.ai) {
      $('go').textContent = `${PROVIDERS[state.ai.provider].name}가 생각 중…`;
      out = await callProvider(state.ai.provider, { apiKey: state.ai.apiKey, model: state.ai.model, characterId: ch.id, text });
      mode = `내 키 AI · ${PROVIDERS[state.ai.provider].name}`;
    } else if (state.free.enabled && state.free.remaining > 0) {
      $('go').textContent = '무료 AI가 생각 중…';
      try {
        const j = await postJson('/api/convert', { text, characterId: ch.id });
        out = j.text;
        state.free.remaining = j.remaining;
        mode = `무료 AI · ${j.provider} · 오늘 ${j.remaining}회 남음`;
      } catch (e) {
        if (e.code === 'quota') state.free.remaining = 0;
        if (e.code === 'disabled') state.free.enabled = false;
        if (typeof e.data?.remaining === 'number') state.free.remaining = e.data.remaining;
        throw e;
      }
    }
  } catch (e) {
    showNote(`AI 대신 규칙으로 바꿨어요 (${e.message})`);
    out = '';
  }
  if (!out) {
    out = convert(text, ch.id);
    mode = mode || '규칙 모드';
  }
  showResult(ch, out, mode);
  renderAiButton();
  busy = false;
  $('go').disabled = false;
  $('again').disabled = false;
  $('go').textContent = '변환하기 ✦';
}

function showResult(ch, out, mode) {
  $('result-card').hidden = false;
  $('result-icon').src = ch.icon;
  $('result-name').textContent = ch.name;
  $('result').textContent = out;
  $('mode').textContent = mode;
  $('result-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function showNote(msg) {
  const n = $('note');
  n.hidden = !msg;
  n.textContent = msg;
}

// ---------- 무료 AI 상태 ----------
async function loadFreeStatus() {
  try {
    const r = await fetch('/api/status');
    if (!r.ok) return;
    state.free = await r.json();
    $('free-cap').textContent = state.free.perDay;
  } catch {
    /* 정적 호스팅이면 없음 */
  }
  renderAiButton();
}
function renderAiButton() {
  const dot = $('ai-dot');
  const label = $('ai-label');
  const hint = $('hint');
  if (state.ai) {
    dot.classList.add('on');
    label.textContent = `${PROVIDERS[state.ai.provider].name} 연결됨`;
    hint.textContent = '내 키로 AI 변환';
  } else {
    dot.classList.remove('on');
    label.textContent = '내 AI 설정';
    hint.textContent = state.free.enabled
      ? `무료 AI(${state.free.provider}) 오늘 ${state.free.remaining}회 남음`
      : '규칙 모드 · 내 AI 설정에 키를 넣으면 더 자연스러워요';
  }
}

// ---------- 제공사 탭 (방문자·관리자 공용) ----------
function renderTabs(box, picked, onPick) {
  box.innerHTML = '';
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.role = 'tab';
    b.textContent = p.name;
    b.setAttribute('aria-selected', String(id === picked));
    b.addEventListener('click', () => onPick(id));
    box.appendChild(b);
  }
}

// ---------- 키 보기(👁) 버튼: 두 모달 공용 ----------
for (const eye of document.querySelectorAll('.eye')) {
  eye.addEventListener('click', () => {
    const inp = $(eye.dataset.for);
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? '키 가리기' : '키 보기');
  });
}
function hideKey(id) {
  const inp = $(id);
  inp.type = 'password';
  const eye = document.querySelector(`.eye[data-for="${id}"]`);
  eye.setAttribute('aria-pressed', 'false');
  eye.setAttribute('aria-label', '키 보기');
}

// ---------- 방문자용 AI 설정 모달 ----------
const dlg = $('ai-dialog');
let pickedProvider = 'gemini';
function fillProvider() {
  const p = PROVIDERS[pickedProvider];
  renderTabs($('provider-tabs'), pickedProvider, (id) => {
    pickedProvider = id;
    fillProvider();
  });
  $('api-key').placeholder = p.placeholder;
  $('api-model').placeholder = p.defaultModel;
  $('key-link').href = p.keyUrl;
  const same = state.ai && state.ai.provider === pickedProvider;
  $('api-key').value = same ? state.ai.apiKey : '';
  $('api-model').value = same ? state.ai.model || '' : '';
}
$('ai-open').addEventListener('click', () => {
  pickedProvider = state.ai?.provider || 'gemini';
  hideKey('api-key');
  fillProvider();
  $('ai-disconnect').hidden = !state.ai;
  dlg.showModal();
});
$('ai-cancel').addEventListener('click', () => dlg.close());
$('ai-disconnect').addEventListener('click', () => {
  saveAi(null);
  dlg.close();
});
$('ai-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const apiKey = $('api-key').value.trim();
  if (!apiKey) {
    $('api-key').focus();
    return;
  }
  saveAi({ provider: pickedProvider, apiKey, model: $('api-model').value.trim() });
  dlg.close();
});

// ---------- 관리자 모달 ----------
const adm = $('admin-dialog');
let admPw = '';
let admProvider = 'gemini';
let admSetup = true;

function admError(id, msg) {
  const el = $(id);
  el.hidden = !msg;
  el.textContent = msg || '';
}
function admFillProvider() {
  renderTabs($('adm-tabs'), admProvider, (id) => {
    admProvider = id;
    admFillProvider();
  });
  $('adm-model').placeholder = PROVIDERS[admProvider].defaultModel;
  $('adm-key').placeholder = PROVIDERS[admProvider].placeholder;
  $('adm-key-link').href = PROVIDERS[admProvider].keyUrl;
}
function admShowSettings(free) {
  $('admin-auth').hidden = true;
  $('admin-settings').hidden = false;
  admProvider = free.provider;
  admFillProvider();
  $('adm-enabled').checked = free.enabled;
  $('adm-model').value = free.model || '';
  $('adm-perday').value = free.perDay;
  hideKey('adm-key');
  $('adm-key').value = free.apiKey || '';
  $('adm-newpw').value = '';
  $('adm-key-hint').textContent = free.apiKey ? '저장됨' : '아직 없음';
  admError('admin-err', '');
  admError('admin-ok', '');
}
async function admOpen() {
  admPw = '';
  admError('admin-auth-err', '');
  $('admin-auth').hidden = false;
  $('admin-settings').hidden = true;
  $('admin-pw').value = '';
  $('admin-pw2').value = '';
  try {
    const r = await fetch('/api/admin/status');
    if (!r.ok) throw new Error();
    admSetup = (await r.json()).setup;
  } catch {
    admSetup = true;
  }
  $('admin-auth-sub').textContent = admSetup
    ? '사이트가 제공하는 무료 AI의 키·모델·하루 횟수를 바꿔요.'
    : '처음이에요. 관리자 비밀번호를 만들어 주세요(6자 이상). 이 비밀번호로만 무료 AI 키를 바꿀 수 있어요.';
  $('admin-pw-label').textContent = admSetup ? '비밀번호' : '새 비밀번호';
  $('admin-pw2-field').hidden = admSetup;
  $('admin-auth-go').textContent = admSetup ? '들어가기' : '만들기';
  adm.showModal();
  $('admin-pw').focus();
}
$('admin-open').addEventListener('click', admOpen);
for (const b of adm.querySelectorAll('.admin-close')) b.addEventListener('click', () => adm.close());
adm.addEventListener('close', () => {
  admPw = '';
});

$('admin-auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('admin-pw').value;
  admError('admin-auth-err', '');
  try {
    if (!admSetup) {
      if (pw !== $('admin-pw2').value) throw new Error('비밀번호 확인이 달라요');
      await postJson('/api/admin/setup', { password: pw });
    }
    const j = await postJson('/api/admin/settings', { password: pw });
    admPw = pw;
    admShowSettings(j.free);
  } catch (err) {
    admError('admin-auth-err', err.message);
  }
});

$('admin-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  admError('admin-err', '');
  admError('admin-ok', '');
  $('admin-save').disabled = true;
  try {
    const j = await postJson(
      '/api/admin/settings',
      {
        password: admPw,
        enabled: $('adm-enabled').checked,
        provider: admProvider,
        model: $('adm-model').value.trim(),
        perDay: Number($('adm-perday').value),
        apiKey: $('adm-key').value.trim(),
      },
      'PUT',
    );
    const newPw = $('adm-newpw').value;
    if (newPw) {
      await postJson('/api/admin/password', { password: admPw, newPassword: newPw });
      admPw = newPw;
    }
    admShowSettings(j.free);
    admError('admin-ok', newPw ? '저장했어요. 비밀번호도 바뀌었어요.' : '저장했어요.');
    await loadFreeStatus();
  } catch (err) {
    admError('admin-err', err.message);
  } finally {
    $('admin-save').disabled = false;
  }
});

// ---------- 시작 ----------
renderChars();
updateCount();
renderAiButton();
loadFreeStatus();
