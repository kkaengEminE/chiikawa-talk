// 규칙 엔진 — AI 없이 즉시 동작하는 기본 변환.
import { ADVERBS, EMOTION_KEYWORDS, EMOTION_ORDER, FILLERS, NOUNS_ENDING_I, getCharacter } from './characters.js';

const EMOTE_TOKEN = /^[ㅠㅜㅋㅎㅎ~!?.…\-_]+$/; // ㅠㅠ ㅋㅋ ㅎㅎ 같은 감정 토큰

// ---------- 공통 ----------
export function splitSentences(text) {
  const out = [];
  // 홀로 선 ㅠㅠ/ㅋㅋ 같은 감정 토큰은 문장 경계로 본다.
  const src = text.replace(/(^|\s)[ㅠㅜㅋㅎ]+(?=\s|$)/g, '\n');
  const re = /([^.!?…~\n]+)([.!?…~]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[1]
      .split(/\s+/)
      .filter((t) => t && !EMOTE_TOKEN.test(t))
      .join(' ')
      .trim();
    if (!body) continue;
    const marks = m[2];
    const end = marks.includes('?') ? '?' : marks.includes('!') ? '!' : marks ? marks[0] : '';
    out.push({ text: body, end: end === '~' ? '' : end });
  }
  return out;
}

export function detectEmotion(text) {
  const t = text.trim();
  const endsQ = /\?\s*$/.test(t);
  const tokens = t.split(/\s+/);
  const has = (k) => (k.startsWith('^') ? tokens.some((w) => w.startsWith(k.slice(1))) : t.includes(k));
  for (const emo of EMOTION_ORDER) {
    if (emo === 'neutral') return 'neutral';
    if (emo === 'question') {
      if (endsQ) return 'question';
      continue;
    }
    if (EMOTION_KEYWORDS[emo].some(has)) return emo;
  }
  return 'neutral';
}

function pickRun(list, count, rng) {
  const start = Math.floor(rng() * list.length) % list.length;
  const res = [];
  for (let i = 0; i < count; i++) res.push(list[(start + i) % list.length]);
  return res;
}
const pick = (list, rng) => (list && list.length ? pickRun(list, 1, rng)[0] : '');

