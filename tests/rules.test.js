import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convert, detectEmotion, splitSentences } from '../rules.js';

const zero = () => 0; // 항상 목록의 첫 항목을 고르는 고정 난수

// ---------- 공통 ----------
test('splitSentences: 문장 부호와 줄바꿈으로 나누고 ㅠㅠ/ㅋㅋ 같은 감정 토큰은 뗀다', () => {
  assert.deepEqual(
    splitSentences('오늘 너무 배고파요 ㅠㅠ 맛있는 거 먹고 싶다!'),
    [
      { text: '오늘 너무 배고파요', end: '' },
      { text: '맛있는 거 먹고 싶다', end: '!' },
    ],
  );
});

test('detectEmotion: 배고픔·ㅠㅠ는 sad', () => {
  assert.equal(detectEmotion('오늘 너무 배고파요 ㅠㅠ'), 'sad');
});

test('detectEmotion: 무서움은 scared', () => {
  assert.equal(detectEmotion('무서워'), 'scared');
});

test('detectEmotion: 물음표로 끝나면 question', () => {
  assert.equal(detectEmotion('뭐 먹을까?'), 'question');
});

test('detectEmotion: 거절은 no', () => {
  assert.equal(detectEmotion('싫어'), 'no');
  assert.equal(detectEmotion('그건 좀 싫은데'), 'no');
});

test('detectEmotion: 먹고 싶다 같은 바람은 happy', () => {
  assert.equal(detectEmotion('피자 먹고 싶어'), 'happy');
});

// ---------- 치이카와 ----------
test('치이카와: 배고픈 긴 입력은 내용 없이 힘없는 소리만', () => {
  assert.equal(
    convert('오늘 너무 배고파요 ㅠㅠ 맛있는 거 먹고 싶다!', 'chiikawa', { rng: zero }),
    '웅… 으으… 흐윽…',
  );
});

test('치이카와: 먹고 싶은 건 기대 소리', () => {
  assert.equal(convert('피자 먹고 싶어', 'chiikawa', { rng: zero }), '와…! 응…!');
});

test('치이카와: 무서우면 히익', () => {
  assert.equal(convert('무서워', 'chiikawa', { rng: zero }), '히익…!');
});

test('치이카와: 허용 낱말(최고)은 한 번만 말로 남긴다', () => {
  assert.equal(convert('최고다 진짜 최고', 'chiikawa', { rng: zero }), '와…! 최고…!');
});

test('치이카와: 긴 문장이라도 입력 낱말은 새지 않는다', () => {
  const out = convert('회사에서 상사가 보고서 다시 쓰라고 해서 너무 힘들어요', 'chiikawa', { rng: zero });
  for (const w of ['회사', '상사', '보고서', '힘들']) assert.ok(!out.includes(w), `"${w}"가 새어 나옴: ${out}`);
});

// ---------- 우사기 ----------
test('우사기: 먹고 싶으면 식욕 소리 + 텐션', () => {
  assert.equal(convert('피자 먹고 싶어', 'usagi', { rng: zero }), '쥬르리… 우라라라라라라라라!');
});

test('우사기: 배고픔·맛있음은 상황 낱말 소리가 먼저, 나머지는 기쁨으로', () => {
  assert.equal(
    convert('오늘 너무 배고파요 ㅠㅠ 맛있는 거 먹고 싶다!', 'usagi', { rng: zero }),
    '쥬르리… 우아! 우라라라라라라라라!',
  );
});

test('우사기: 물음은 상황 소리 뒤에 하아?', () => {
  assert.equal(convert('뭐 먹을까?', 'usagi', { rng: zero }), '쥬르리… 하아?');
});

test('우사기: 방방곡곡은 츠츠우라우라', () => {
  assert.equal(convert('방방곡곡 다녀왔어', 'usagi', { rng: zero }), '츠츠우라우라! 우라!');
});

test('우사기: 봐봐·엄청 커는 각각 소리로', () => {
  assert.equal(convert('이거 봐봐 엄청 커', 'usagi', { rng: zero }), '이—! 우—라—!');
});

test('우사기: 화나면 하아?! 하아?!', () => {
  assert.equal(convert('너 진짜 짜증나', 'usagi', { rng: zero }), '하아?! 하아?! 우라라라라!!');
});

test('우사기: 생일은 유후후', () => {
  assert.equal(convert('생일 축하해', 'usagi', { rng: zero }), '유후후후후후—! 우라라라라라라라라!');
});

test('우사기: 모르겠으면 우—이—', () => {
  assert.equal(convert('모르겠어', 'usagi', { rng: zero }), '우—이—… 하아?');
});

// ---------- 하치와레 ----------
test('하치와레: 이유 조각은 버리고, 동사 → 그거 말야 → 특징 → 대상', () => {
  assert.equal(
    convert('배고파서 피자 먹고 싶어', 'hachiware', { rng: zero }),
    '있잖아… 먹고 싶은 거야? 그거 말야… 동그란 거… 피자!',
  );
});

