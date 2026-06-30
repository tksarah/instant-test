const https = require('https');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const MAX_MULTIPLE_CORRECT_CHOICES = 3;
const FILL_BLANK_TYPE = 'fill_blank';
const BLANK_MARKER = '____';

function buildChoiceLabel(index){
  return '選択肢 ' + String.fromCharCode(65 + index);
}

function postJson(url, payload, headers){
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(url, {
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }, headers || {})
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let parsed = null;
        try{
          parsed = raw ? JSON.parse(raw) : null;
        }catch(err){
          return reject(new Error('Gemini response parse failed: ' + err.message));
        }
        if(response.statusCode < 200 || response.statusCode >= 300){
          const message = parsed && parsed.error && parsed.error.message ? parsed.error.message : ('HTTP ' + response.statusCode);
          return reject(new Error(message));
        }
        resolve(parsed);
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function extractTextFromGeminiResponse(payload){
  const candidates = payload && payload.candidates;
  if(!Array.isArray(candidates) || candidates.length === 0){
    throw new Error('Gemini returned no candidates');
  }
  const parts = (((candidates[0] || {}).content || {}).parts) || [];
  const text = parts.map((part) => part && part.text ? part.text : '').join('').trim();
  if(!text){
    throw new Error('Gemini returned empty content');
  }
  return text;
}

function stripCodeFence(text){
  if(!text) return '';
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
}

function normalizeBooleanChoices(choices){
  const normalized = [
    { text: '〇', is_correct: false },
    { text: '✖', is_correct: false }
  ];
  const firstCorrectIndex = Array.isArray(choices) ? choices.findIndex((choice) => choice.is_correct) : -1;
  normalized[firstCorrectIndex === 1 ? 1 : 0].is_correct = true;
  return normalized;
}

function capCorrectChoices(choices, maxCorrect){
  let correctSeen = 0;
  (choices || []).forEach((choice) => {
    if(!choice || !choice.is_correct) return;
    correctSeen += 1;
    if(correctSeen > maxCorrect){
      choice.is_correct = false;
    }
  });
}

function normalizeFillBlankQuestionText(text, fallbackLabel){
  const rawText = String(text || '').trim();
  let normalizedText = rawText
    .replace(/_{2,}/g, BLANK_MARKER)
    .replace(/＿{2,}/g, BLANK_MARKER)
    .replace(/（\s*空欄\s*）/g, BLANK_MARKER)
    .replace(/\(\s*空欄\s*\)/g, BLANK_MARKER)
    .replace(/［\s*空欄\s*］/g, BLANK_MARKER)
    .replace(/\[\s*空欄\s*\]/g, BLANK_MARKER)
    .replace(/【\s*空欄\s*】/g, BLANK_MARKER)
    .trim();

  if(!normalizedText){
    return fallbackLabel + ': ' + BLANK_MARKER;
  }

  const firstBlankIndex = normalizedText.indexOf(BLANK_MARKER);
  if(firstBlankIndex < 0){
    return normalizedText.replace(/[。．.!！?？]+$/u, '') + ' ' + BLANK_MARKER;
  }

  return normalizedText.slice(0, firstBlankIndex + BLANK_MARKER.length) +
    normalizedText.slice(firstBlankIndex + BLANK_MARKER.length).replace(/____/g, '');
}

function normalizeFillBlankQuestion(question, index, choiceCount){
  const rawChoices = Array.isArray(question && question.choices) ? question.choices : [];
  const normalizedChoices = rawChoices
    .map((choice) => ({
      text: String((choice && choice.text) || '').trim(),
      is_correct: !!(choice && (choice.is_correct === true || choice.is_correct === 1 || choice.isCorrect === true))
    }))
    .filter((choice) => choice.text);

  while(normalizedChoices.length < choiceCount){
    normalizedChoices.push({
      text: buildChoiceLabel(normalizedChoices.length),
      is_correct: false
    });
  }

  const limitedChoices = normalizedChoices.slice(0, choiceCount);
  const firstCorrectIndex = limitedChoices.findIndex((choice) => choice.is_correct);
  limitedChoices.forEach((choice, choiceIndex) => {
    choice.is_correct = choiceIndex === (firstCorrectIndex >= 0 ? firstCorrectIndex : 0);
  });

  const fallbackText = '問題 ' + (index + 1);
  const normalizedText = normalizeFillBlankQuestionText(question && question.text, fallbackText);

  return {
    text: normalizedText,
    choices: limitedChoices,
    type: FILL_BLANK_TYPE,
    points: Number.isFinite(question && question.points) ? Number(question.points) : 1,
    explanation: String((question && question.explanation) || '').trim()
  };
}

function normalizeBooleanQuestionText(text, fallbackLabel){
  const rawText = String(text || '').trim();
  if(!rawText){
    return fallbackLabel + '。〇か✖か？';
  }

  const statement = rawText
    .replace(/(〇|○)か✖か[？?]?$/u, '')
    .replace(/(はい|いいえ|〇|○|✖)で答え(なさい)?[。．]?[？?]?$/u, '')
    .replace(/(はい|いいえ|〇|○|✖)で選び(なさい)?[。．]?[？?]?$/u, '')
    .replace(/(正しい|間違い|誤り)ものを選び(なさい)?[。．]?[？?]?$/u, '')
    .replace(/(正しい|正しいです|正しいでしょう|間違い|間違っています|誤り|誤っています)(ですか|でしょうか|か)?[？?]?$/u, '')
    .replace(/(ですか|でしょうか|ますか)[？?]?$/u, '')
    .replace(/[。．.!！?？]+$/u, '')
    .trim();

  return (statement || fallbackLabel) + '。〇か✖か？';
}

function normalizeQuestion(question, index, choiceCount, allowMultipleAnswers, questionType){
  if(questionType === FILL_BLANK_TYPE){
    return normalizeFillBlankQuestion(question, index, choiceCount);
  }

  const rawChoices = Array.isArray(question && question.choices) ? question.choices : [];
  const normalizedChoices = rawChoices
    .map((choice) => ({
      text: String((choice && choice.text) || '').trim(),
      is_correct: !!(choice && (choice.is_correct === true || choice.is_correct === 1 || choice.isCorrect === true))
    }))
    .filter((choice) => choice.text);

  while(normalizedChoices.length < choiceCount){
    normalizedChoices.push({
      text: buildChoiceLabel(normalizedChoices.length),
      is_correct: false
    });
  }

  let limitedChoices = normalizedChoices.slice(0, choiceCount);
  if(choiceCount === 2){
    limitedChoices = normalizeBooleanChoices(limitedChoices);
  } else if(allowMultipleAnswers){
    if(!limitedChoices.some((choice) => choice.is_correct)){
      limitedChoices[0].is_correct = true;
    }
    capCorrectChoices(limitedChoices, MAX_MULTIPLE_CORRECT_CHOICES);
  } else {
    const firstCorrectIndex = limitedChoices.findIndex((choice) => choice.is_correct);
    limitedChoices.forEach((choice, choiceIndex) => {
      choice.is_correct = choiceIndex === (firstCorrectIndex >= 0 ? firstCorrectIndex : 0);
    });
  }

  const correctCount = limitedChoices.filter((choice) => choice.is_correct).length;
  const fallbackText = '問題 ' + (index + 1);
  const normalizedText = choiceCount === 2
    ? normalizeBooleanQuestionText(question && question.text, fallbackText)
    : (String((question && question.text) || '').trim() || fallbackText);

  return {
    text: normalizedText,
    choices: limitedChoices,
    type: correctCount > 1 ? 'multiple' : 'single',
    points: Number.isFinite(question && question.points) ? Number(question.points) : 1,
    explanation: String((question && question.explanation) || '').trim()
  };
}

function normalizeQuestions(payload, questionCount, choiceCount, allowMultipleAnswers, questionType){
  const rawQuestions = Array.isArray(payload && payload.questions) ? payload.questions : [];
  if(rawQuestions.length === 0){
    throw new Error('Gemini returned no questions');
  }
  const normalized = rawQuestions.slice(0, questionCount).map((question, index) => normalizeQuestion(question, index, choiceCount, allowMultipleAnswers, questionType));
  while(normalized.length < questionCount){
    const fillIndex = normalized.length;
    if(questionType === FILL_BLANK_TYPE){
      normalized.push({
        text: '問題 ' + (fillIndex + 1) + ': ' + BLANK_MARKER,
        choices: Array.from({ length: choiceCount }, function(_, choiceIndex){
          return { text: buildChoiceLabel(choiceIndex), is_correct: choiceIndex === 0 };
        }),
        type: FILL_BLANK_TYPE,
        points: 1,
        explanation: ''
      });
      continue;
    }
    const isBooleanChoice = choiceCount === 2;
    const choices = isBooleanChoice ? [
      { text: '〇', is_correct: true },
      { text: '✖', is_correct: false }
    ] : Array.from({ length: choiceCount }, function(_, choiceIndex){
      return { text: buildChoiceLabel(choiceIndex), is_correct: allowMultipleAnswers ? choiceIndex < 2 : choiceIndex === 0 };
    });
    normalized.push({
      text: isBooleanChoice ? ('問題 ' + (fillIndex + 1) + '。〇か✖か？') : ('問題 ' + (fillIndex + 1)),
      choices: choices,
      type: !isBooleanChoice && allowMultipleAnswers ? 'multiple' : 'single',
      points: 1,
      explanation: ''
    });
  }
  return normalized;
}

function buildDifficultyInstruction(difficultyKey){
  const instructions = {
    easy: [
      '- 授業内容に明示された基本事項を問う',
      '- 問題文は短くし、1文で理解できる表現にする',
      '- 正解と誤答の違いがはっきり分かる選択肢にする',
      '- 必要な推論は1段階までにする'
    ],
    normal: [
      '- 用語、関係、理由の理解を問う',
      '- 1〜2段階の判断で答えられる問題にする',
      '- 近い誤答選択肢を少し含め、授業内容の理解で見分けられるようにする'
    ],
    hard: [
      '- 複数の情報を関連づけて答える問題にする',
      '- 比較、因果、理由説明を問う問題を含める',
      '- 2〜3段階の推論が必要な問題にする',
      '- ただし悪質なひっかけや授業外知識がないと解けない問題は避ける'
    ]
  };
  return [
    '難易度別の作問方針:',
    ...(instructions[difficultyKey] || instructions.normal)
  ].join('\n');
}

function buildPrompt(options){
  const isFillBlank = options.questionType === FILL_BLANK_TYPE;
  const formatInstruction = isFillBlank
    ? [
        '- 各問題は虫食い問題にする。text には空欄記号「____」を必ず1つだけ含める',
        '- choices は空欄に入る候補にする',
        '- 正解候補は必ず1つだけ is_correct: true にする',
        '- 空欄の前後だけで正解が推測できすぎないよう、授業内容の理解で答えられる文にする'
      ].join('\n')
    : options.choiceCount === 2
    ? [
        '- 各問題は必ず〇/✖の2択問題にする。choices の text は必ず「〇」「✖」の2つにする',
        '- 各問題は1つの文や記述を提示し、問題文の末尾は必ず「〇か✖か？」で終える',
        '- 〇/✖の正解は、問題文の内容と矛盾しないようにする'
      ].join('\n')
    : options.allowMultipleAnswers
      ? '- 各問題は4択で、単一正答または複数正答を許可する。複数正答の問題を適度に含めてよい。複数正答の場合、正答は2つまたは3つにし、4つ全てを正答にしてはいけない'
      : '- 各問題は単一正答の' + options.choiceCount + '択問題にする';
  const difficultyInstruction = buildDifficultyInstruction(options.difficultyKey);

  return [
    'あなたは日本の学校向けテスト作成アシスタントです。',
    '以下の条件に従って、' + (isFillBlank ? '虫食い問題' : '選択式問題') + 'を日本語で作成してください。',
    '回答は JSON のみを返してください。Markdown、説明文、コードフェンスは禁止です。',
    '',
    '条件:',
    '- 問題数: ' + options.questionCount + '問',
    '- 難易度: ' + options.difficultyLabel,
    '- 各問題の選択肢数: ' + options.choiceCount + '個',
    formatInstruction,
    difficultyInstruction,
    '- 授業内容に直接基づく問題にする',
    '- ひっかけ問題を避け、授業理解を測る良問にする',
    '- 各問題に1つの短い解説を含める',
    '- points は 1 固定にする',
    '',
    '返却 JSON スキーマ:',
    '{',
    '  "questions": [',
    '    {',
    '      "type": "' + (isFillBlank ? FILL_BLANK_TYPE : 'single') + '",',
    '      "text": "' + (isFillBlank ? '問題文の____に入る語句を選ぶ形式' : '問題文') + '",',
    '      "choices": [',
    '        { "text": "選択肢", "is_correct": true },',
    '        { "text": "選択肢", "is_correct": false }',
    '      ],',
    '      "points": 1,',
    '      "explanation": "短い解説"',
    '    }',
    '  ]',
    '}',
    '',
    '授業内容:',
    options.lessonContent
  ].join('\n');
}

async function generateQuestions(options){
  if(!process.env.GEMINI_API_KEY){
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const prompt = buildPrompt(options);
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(DEFAULT_MODEL) + ':generateContent?key=' + encodeURIComponent(process.env.GEMINI_API_KEY);
  const response = await postJson(url, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json'
    }
  });

  const text = stripCodeFence(extractTextFromGeminiResponse(response));
  let parsed = null;
  try{
    parsed = JSON.parse(text);
  }catch(err){
    throw new Error('Gemini JSON parse failed: ' + err.message);
  }
  return normalizeQuestions(parsed, options.questionCount, options.choiceCount, !!options.allowMultipleAnswers && options.choiceCount === 4, options.questionType === FILL_BLANK_TYPE ? FILL_BLANK_TYPE : 'choice');
}

module.exports = {
  generateQuestions,
  DEFAULT_MODEL
};
