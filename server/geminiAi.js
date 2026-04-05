const https = require('https');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

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
    { text: '○', is_correct: false },
    { text: '✖', is_correct: false }
  ];
  const firstCorrectIndex = Array.isArray(choices) ? choices.findIndex((choice) => choice.is_correct) : -1;
  normalized[firstCorrectIndex === 1 ? 1 : 0].is_correct = true;
  return normalized;
}

function normalizeQuestion(question, index, choiceCount, allowMultipleAnswers){
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
  } else {
    const firstCorrectIndex = limitedChoices.findIndex((choice) => choice.is_correct);
    limitedChoices.forEach((choice, choiceIndex) => {
      choice.is_correct = choiceIndex === (firstCorrectIndex >= 0 ? firstCorrectIndex : 0);
    });
  }

  const correctCount = limitedChoices.filter((choice) => choice.is_correct).length;

  return {
    text: String((question && question.text) || '').trim() || ('問題 ' + (index + 1)),
    choices: limitedChoices,
    type: correctCount > 1 ? 'multiple' : 'single',
    points: Number.isFinite(question && question.points) ? Number(question.points) : 1,
    explanation: String((question && question.explanation) || '').trim()
  };
}

function normalizeQuestions(payload, questionCount, choiceCount, allowMultipleAnswers){
  const rawQuestions = Array.isArray(payload && payload.questions) ? payload.questions : [];
  if(rawQuestions.length === 0){
    throw new Error('Gemini returned no questions');
  }
  const normalized = rawQuestions.slice(0, questionCount).map((question, index) => normalizeQuestion(question, index, choiceCount, allowMultipleAnswers));
  while(normalized.length < questionCount){
    const fillIndex = normalized.length;
    const isBooleanChoice = choiceCount === 2;
    const choices = isBooleanChoice ? [
      { text: '○', is_correct: true },
      { text: '✖', is_correct: false }
    ] : Array.from({ length: choiceCount }, function(_, choiceIndex){
      return { text: buildChoiceLabel(choiceIndex), is_correct: allowMultipleAnswers ? choiceIndex < 2 : choiceIndex === 0 };
    });
    normalized.push({
      text: '問題 ' + (fillIndex + 1),
      choices: choices,
      type: !isBooleanChoice && allowMultipleAnswers ? 'multiple' : 'single',
      points: 1,
      explanation: ''
    });
  }
  return normalized;
}

function buildPrompt(options){
  const formatInstruction = options.choiceCount === 2
    ? '- 各問題は必ず○/✖の2択問題にする。choices の text は必ず「○」「✖」の2つにする'
    : options.allowMultipleAnswers
      ? '- 各問題は4択で、単一正答または複数正答を許可する。複数正答の問題を適度に含めてよい'
      : '- 各問題は単一正答の' + options.choiceCount + '択問題にする';

  return [
    'あなたは日本の学校向けテスト作成アシスタントです。',
    '以下の条件に従って、選択式問題を日本語で作成してください。',
    '回答は JSON のみを返してください。Markdown、説明文、コードフェンスは禁止です。',
    '',
    '条件:',
    '- 問題数: ' + options.questionCount + '問',
    '- 難易度: ' + options.difficultyLabel,
    '- 各問題の選択肢数: ' + options.choiceCount + '個',
    formatInstruction,
    '- 授業内容に直接基づく問題にする',
    '- ひっかけ問題を避け、授業理解を測る良問にする',
    '- 各問題に1つの短い解説を含める',
    '- points は 1 固定にする',
    '',
    '返却 JSON スキーマ:',
    '{',
    '  "questions": [',
    '    {',
    '      "text": "問題文",',
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
  return normalizeQuestions(parsed, options.questionCount, options.choiceCount, !!options.allowMultipleAnswers && options.choiceCount === 4);
}

module.exports = {
  generateQuestions,
  DEFAULT_MODEL
};