test('하치와레: 기쁜 바람은 와앗! + 거야!?', () => {
  assert.equal(convert('피자 먹고 싶어', 'hachiware', { rng: zero }), '와앗! 먹고 싶은 거야!? 그거 말야… 동그란 거… 피자!');
});

test('하치와레: 특징 없는 대상은 바로 대상!', () => {
  assert.equal(convert('회의 끝났어', 'hachiware', { rng: zero }), '앗! 끝난 거야? 회의!');
});

test('하치와레: 과거형은 가끔 ~버렸구나 꼴', () => {
  assert.equal(convert('회의 끝났어', 'hachiware', { rng: () => 0.9 }), '끝나버렸구나… 회의!');
});

test('하치와레: 대상 없는 앞 문장은 ~데… 로 잇고 어떻게든 되라는 안 붙인다', () => {
  assert.equal(
    convert('오늘 너무 배고파요 ㅠㅠ 맛있는 거 먹고 싶다!', 'hachiware', { rng: zero }),
    '있잖아… 오늘… 너무… 배고픈데… 먹고 싶은 거야!? 그거 말야… 맛있는 거!',
  );
});

test('하치와레: ~래(시킴)는 그럼… 해볼까? 로 긍정', () => {
  assert.equal(convert('보고서 다시 쓰래', 'hachiware', { rng: zero }), '그럼… 다시 써볼까? 보고서!');
});

test('하치와레: 위기 낱말에만 어떻게든 되어랏', () => {
  assert.equal(convert('완전 망했어', 'hachiware', { rng: zero }), '에?! 이거 꽤 큰일난 거 같지만… 어떻게든 되어랏…!');
});

test('하치와레: 싫음은 다른 쪽이 더 좋을지도', () => {
  assert.equal(convert('그건 좀 싫은데', 'hachiware', { rng: zero }), '으음… 나는 다른 쪽이 더 좋을지도!');
  assert.equal(convert('피자 싫어', 'hachiware', { rng: zero }), '으음… 피자보다… 다른 쪽이 더 좋을지도!');
});

test('하치와레: 물음은 으음… + 긍정 꼬리', () => {
  assert.equal(convert('뭐 먹을까?', 'hachiware', { rng: zero }), '으음… 뭐 먹을까…? 일단 해 보면… 뭔가 알게 되지 않을까?');
});

test('하치와레: 대상 없는 동사는 ~는 거야…!', () => {
  assert.equal(convert('지금 뛰어', 'hachiware', { rng: zero }), '있잖아… 지금… 뛰는 거야…!');
});

test('하치와레: 명사+이야는 ~인 걸…!', () => {
  assert.equal(convert('오늘 생일이야', 'hachiware', { rng: zero }), '있잖아… 오늘… 생일인 걸…!');
});

test('하치와레: 조사 떼기 + 과거 관형형 + 특징 사전', () => {
  assert.equal(convert('밥은 먹었어', 'hachiware', { rng: zero }), '앗! 먹은 거야? 그거 말야… 따끈따끈한 거… 밥!');
});

test('하치와레: 축약 과거(렸어)는 ~린', () => {
  assert.equal(convert('잊어버렸어', 'hachiware', { rng: zero }), '앗! 잊어버린 거야…!');
});

test('하치와레: ~ㄹ 거야는 그대로 관형형', () => {
  assert.equal(convert('내일 학교 갈 거야', 'hachiware', { rng: zero }), '있잖아… 내일… 갈 거야? 학교!');
});

test('하치와레: 모르는 어미는 그런 거야로 받는다', () => {
  assert.equal(convert('보고서 썼음', 'hachiware', { rng: zero }), '있잖아… 썼음… 그런 거야? 보고서!');
});

test('하치와레: 축약 이음말(와서)은 버린다', () => {
  assert.equal(convert('비 와서 우울해', 'hachiware', { rng: zero }), '있잖아… 우울한 거야? 비!');
});

test('하치와레: 아무도·이거 같은 말은 대상이 아니다', () => {
  assert.equal(convert('나 오늘 생일인데 아무도 몰라', 'hachiware', { rng: zero }), '있잖아… 오늘… 모르는 거야…!');
  assert.equal(convert('이거 진짜 귀엽다', 'hachiware', { rng: zero }), '와앗! 진짜… 귀여운 걸…!');
});

test('하치와레: 기본형 ~다도 관형형으로', () => {
  assert.equal(convert('오늘 날씨 좋다', 'hachiware', { rng: zero }), '와앗! 오늘… 좋은 거야!? 날씨!');
});

