const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('./geminiAi.js', 'utf8') + '\nmodule.exports.__test = { normalizeQuestions, buildPrompt };';
const moduleObj = { exports: {} };

vm.runInNewContext(source, {
  require,
  process,
  Buffer,
  console,
  module: moduleObj,
  exports: moduleObj.exports
});

const testApi = moduleObj.exports.__test;

const normalized = testApi.normalizeQuestions({
  questions: [
    {
      text: '地球は丸い。',
      choices: [
        { text: 'はい', is_correct: true },
        { text: 'いいえ', is_correct: false }
      ]
    },
    {
      text: '海は青いですか？',
      choices: [
        { text: 'はい', is_correct: true },
        { text: 'いいえ', is_correct: false }
      ]
    },
    {
      text: '太陽は西から昇る。',
      choices: [
        { text: 'はい', is_correct: false },
        { text: 'いいえ', is_correct: true }
      ]
    }
  ]
}, 4, 2, false);

assert.strictEqual(normalized.length, 4);
assert.strictEqual(normalized[0].text, '地球は丸い。〇か✖か？');
assert.strictEqual(normalized[1].text, '海は青い。〇か✖か？');
assert.strictEqual(normalized[2].text, '太陽は西から昇る。〇か✖か？');
assert.strictEqual(normalized[3].text, '問題 4。〇か✖か？');
assert(normalized.every((question) => question.text.endsWith('〇か✖か？')));
assert.strictEqual(JSON.stringify(normalized[0].choices), JSON.stringify([
  { text: '〇', is_correct: true },
  { text: '✖', is_correct: false }
]));
assert.strictEqual(JSON.stringify(normalized[2].choices), JSON.stringify([
  { text: '〇', is_correct: false },
  { text: '✖', is_correct: true }
]));

const allCorrectMultiple = testApi.normalizeQuestions({
  questions: [
    {
      text: '全てを正答にしてしまった4択問題',
      choices: [
        { text: 'A', is_correct: true },
        { text: 'B', is_correct: true },
        { text: 'C', is_correct: true },
        { text: 'D', is_correct: true }
      ]
    }
  ]
}, 1, 4, true);
assert.strictEqual(allCorrectMultiple[0].choices.filter((choice) => choice.is_correct).length, 3);
assert.strictEqual(JSON.stringify(allCorrectMultiple[0].choices.map((choice) => choice.is_correct)), JSON.stringify([true, true, true, false]));
assert.strictEqual(allCorrectMultiple[0].type, 'multiple');

const boundedMultiple = testApi.normalizeQuestions({
  questions: [
    {
      text: '2つ正答の4択問題',
      choices: [
        { text: 'A', is_correct: true },
        { text: 'B', is_correct: false },
        { text: 'C', is_correct: true },
        { text: 'D', is_correct: false }
      ]
    },
    {
      text: '3つ正答の4択問題',
      choices: [
        { text: 'A', is_correct: true },
        { text: 'B', is_correct: true },
        { text: 'C', is_correct: false },
        { text: 'D', is_correct: true }
      ]
    }
  ]
}, 2, 4, true);
assert.strictEqual(boundedMultiple[0].choices.filter((choice) => choice.is_correct).length, 2);
assert.strictEqual(boundedMultiple[0].type, 'multiple');
assert.strictEqual(boundedMultiple[1].choices.filter((choice) => choice.is_correct).length, 3);
assert.strictEqual(boundedMultiple[1].type, 'multiple');

const fillBlank = testApi.normalizeQuestions({
  questions: [
    {
      text: '水は____と酸素からできている。',
      choices: [
        { text: '水素', is_correct: true },
        { text: '窒素', is_correct: false },
        { text: '炭素', is_correct: true }
      ],
      explanation: '水は水素と酸素からできています。'
    }
  ]
}, 1, 3, false, 'fill_blank');
assert.strictEqual(fillBlank[0].type, 'fill_blank');
assert.strictEqual((fillBlank[0].text.match(/____/g) || []).length, 1);
assert.strictEqual(fillBlank[0].choices.length, 3);
assert.strictEqual(fillBlank[0].choices.filter((choice) => choice.is_correct).length, 1);
assert.strictEqual(fillBlank[0].choices[0].text, '水素');

const fillBlankMissingMarker = testApi.normalizeQuestions({
  questions: [
    {
      text: '太陽は東から昇る',
      choices: [
        { text: '東', is_correct: true },
        { text: '西', is_correct: false }
      ]
    }
  ]
}, 1, 2, false, 'fill_blank');
assert.strictEqual(fillBlankMissingMarker[0].type, 'fill_blank');
assert.strictEqual((fillBlankMissingMarker[0].text.match(/____/g) || []).length, 1);

const prompt = testApi.buildPrompt({
  questionCount: 3,
  difficultyLabel: '標準',
  choiceCount: 2,
  lessonContent: '地球と太陽に関する授業内容'
});

assert(prompt.includes('問題文の末尾は必ず「〇か✖か？」で終える'));
assert(prompt.includes('choices の text は必ず「〇」「✖」の2つにする'));
assert(prompt.includes('用語、関係、理由の理解を問う'));

const multiplePrompt = testApi.buildPrompt({
  questionCount: 3,
  difficultyKey: 'normal',
  difficultyLabel: '普通',
  choiceCount: 4,
  allowMultipleAnswers: true,
  lessonContent: '地球と太陽に関する授業内容'
});

assert(multiplePrompt.includes('正答は2つまたは3つ'));
assert(multiplePrompt.includes('4つ全てを正答にしてはいけない'));

const easyPrompt = testApi.buildPrompt({
  questionCount: 3,
  difficultyKey: 'easy',
  difficultyLabel: 'やさしい',
  choiceCount: 4,
  lessonContent: '地球と太陽に関する授業内容'
});

assert(easyPrompt.includes('授業内容に明示された基本事項を問う'));
assert(easyPrompt.includes('問題文は短くし、1文で理解できる表現にする'));
assert(easyPrompt.includes('正解と誤答の違いがはっきり分かる選択肢にする'));
assert(easyPrompt.includes('必要な推論は1段階までにする'));

const hardPrompt = testApi.buildPrompt({
  questionCount: 3,
  difficultyKey: 'hard',
  difficultyLabel: 'むずかしい',
  choiceCount: 4,
  lessonContent: '地球と太陽に関する授業内容'
});

assert(hardPrompt.includes('複数の情報を関連づけて答える問題にする'));
assert(hardPrompt.includes('比較、因果、理由説明を問う問題を含める'));
assert(hardPrompt.includes('2〜3段階の推論が必要な問題にする'));
assert(hardPrompt.includes('悪質なひっかけや授業外知識'));

const fillBlankPrompt = testApi.buildPrompt({
  questionCount: 2,
  difficultyKey: 'normal',
  difficultyLabel: 'ふつう',
  questionType: 'fill_blank',
  choiceCount: 3,
  lessonContent: '水の性質に関する授業内容'
});

assert(fillBlankPrompt.includes('虫食い問題'));
assert(fillBlankPrompt.includes('空欄記号「____」を必ず1つだけ含める'));
assert(fillBlankPrompt.includes('"type": "fill_blank"'));

console.log('test_gemini_boolean_format: ok');