// ---------- sound 엔진 (치이카와·우사기) ----------
// 입력에 나온 순서대로 상황 낱말(cues)을 찾는다.
function findCues(text, cues = []) {
  const hits = [];
  for (const cue of cues) {
    let at = -1;
    for (const k of cue.keys) {
      const i = text.indexOf(k);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (at >= 0) hits.push({ cue, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.cue);
}

function convertSound(text, ch, rng) {
  const sentences = splitSentences(text);
  const detected = detectEmotion(text);
  const cues = findCues(text, ch.cues);
  const override = cues.find((c) => c.emotion)?.emotion;
  // 물음·싫음·화남·무서움이 잡힌 문장은 상황 낱말이 감정을 덮어쓰지 않는다.
  const emotion = override && ['neutral', 'sad', 'happy', 'yes'].includes(detected) ? override : detected;
  const longest = Math.max(0, ...sentences.map((s) => s.text.length));
  let count = Math.max(1, Math.min(ch.maxSounds, sentences.length + (longest > 6 ? 1 : 0)));
  const cueSounds = cues.flatMap((c) => c.sounds).slice(0, ch.maxSounds);
  count = Math.max(count, cueSounds.length);
  if (cueSounds.length === 1 && count === 1) count = 2; // 상황 소리 하나뿐이면 감정 소리 하나를 덧붙인다
  const list = ch.sounds[emotion] ?? ch.sounds.neutral;
  const word = (ch.words ?? []).find((w) => text.includes(w) && !list.some((p) => p.includes(w)));
  const parts = [...cueSounds];
  // 허용 낱말이 들어가면 소리 하나를 그 자리에 양보한다.
  let room = count - parts.length - (word ? 1 : 0);
  if (parts.length === 0) room = Math.max(1, room);
  if (room > 0) parts.push(...pickRun(list, room, rng));
  if (word) parts.push(word + ch.wordSuffix);
  return parts.join(' ');
}

// ---------- invert 엔진 (하치와레) ----------
// 한글 음절 분해/조립
const JUNG = { ㅏ: 0, ㅐ: 1, ㅓ: 4, ㅔ: 5, ㅕ: 6, ㅗ: 8, ㅘ: 9, ㅙ: 10, ㅚ: 11, ㅜ: 13, ㅝ: 14, ㅡ: 18, ㅣ: 20 };
const JONG_N = 4;
const JONG_L = 8;
const JONG_SS = 20;

function decompose(syl) {
  const code = (syl ?? '').charCodeAt(0) - 0xac00;
  if (!(code >= 0 && code < 11172)) return null;
  return { cho: Math.floor(code / 588), jung: Math.floor((code % 588) / 28), jong: code % 28 };
}
const compose = ({ cho, jung, jong }) => String.fromCharCode(0xac00 + cho * 588 + jung * 28 + jong);
const hasBatchim = (syl) => Boolean(decompose(syl)?.jong);
const hasSsBatchim = (syl) => decompose(syl)?.jong === JONG_SS;
const hasLBatchim = (syl) => decompose(syl)?.jong === JONG_L;
const stripPunct = (s) => s.replace(/[.!?…~,]+$/, '');

// 낱말 끝에 ㄴ 받침 붙이기(받침이 있으면 "은"): 뛰→뛴, 먹→먹은
function addN(word) {
  const d = decompose(word.at(-1));
  if (!d || d.jong) return word + '은';
  return word.slice(0, -1) + compose({ ...d, jong: JONG_N });
}
// 낱말 끝에 ㄹ 받침 붙이기(받침이 있으면 "을"): 재밌→재밌을, 좋→좋을, 힘들→힘들
function addL(word) {
  const d = decompose(word.at(-1));
  if (!d) return word + '을';
  if (d.jong === JONG_L) return word;
  if (d.jong) return word + '을';
  return word.slice(0, -1) + compose({ ...d, jong: JONG_L });
}
// 기본형 어간 → 관형형: 좋→좋은, 귀엽→귀여운, 예쁘→예쁜, 맛있→맛있는, 먹는→먹는, 간→가는
function plainToAdn(stem) {
  const d = decompose(stem.at(-1));
  if (!d) return null;
  if (stem.endsWith('하')) return { adn: stem.slice(0, -1) + '한', kind: 'adj' };
  if (stem.endsWith('는')) return { adn: stem, kind: 'verb' };
  if (d.jong === JONG_N) return { adn: stem.slice(0, -1) + compose({ ...d, jong: 0 }) + '는', kind: 'verb' }; // 간다 → 가는
  if (/(있|없)$/.test(stem)) return { adn: stem + '는', kind: 'adj' };
  if (d.jong === 17) return { adn: stem.slice(0, -1) + compose({ ...d, jong: 0 }) + '운', kind: 'adj' }; // ㅂ 불규칙: 귀엽 → 귀여운
  if (d.jong === JONG_L) return { adn: stem.slice(0, -1) + compose({ ...d, jong: JONG_N }), kind: 'adj' }; // ㄹ 탈락: 힘들 → 힘든
  return { adn: addN(stem), kind: 'adj' };
}

// 해체 → 관형형 사전. 형용사는 ㄴ/은, 동사는 는. 규칙으로 안 되는 과거형도 여기.
const ADJ = {
  배고파: '배고픈', 좋아: '좋은', 싫어: '싫은', 무서워: '무서운', 힘들어: '힘든', 피곤해: '피곤한', 심심해: '심심한',
  아파: '아픈', 슬퍼: '슬픈', 기뻐: '기쁜', 예뻐: '예쁜', 귀여워: '귀여운', 더워: '더운', 추워: '추운',
  맛있어: '맛있는', 맛없어: '맛없는', 재밌어: '재밌는', 재미있어: '재미있는', 없어: '없는', 있어: '있는',
  바빠: '바쁜', 졸려: '졸린', 배불러: '배부른', 늦어: '늦은', 커: '큰', 작아: '작은', 많아: '많은', 적어: '적은',
  빨라: '빠른', 느려: '느린', 멀어: '먼', 가까워: '가까운', 쉬워: '쉬운', 어려워: '어려운', 미워: '미운',
  아쉬워: '아쉬운', 그리워: '그리운', 짜증나: '짜증나는', 화나: '화나는', 신나: '신나는', 우울해: '우울한',
  행복해: '행복한', 불안해: '불안한', 괜찮아: '괜찮은', 이상해: '이상한', 대단해: '대단한', 귀찮아: '귀찮은',
  고마워: '고마운', 감사해: '감사한', 미안해: '미안한', 죄송해: '죄송한', 반가워: '반가운', 즐거워: '즐거운',
  괴로워: '괴로운', 부러워: '부러운', 외로워: '외로운', 두려워: '두려운', 무거워: '무거운', 가벼워: '가벼운',
  뜨거워: '뜨거운', 차가워: '차가운', 시원해: '시원한', 따뜻해: '따뜻한', 조용해: '조용한', 시끄러워: '시끄러운',
  답답해: '답답한', 설레: '설레는', 멋있어: '멋있는', 멋져: '멋진', 웃겨: '웃긴', 놀라워: '놀라운',
};
const VERB = {
  먹어: '먹는', 봐: '보는', 자: '자는', 사: '사는', 가: '가는', 와: '오는', 알아: '아는', 몰라: '모르는',
  마셔: '마시는', 읽어: '읽는', 써: '쓰는', 놀아: '노는', 쉬어: '쉬는', 울어: '우는', 웃어: '웃는',
  만나: '만나는', 떠나: '떠나는', 끝나: '끝나는', 일어나: '일어나는', 줘: '주는', 해: '하는', 돼: '되는',
  걸어: '걷는', 뛰어: '뛰는', 살아: '사는', 열어: '여는', 팔아: '파는', 만들어: '만드는', 들어: '듣는',
  모르겠어: '모르는', 알겠어: '아는',
};
const PAST = {
  썼어: '쓴', 컸어: '큰', 떴어: '뜬', 껐어: '끈', 들었어: '들은', 걸었어: '걸은', 울었어: '운', 놀았어: '논',
  알았어: '안', 살았어: '산', 만들었어: '만든', 열었어: '연', 팔았어: '판', 불었어: '분',
};
const DICT = [
  ...Object.entries(ADJ).map(([k, v]) => [k, v, 'adj']),
  ...Object.entries(VERB).map(([k, v]) => [k, v, 'verb']),
  ...Object.entries(PAST).map(([k, v]) => [k, v, 'past']),
].sort((a, b) => b[0].length - a[0].length);

// 과거형 어간(…ㅆ) → 관형형: 끝났→끝난, 먹었→먹은, 했→한, 봤→본, 잊어버렸→잊어버린
function pastToAdn(base) {
  const d = decompose(base.at(-1));
  const prev = base.slice(0, -1);
  const open = compose({ ...d, jong: 0 });
  if ((open === '어' || open === '아') && prev) return addN(prev);
  if (open === '해') return prev + '한';
  const UNDO = { [JUNG.ㅘ]: JUNG.ㅗ, [JUNG.ㅝ]: JUNG.ㅜ, [JUNG.ㅙ]: JUNG.ㅚ, [JUNG.ㅕ]: JUNG.ㅣ };
  return prev + compose({ cho: d.cho, jung: UNDO[d.jung] ?? d.jung, jong: JONG_N });
}

// 어간 → 해체(…어/아): 쓰→써, 보→봐, 하→해, 먹→먹어
function toHae(stem) {
  const last = stem.at(-1);
  const d = decompose(last);
  const head = stem.slice(0, -1);
  if (!d) return stem + '해';
  if (last === '하') return head + '해';
  if (d.jong) return stem + ([JUNG.ㅏ, JUNG.ㅗ].includes(d.jung) ? '아' : '어');
  const CONTRACT = { [JUNG.ㅡ]: JUNG.ㅓ, [JUNG.ㅗ]: JUNG.ㅘ, [JUNG.ㅜ]: JUNG.ㅝ, [JUNG.ㅣ]: JUNG.ㅕ, [JUNG.ㅚ]: JUNG.ㅙ };
  if (CONTRACT[d.jung] !== undefined) return head + compose({ cho: d.cho, jung: CONTRACT[d.jung], jong: 0 });
  if ([JUNG.ㅏ, JUNG.ㅓ, JUNG.ㅐ, JUNG.ㅔ, JUNG.ㅕ].includes(d.jung)) return stem;
  return stem + '어';
}

// 서술부 → { adn: 관형형, kind, base }. 모르면 null.
// kind: adj(형용사) verb(동사) past(과거) will(~ㄹ 거야) quote(~래/~대) copula(명사+이야)
function toAdn(pred) {
  let p = stripPunct(pred);
  if (p.length >= 3 && p.endsWith('요')) p = p.slice(0, -1); // 해요체 → 해체
  if (!p) return null;
  const will = p.match(/^(.+?)\s*(거야|거다|거예요|거임|건데|거지)$/);
  if (will && hasLBatchim(will[1].at(-1))) return { adn: will[1], kind: 'will', base: p };
  const doing = p.match(/^(.+는)\s*중(이야|임|이에요|인데)?$/); // 읽는 중 → 읽는
  if (doing) return { adn: doing[1], kind: 'verb', base: p };
  const seems = p.match(/^(.+)\s+(것|거|듯)\s*같(아|다|은데|네|아요)$/); // 맛있는 것 같아 → 맛있는 (것 같은데!?)
  if (seems) return { adn: seems[1], kind: 'guess', base: p };
  const like = p.match(/^(.+)\s+같(아|다|은데|네|아요)$/); // 바보 같아 → 바보 같은
  if (like) return { adn: `${like[1]} 같은`, kind: 'adj', base: p };
  const can = p.match(/^(.+)\s+수\s+(있|없)(어|다|네|는데|어요)$/); // 할 수 있어 → 할 수 있는
  if (can) return { adn: `${can[1]} 수 ${can[2]}는`, kind: 'verb', base: p };
  const must = p.match(/^(.+)야\s*(돼|해|함|된다|한다|되는데|하는데|돼요|해요)$/); // 시켜야 돼 → 시켜야 하는
  if (must) return { adn: `${must[1]}야 하는`, kind: 'verb', base: p };
  if (p.endsWith('자') && p.length >= 2) return { adn: p.slice(0, -1), kind: 'lets', base: p }; // 놀자 → 제안형으로
  if (p.endsWith('야지') && p.length >= 3) return { adn: p.slice(0, -2), kind: 'lets', base: p }; // 가야지 → 제안형으로
  for (const [k, v, kind] of DICT) if (p.endsWith(k)) return { adn: p.slice(0, -k.length) + v, kind, base: p };
  if (/싶(어|다|은데|네|지|어서|습니다)$/.test(p)) return { adn: p.replace(/싶(어|다|은데|네|지|어서|습니다)$/, '싶은'), kind: 'adj', base: p };
  const guess = p.match(/^(.+)겠(다|어|네|지|는데)$/); // 재밌겠다 → 재밌을 (것 같은데!?)
  if (guess) return { adn: addL(guess[1]), kind: 'guess', base: p };
  const past = p.match(/^(.+)(어|다|지|는데|네)$/);
  if (past && hasSsBatchim(past[1].at(-1))) return { adn: pastToAdn(past[1]), kind: 'past', base: past[1] };
  if (p.endsWith('다') && p.length >= 2) {
    const plain = plainToAdn(p.slice(0, -1));
    if (plain) return { ...plain, base: p };
  }
  if (p.endsWith('래') && p.length >= 2) {
    const stem = p.slice(0, -1);
    if (hasLBatchim(stem.at(-1))) return { adn: stem, kind: 'will', base: p }; // 먹을래 → 먹을
    return { adn: stem + '라는', kind: 'quote', base: p }; // 쓰래 → 쓰라는
  }
  if (p.endsWith('대') && p.length >= 2) return { adn: p.slice(0, -1) + '다는', kind: 'quote', base: p };
  if (p.endsWith('이야')) return { adn: p.slice(0, -2) + '인', kind: 'copula', base: p };
  if (p.endsWith('야') && p.length >= 2) return { adn: p.slice(0, -1) + '인', kind: 'copula', base: p };
  if (p.endsWith('해') && p.length >= 2) return { adn: p.slice(0, -1) + '하는', kind: 'verb', base: p };
  if (/[어아]$/.test(p) && p.length >= 2 && decompose(p.at(-2))) return { adn: p.slice(0, -1) + '는', kind: 'verb', base: p };
  return null;
}

// 두 토막짜리 서술부("먹고 싶어", "갈 거야")의 뒷토막
const AUX_TAIL = /^(싶어|싶어요|싶다|싶네|싶은데|싶어서|싶었어|거야|거예요|거다|거지|건데|같아|같아요|같다|같은데|있어|있어요|없어|없어요|해|해요|했어|했어요|할래|할게|할게요|줘|줘요|봐|봐요|볼래|볼까|버렸어|버렸다|버렸네|중|중이야|중임|중이에요|중인데)$/;
// 뒷토막(tail)과 붙는 앞토막(prev)인지: 먹고 (싶어), 갈 (거야), 것 (같아), 읽는 (중), 해 (줘), 시켜야 (돼). "다 했어"의 "다"는 아님.
function canJoin(prev, tail) {
  if (/^(거야|거다|거예요|거지|건데|거임)$/.test(tail)) return hasLBatchim(prev.at(-1)) || prev.endsWith('을');
  if (/^같/.test(tail)) return !isAdverb(prev) && !isFiller(prev); // 것 같아, 바보 같아
  if (/^중/.test(tail)) return prev.endsWith('는');
  if (/^(돼|해|함|된다|한다|돼요|해요)$/.test(tail) && prev.endsWith('야')) return true;
  return /(고|지|게|어|아|해|서|수)$/.test(prev);
}
const PARTICLE = /(이랑|하고|에서|으로|까지|부터|한테|에게|처럼|마다|보다|랑|을|를|이|가|은|는|도|만|에|로)$/;
const ADV_PARTICLE = /(이랑|하고|에서|으로|까지|부터|한테|에게|처럼|마다|보다|랑|에|로|같이)$/; // 꾸밈말로 남는 조사
const CLAUSE = /(니까|지만|는데|은데|인데|면서|느라|길래|려고|라고|으면|하면|되면|보면|가면|오면|고)$/; // 이어 주는 토막은 버린다
const NUMERALS = ['한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '몇', '백', '천'];
const COUNTERS = ['잔', '개', '명', '번', '마리', '병', '그릇', '조각', '권', '장', '시간', '분', '초', '살', '봉지', '캔', '통', '판', '접시', '줄', '알', '대', '채', '송이'];
const BOUND = new Set(['거', '것', '게', '걸', '거를', '것을']);

const stripParticle = (t) => (NOUNS_ENDING_I.includes(t) ? t : t.replace(PARTICLE, '') || t);
const isAdverb = (t) => ADVERBS.includes(t) || ADV_PARTICLE.test(t) || /^\S+ \S+$/.test(t);
const isFiller = (t) => FILLERS.includes(t) || FILLERS.includes(stripParticle(t));
// "~서"로 이어지는 토막(배고파서, 졸려서, 무서워서, 와서): 서 앞 음절이 받침 없는 ㅏ/ㅓ/ㅕ/ㅐ/ㅔ/ㅘ/ㅝ/ㅙ. 보고서·문서·순서는 아님.
function isClause(t) {
  if (CLAUSE.test(t)) return true;
  if (t.length < 2 || !t.endsWith('서')) return false;
  const d = decompose(t.at(-2));
  return Boolean(d && !d.jong && [JUNG.ㅏ, JUNG.ㅓ, JUNG.ㅕ, JUNG.ㅐ, JUNG.ㅔ, JUNG.ㅘ, JUNG.ㅝ, JUNG.ㅙ].includes(d.jung));
}
// 토막 하나가 그 자체로 서술("미안해", "좋아", "늦었어")인지
const DICT_KEYS = new Set(DICT.map(([k]) => k));
const looksLikePredicate = (t) => DICT_KEYS.has(t) || /(했어|었어|았어|겠어)$/.test(t);
function isModifier(t) {
  if (isAdverb(t) || isFiller(t)) return false;
  if (/(는|은|을|던)$/.test(t)) return true;
  const d = decompose(t.at(-1));
  return Boolean(d && (d.jong === JONG_N || d.jong === JONG_L));
}

// 문장 → { pred, advs, target, noun, hasModifier }
// "한 잔", "두 개" 같은 수량은 한 토막의 꾸밈말로 묶는다
function mergeCounters(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i + 1 < tokens.length && NUMERALS.includes(tokens[i]) && COUNTERS.includes(stripPunct(tokens[i + 1]))) {
      out.push(`${tokens[i]} ${tokens[i + 1]}`);
      i++;
    } else out.push(tokens[i]);
  }
  return out;
}

function parseSentence(text) {
  const tokens = mergeCounters(text.split(/\s+/));
  let n = 1;
  const tail = stripPunct(tokens.at(-1));
  if (tokens.length >= 2 && (AUX_TAIL.test(tail) || /^(돼|함|된다|한다)$/.test(tail)) && canJoin(tokens.at(-2), tail)) {
    n = 2;
    // "맛있는 것 같아", "할 수 있어"는 앞 토막까지 세 토막
    if (tokens.length >= 3 && ((/^같/.test(tail) && /^(것|거|듯)$/.test(tokens.at(-2)) && isModifier(tokens.at(-3))) || (/^(있|없)/.test(tail) && tokens.at(-2) === '수'))) n = 3;
  }
  const pred = tokens.slice(-n).join(' ');
  const rest = tokens.slice(0, -n);
  let target = null;
  let noun = null;
  let hasModifier = false;
  let used = -1;
  for (let i = rest.length - 1; i >= 0; i--) {
    const t = rest[i];
    if (isAdverb(t) || isFiller(t) || isClause(t)) continue;
    noun = stripParticle(t);
    target = noun;
    used = i;
    const prev = rest[i - 1];
    const glue = BOUND.has(t) || (t.endsWith('기') && t.length >= 2); // "맛있는 거", "회사 가기"는 앞말과 한 덩어리
    if (prev && (glue ? !isAdverb(prev) && !isFiller(prev) : isModifier(prev))) {
      target = `${prev} ${noun}`;
      hasModifier = true;
      used = i - 1;
    }
    break;
  }
  const taken = new Set(used < 0 ? [] : hasModifier ? [used, used + 1] : [used]);
  const advs = rest.filter((t, i) => !taken.has(i) && isAdverb(t));
  return { pred, advs, target, noun, hasModifier };
}

function composeInvert(s, ch, rng, { first, last }) {
  const text = s.text;
  if (ch.crisis.keys.some((k) => text.includes(k))) return pick(ch.crisis.lines, rng);
  const emotion = detectEmotion(text + (s.end || ''));
  const p = parseSentence(text);
  const advStr = p.advs.map((a) => `${a}…`).join(' ');
  const lead = (str) => (str ? `${str} ` : '');

  if (emotion === 'question') {
    return `${lead(first ? pick(ch.hooks.question, rng) : '')}${text}…? ${pick(ch.question, rng)}`;
  }
  if (emotion === 'no') {
    return p.target ? ch.dislike.withTarget.replace('{target}', p.target) : ch.dislike.alone;
  }
  // "응 알겠어"처럼 맞장구뿐이면
  if (emotion === 'yes' && !p.target && !p.advs.length) return `${pick(ch.hooks.yes, rng)} 그런 거지? 좋아!`;

  const info = toAdn(p.pred);

  // ~래(시킴)·~자(청유) → 긍정 제안: 그럼… 다시 써볼까? 보고서!
  if ((info?.kind === 'quote' && info.base.endsWith('래')) || info?.kind === 'lets') {
    const stem = info.kind === 'lets' ? info.adn : info.base.replace(/(으)?래$/, '');
    const verb = [...p.advs, toHae(stem) + ch.suggest.end].join(' ');
    return `${ch.suggest.hook} ${verb}${p.target ? ` ${p.target}!` : ''}`;
  }

  const hookKey = info?.kind === 'past' && ['neutral', 'yes'].includes(emotion) ? 'past' : emotion;
  const hook = first ? pick(ch.hooks[hookKey] ?? ch.hooks.neutral, rng) : '';
  const end = pick(ch.verbEnds[emotion] ?? ch.verbEnds.neutral, rng);
  const verb = !info ? `${stripPunct(p.pred)}… 그런 거야?` : info.kind === 'guess' ? `${info.adn} 것 같은데!?` : `${info.adn} ${end}`;

  if (p.target) {
    // 과거형은 가끔 "끝나버렸구나… 회의!" 꼴
    if (info?.kind === 'past' && !info.base.endsWith('버렸') && rng() >= 0.5) {
      const d = decompose(info.base.at(-1));
      const hae = info.base.slice(0, -1) + compose({ ...d, jong: 0 });
      return `${hae}${ch.pastAlt} ${p.target}!`;
    }
    const attr = pick(ch.attributes[p.noun] ?? [], rng);
    const mid = attr ? `${ch.demonstrative} ${attr}… ` : p.hasModifier ? `${ch.demonstrative} ` : '';
    return `${lead(hook)}${lead(advStr)}${verb} ${mid}${p.target}!`;
  }

  // 대상이 없을 때: 뒤에 문장이 더 있으면 "~데…"로 잇고, 마지막이면 "~걸…!" / "~거야…!"
  if (!last) {
    const tail = !info
      ? `${stripPunct(p.pred)}…`
      : info.kind === 'past' ? `${info.base}는데…`
      : info.kind === 'will' ? `${info.adn} 건데…`
      : info.kind === 'guess' ? `${info.adn} 것 같은데…`
      : `${info.adn}데…`;
    return `${lead(hook)}${lead(advStr)}${tail}`;
  }
  const tail = !info
    ? `${stripPunct(p.pred)}… 그런 거야…!`
    : info.kind === 'guess' ? `${info.adn} 것 같은데!?`
    : ['adj', 'copula'].includes(info.kind) ? `${info.adn} 걸…!`
    : `${info.adn} 거야…!`;
  return `${lead(hook)}${lead(advStr)}${tail}`;
}

// 한 문장 안에 서술이 둘이면("미안해 늦었어") 둘로 나눈다. "~ 죽겠다" 같은 강조 토막은 뗀다.
function splitClauses(s) {
  const tokens = s.text.split(/\s+/).filter((t, i) => i === 0 || !/^죽겠(다|어|네|음)?$/.test(stripPunct(t)));
  const out = [];
  let cur = [];
  tokens.forEach((t, i) => {
    cur.push(t);
    const next = tokens[i + 1];
    if (next && looksLikePredicate(t) && !(AUX_TAIL.test(stripPunct(next)) && canJoin(t, stripPunct(next)))) {
      out.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) out.push(cur.join(' '));
  return out.map((text, i) => ({ text, end: i === out.length - 1 ? s.end : '' }));
}

function convertInvert(text, ch, rng) {
  let sentences = splitSentences(text).flatMap(splitClauses);
  // "너무 좋아 진짜"의 "진짜"처럼 꾸밈말·추임새만 남은 토막은 버린다
  const onlyFiller = (s) => s.text.split(/\s+/).every((t) => isAdverb(t) || isFiller(t));
  if (sentences.length > 1) sentences = sentences.filter((s) => !onlyFiller(s));
  if (!sentences.length) return '';
  const parts = sentences.map((s, i) => composeInvert(s, ch, rng, { first: i === 0, last: i === sentences.length - 1 }));
  return [...new Set(parts)].join(' ');
}

// ---------- 진입점 ----------
export function convert(text, characterId, { rng = Math.random } = {}) {
  const ch = getCharacter(characterId);
  const clean = text.trim();
  if (!clean) return '';
  if (ch.engine === 'sound') return convertSound(clean, ch, rng);
  if (ch.engine === 'invert') return convertInvert(clean, ch, rng);
  throw new Error(`모르는 엔진: ${ch.engine}`);
}