test('하치와레: 청유 ~자는 그럼… 해볼까?', () => {
  assert.equal(convert('숙제 다 했어! 이제 놀자', 'hachiware', { rng: zero }), '앗! 다… 한 거야? 숙제! 그럼… 이제 놀아볼까?');
});

test('하치와레: ~는 중은 동사로', () => {
  assert.equal(convert('책 읽는 중', 'hachiware', { rng: zero }), '있잖아… 읽는 거야? 그거 말야… 네모난 거… 책!');
});

test('하치와레: 꾸밈말(잘)은 서술부에 붙지 않는다', () => {
  assert.equal(convert('잘 했어', 'hachiware', { rng: zero }), '앗! 잘… 한 거야…!');
});

test('하치와레: ~것 같아는 ~것 같은데!?', () => {
  assert.equal(convert('맛있는 것 같아', 'hachiware', { rng: zero }), '와앗! 맛있는 것 같은데!?');
});

test('하치와레: ~야 돼는 ~야 하는', () => {
  assert.equal(convert('강아지 산책 시켜야 돼', 'hachiware', { rng: zero }), '있잖아… 시켜야 하는 거야? 산책!');
});

test('하치와레: ㄹ 어간 형용사(힘들다)는 힘든', () => {
  assert.equal(convert('너무 힘들다', 'hachiware', { rng: zero }), '있잖아… 너무… 힘든 걸…!');
});

test('하치와레: ~ㄹ 수 있어는 한 덩어리', () => {
  assert.equal(convert('할 수 있어', 'hachiware', { rng: zero }), '있잖아… 할 수 있는 거야…!');
});

test('하치와레: 명사+같아는 ~같은 걸', () => {
  assert.equal(convert('나 진짜 바보 같아', 'hachiware', { rng: zero }), '으음… 진짜… 바보 같은 걸…!');
});

test('하치와레: 수량(한 잔)은 꾸밈말, 대상은 커피', () => {
  assert.equal(convert('커피 한 잔 마시고 싶네', 'hachiware', { rng: zero }), '와앗! 한 잔… 마시고 싶은 거야!? 그거 말야… 쌉쌀한 거… 커피!');
});

test('하치와레: 고마워는 고마운 걸', () => {
  assert.equal(convert('고마워!', 'hachiware', { rng: zero }), '와앗! 고마운 걸…!');
});

test('하치와레: 한 문장에 서술이 둘이면 앞은 ~데… 로', () => {
  assert.equal(detectEmotion('미안해 늦었어'), 'sad');
  assert.equal(convert('미안해 늦었어', 'hachiware', { rng: zero }), '있잖아… 미안한데… 늦은 거야…!');
});

test('하치와레: ~죽겠다는 위기가 아니라 강조', () => {
  assert.equal(convert('배불러 죽겠다', 'hachiware', { rng: zero }), '있잖아… 배부른 걸…!');
});

test('하치와레: 축약 이음말(졸려서)도 버린다', () => {
  assert.equal(convert('졸려서 못 하겠어', 'hachiware', { rng: zero }), '있잖아… 못… 할 것 같은데!?');
});

test('하치와레: 뒤에 남은 꾸밈말은 버린다', () => {
  assert.equal(convert('너무 좋아 진짜', 'hachiware', { rng: zero }), '와앗! 너무… 좋은 걸…!');
});

test('하치와레: 맞장구만 있으면 그런 거지? 좋아!', () => {
  assert.equal(convert('응 알겠어', 'hachiware', { rng: zero }), '알겠다! 그런 거지? 좋아!');
});

test('하치와레: ~야지는 그럼… 해볼까?', () => {
  assert.equal(convert('학원 가기 싫어 ㅠㅠ 그래도 가야지', 'hachiware', { rng: zero }), '으음… 학원 가기보다… 다른 쪽이 더 좋을지도! 그럼… 그래도 가볼까?');
});

test('하치와레: 하루 종일은 꾸밈말', () => {
  assert.equal(convert('오늘 하루 종일 잤다', 'hachiware', { rng: zero }), '앗! 오늘… 하루… 종일… 잔 거야…!');
});

test('하치와레: 이로 끝나는 낱말은 조사로 안 본다', () => {
  assert.equal(convert('고양이 봤어', 'hachiware', { rng: zero }), '앗! 본 거야? 그거 말야… 보들보들한 거… 고양이!');
});

test('하치와레: ~겠다는 ~을 것 같은데!?', () => {
  assert.equal(convert('그거 재밌겠다', 'hachiware', { rng: zero }), '와앗! 재밌을 것 같은데!?');
});

test('하치와레: ~기는 앞말과 묶는다', () => {
  assert.equal(convert('회사 가기 싫다', 'hachiware', { rng: zero }), '으음… 회사 가기보다… 다른 쪽이 더 좋을지도!');
});

test('모르는 캐릭터는 에러', () => {
  assert.throws(() => convert('안녕', 'momonga'));
});
