// 半角カタカナ→全角カタカナ変換。郵便番号検索APIが半角カナで読みを返すため、
// このシステムの他のフリガナ欄(全角カタカナ入力が前提)と体裁を揃えるために使う。

const HALF_TO_FULL: Record<string, string> = {
  ｦ: 'ヲ', ｧ: 'ァ', ｨ: 'ィ', ｩ: 'ゥ', ｪ: 'ェ', ｫ: 'ォ', ｬ: 'ャ', ｭ: 'ュ', ｮ: 'ョ', ｯ: 'ッ',
  ｱ: 'ア', ｲ: 'イ', ｳ: 'ウ', ｴ: 'エ', ｵ: 'オ',
  ｶ: 'カ', ｷ: 'キ', ｸ: 'ク', ｹ: 'ケ', ｺ: 'コ',
  ｻ: 'サ', ｼ: 'シ', ｽ: 'ス', ｾ: 'セ', ｿ: 'ソ',
  ﾀ: 'タ', ﾁ: 'チ', ﾂ: 'ツ', ﾃ: 'テ', ﾄ: 'ト',
  ﾅ: 'ナ', ﾆ: 'ニ', ﾇ: 'ヌ', ﾈ: 'ネ', ﾉ: 'ノ',
  ﾊ: 'ハ', ﾋ: 'ヒ', ﾌ: 'フ', ﾍ: 'ヘ', ﾎ: 'ホ',
  ﾏ: 'マ', ﾐ: 'ミ', ﾑ: 'ム', ﾒ: 'メ', ﾓ: 'モ',
  ﾔ: 'ヤ', ﾕ: 'ユ', ﾖ: 'ヨ',
  ﾗ: 'ラ', ﾘ: 'リ', ﾙ: 'ル', ﾚ: 'レ', ﾛ: 'ロ',
  ﾜ: 'ワ', ﾝ: 'ン', ｰ: 'ー',
  '｡': '。', '｢': '「', '｣': '」', '､': '、', ﾞ: '゛', ﾟ: '゜'
};

const VOICED: Record<string, string> = {
  カ: 'ガ', キ: 'ギ', ク: 'グ', ケ: 'ゲ', コ: 'ゴ',
  サ: 'ザ', シ: 'ジ', ス: 'ズ', セ: 'ゼ', ソ: 'ゾ',
  タ: 'ダ', チ: 'ヂ', ツ: 'ヅ', テ: 'デ', ト: 'ド',
  ハ: 'バ', ヒ: 'ビ', フ: 'ブ', ヘ: 'ベ', ホ: 'ボ'
};

const SEMI_VOICED: Record<string, string> = {
  ハ: 'パ', ヒ: 'ピ', フ: 'プ', ヘ: 'ペ', ホ: 'ポ'
};

export function toFullWidthKatakana(input: string): string {
  let result = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    const base = HALF_TO_FULL[ch];
    if (base) {
      if (next === 'ﾞ' && VOICED[base]) {
        result += VOICED[base];
        i++;
        continue;
      }
      if (next === 'ﾟ' && SEMI_VOICED[base]) {
        result += SEMI_VOICED[base];
        i++;
        continue;
      }
      result += base;
    } else {
      result += ch;
    }
  }
  return result;
}
