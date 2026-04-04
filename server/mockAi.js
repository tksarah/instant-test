exports.generateQuestions = function(text){
  // シンプルなモック実装：テキストから固定フォーマットで3問生成
  const excerpt = text ? (text.length > 60 ? text.slice(0,60) + '...' : text) : '（本文なし）';
  return [
    { type: 'single', text: `次の文章について正しいものはどれですか？\n${excerpt}`, points: 1, choices: [ { text: 'はい', is_correct: 1 }, { text: 'いいえ', is_correct: 0 } ] },
    { type: 'single', text: `本文の要点として最も適切なのは？\n${excerpt}`, points: 1, choices: [ { text: 'ポイントA', is_correct: 1 }, { text: 'ポイントB', is_correct: 0 } ] },
    { type: 'single', text: `本文と一致するものはどれ？\n${excerpt}`, points: 1, choices: [ { text: '選択肢A', is_correct: 1 }, { text: '選択肢B', is_correct: 0 } ] }
  ];
};
