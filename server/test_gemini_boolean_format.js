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

const prompt = testApi.buildPrompt({
  questionCount: 3,
  difficultyLabel: '標準',
  choiceCount: 2,
  lessonContent: '地球と太陽に関する授業内容'
});

assert(prompt.includes('問題文の末尾は必ず「〇か✖か？」で終える'));
assert(prompt.includes('choices の text は必ず「〇」「✖」の2つにする'));

console.log('test_gemini_boolean_format: ok');
