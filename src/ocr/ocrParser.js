/* =============================================================================
 * ocrParser.js  ―― OCRで読んだ文字から「自動車登録番号」「車台番号」を取り出す
 * -----------------------------------------------------------------------------
 * OCR（文字認識）の結果には、余計な文字や読み間違いが混ざります。
 *   例）ナンバープレート → 「金沢 4OO\nワ 12-34」（Oとゼロ、カタカナのワ）
 *       車検証の車台番号  → 「車台番号 NHR85 - OOO1234」
 * ここでは、そうした揺れを吸収して
 *   自動車登録番号 … 「金沢400わ1234」（02の車両マスタ・記録簿と同じ書き方）
 *   車台番号       … 「NHR85-0001234」
 * の形に整えます。
 *
 * 画面やカメラには一切触らない「文字 → 文字」の処理だけなので、
 * tests/parser-test.html で単体の動作確認ができます。
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS = global.VIS || {};

  /** ナンバープレートに使われるひらがな（お・し・へ・ん は使われない） */
  const PLATE_KANA = 'あいうえかきくけこさすせそたちつてとなにぬねのはひふほまみむめもやゆよらりるれろわを';

  /** 数字と見間違えやすい文字 → 数字 */
  const DIGIT_LIKE = {
    'O': '0', 'o': '0', 'Q': '0', 'D': '0', 'U': '0', '〇': '0', '○': '0',
    'I': '1', 'l': '1', 'i': '1', '|': '1', '!': '1', 'L': '1', 'J': '1', ']': '1', '[': '1',
    'Z': '2', 'z': '2',
    'S': '5', 's': '5',
    'G': '6', 'b': '6',
    'T': '7',
    'B': '8',
    'g': '9', 'q': '9'
  };

  // ---------------------------------------------------------------------------
  //  文字の正規化
  // ---------------------------------------------------------------------------

  /** 全角英数→半角、半角カナ→全角 など（NFKC正規化） */
  function nfkc(s) {
    s = String(s == null ? '' : s);
    try { return s.normalize('NFKC'); } catch (e) { return s; }
  }

  /** ハイフンに見える文字（全角ハイフン・長音・各種ダッシュ・罫線）をすべて「-」にそろえる */
  function unifyDash(s) {
    return s.replace(/[\u2010-\u2015\u2212\uFF0D\uFF70\u30FC\u2500\u2501\u2043\uFE63]/g, '-');
  }

  /** 小さい「ゎ」「ぁ」などを普通の大きさに（プレートの ひらがな は小書きにならない） */
  const SMALL_KANA = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ' };

  /** カタカナ1文字 → ひらがな（OCRが「わ」を「ワ」と読むことがあるため）。小書きも直す */
  function toHiragana(ch) {
    const c = ch.charCodeAt(0);
    const h = (c >= 0x30A1 && c <= 0x30F6) ? String.fromCharCode(c - 0x60) : ch;
    return SMALL_KANA[h] || h;
  }

  /**
   * 先頭から「数字として読める文字」が続く部分を数字にして返す。
   *   例）"OO01234型" → "0001234"
   * 数字に見える英字（O・I・S・T など）は、その後ろにまた数字が続くか、
   * そこで文字が途切れるときだけ数字とみなす。
   *   例）"0001234TKG" → "0001234"（後ろの TKG は隣の欄の文字なので数字にしない）
   */
  function leadingDigits(s) {
    const chars = Array.from(s);
    let out = '';
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (/[0-9]/.test(ch)) { out += ch; continue; }
      if (!DIGIT_LIKE[ch]) break;
      // 数字に見える英字が続く範囲を調べ、その次の文字で判断する
      let j = i;
      while (j < chars.length && DIGIT_LIKE[chars[j]]) j++;
      const next = chars[j];
      if (next === undefined || /[0-9]/.test(next) || !/[A-Za-z]/.test(next)) {
        for (let k = i; k < j; k++) out += DIGIT_LIKE[chars[k]];
        i = j - 1;
      } else {
        break;
      }
    }
    return out;
  }

  /** 末尾から「数字として読める文字」が続く部分を数字にして返す（考え方は leadingDigits と同じ） */
  function trailingDigits(s) {
    return Array.from(leadingDigits(Array.from(s).reverse().join(''))).reverse().join('');
  }
  /** 2つの文字列の違い（何文字直せば一致するか） */
  function editDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = [];
    for (let i = 0; i <= m; i++) dp.push([i]);
    for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return dp[m][n];
  }

  function config() {
    return (VIS.config && VIS.config.ocr) || {};
  }

  // ---------------------------------------------------------------------------
  //  地名の合わせ込み
  // ---------------------------------------------------------------------------

  /**
   * OCRで読んだ地名（の末尾）を、地名一覧の一番近いものに合わせる。
   * @returns {{region:string, how:'exact'|'fuzzy'|'raw'|'none'}}
   */
  function snapRegion(raw, regions, preferred) {
    regions   = regions   || config().plateRegions     || [];
    preferred = preferred || config().preferredRegions || [];
    // 異体字・読み違えやすい字をそろえる（冨→富、ケ→ヶ）
    raw = String(raw || '').replace(/ケ/g, 'ヶ').replace(/冨/g, '富');
    if (!raw) return { region: '', how: 'none' };

    // 1) 末尾が地名と完全に一致（長い地名を優先：「北九州」＞「九州」）
    let best = null;
    regions.forEach(name => {
      if (raw.endsWith(name) && (!best || name.length > best.length)) best = name;
    });
    if (best) return { region: best, how: 'exact' };

    // 2) 1文字だけ違う地名（「金尺」→「金沢」）。同点ならよく使う地名を優先
    let cand = null;
    regions.forEach(name => {
      [name.length, name.length - 1, name.length + 1].forEach(len => {
        if (len < 1 || len > raw.length) return;
        const d = editDistance(raw.slice(-len), name);
        if (d > 1 || d >= name.length) return;          // 1文字の地名（柏・堺）はあいまい一致させない
        const pref = preferred.includes(name) ? 1 : 0;
        if (!cand || d < cand.d || (d === cand.d && pref > cand.pref) ||
            (d === cand.d && pref === cand.pref && name.length > cand.name.length)) {
          cand = { name, d, pref };
        }
      });
    });
    if (cand) return { region: cand.name, how: 'fuzzy' };

    // 3) 一覧に無い → 読んだまま（最大4文字）
    return { region: raw.slice(-4), how: 'raw' };
  }

  // ---------------------------------------------------------------------------
  //  自動車登録番号（ナンバープレート）
  // ---------------------------------------------------------------------------

  /**
   * OCRの文字から自動車登録番号を探す。
   *   ナンバーの構成： 地名 ＋ 分類番号(1〜3桁) ＋ ひらがな1文字 ＋ 一連指定番号(1〜4桁)
   *   例）金沢 400 わ 12-34 → 「金沢400わ1234」
   *
   * @param {string} text OCRの結果（複数行可）
   * @returns {null | {value, region, regionHow, classNo, kana, number, score, candidates:string[]}}
   */
  function parsePlate(text, regions, preferred) {
    const base = unifyDash(nfkc(text));
    // プレートは2段（上：地名＋分類番号、下：ひらがな＋番号）。
    // OCRが段の順番を入れ替えることがあるので、逆順につないだものも試す。
    const lines = base.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const variants = [lines.join('')];
    if (lines.length >= 2) variants.push(lines.slice().reverse().join(''));

    const found = [];
    variants.forEach((v, vi) => {
      // 空白・番号の前に付く「・」・プレートの枠線を読んだ記号（| [ ] など）を取り除く
      const s = v.replace(/[\s・･·.,、。:：'"|\[\](){}「」【】]/g, '');
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (!/[ぁ-んァ-ヶ]/.test(ch)) continue;
        const kana = toHiragana(ch);

        // 右側：一連指定番号（「12-34」のハイフンは除く）
        const right = s.slice(i + 1).replace(/^-+/, '');
        let number = leadingDigits(right.replace(/^([^-]{1,2})-/, '$1'));
        if (!number) continue;
        let score = 0;
        if (number.length > 4) { number = number.slice(0, 4); score -= 2; }
        score += number.length === 4 ? 3 : 2;

        // 左側：分類番号（1〜3桁）
        const left = s.slice(0, i);
        let classNo = trailingDigits(left);
        if (!classNo) continue;
        const classRun = classNo.length;
        if (classNo.length > 3) { classNo = classNo.slice(-3); score -= 1; }
        score += classNo.length === 3 ? 3 : classNo.length === 2 ? 2 : 1;

        // 分類番号のさらに左：地名
        const beforeClass = left.slice(0, left.length - classRun);
        const m = /[一-龥々ぁ-んァ-ヶ]{1,6}$/.exec(beforeClass);
        const snap = snapRegion(m ? m[0] : '', regions, preferred);
        score += { exact: 3, fuzzy: 2, raw: 0, none: -1 }[snap.how];

        if (PLATE_KANA.includes(kana)) score += 1;
        if (vi > 0) score -= 1;            // 逆順は少しだけ減点

        found.push({
          value: snap.region + classNo + kana + number,
          region: snap.region, regionHow: snap.how,
          classNo, kana, number, score
        });
      }
    });

    if (!found.length) return null;
    found.sort((a, b) => b.score - a.score);
    const best = found[0];
    best.candidates = Array.from(new Set(found.map(f => f.value))).slice(0, 5);
    return best;
  }

  /** 手入力した登録番号を整える（「金沢 400 わ 12-34」→「金沢400わ1234」） */
  function formatPlate(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const s = unifyDash(nfkc(raw)).replace(/[\s・･·.]/g, '');
    // 地名＋分類番号＋ひらがな＋番号 の形なら、番号のハイフンを除いて詰める。
    // 地名は入力どおりに残す（一覧に無い地名を勝手に書き換えないため）
    const m = /^([^0-9]*)([0-9]{1,3}[A-Z]{0,2})([ぁ-んァ-ヶ])([0-9]{1,2})-?([0-9]{0,2})$/.exec(s);
    if (m) return m[1] + m[2] + toHiragana(m[3]) + m[4] + m[5];
    return s;
  }

  /** 登録番号らしい形か（保存前の確認用） */
  function isPlausiblePlate(v) {
    return /^[一-龥々ぁ-んヶ]{1,5}[0-9]{1,3}[A-Z]{0,2}[ぁ-ん][0-9]{1,4}$/.test(String(v || ''));
  }

  // ---------------------------------------------------------------------------
  //  車台番号
  // ---------------------------------------------------------------------------

  /**
   * OCRの文字から車台番号を探す。
   *   国内の車台番号： 型式部分 ＋ ハイフン ＋ 製造番号（数字）  例）NHR85-0001234
   *   輸入車など     ： 17桁のVIN
   *   ハイフン無し   ： F300000001 のような形（一部の車両）
   *
   * @returns {null | {value, score, candidates:string[]}}
   */
  function parseChassis(text) {
    const base = unifyDash(nfkc(text)).toUpperCase();
    const found = [];

    function add(value, score) {
      if (value) found.push({ value, score });
    }

    // 空白の扱いを変えた2通りで探す
    //   v1: ハイフンの前後の空白だけ詰める（「NHR85 - 0001234」→「NHR85-0001234」）
    //   v2: 空白をすべて詰める（「NHR85-000 1234」のように番号の途中に空白が入る場合）
    const v1 = base.replace(/[ \t\u3000]*-[ \t\u3000]*/g, '-');
    const v2 = v1.replace(/[ \t\u3000]+/g, '');

    [v1, v2].forEach((s, vi) => {
      // 「車台番号」と書かれていれば、そのすぐ後ろにあるものを優先する
      const labelPos = s.search(/車台番号|車台|CHASSIS/);

      // ① 型式－製造番号
      const re = /([A-Z0-9]{2,10})-([A-Z0-9|!\[\]]{3,10})/g;
      let m;
      while ((m = re.exec(s))) {
        const model = m[1];
        const serial = leadingDigits(m[2]);
        if (serial.length < 4) continue;
        if (!/[A-Z]/.test(model)) continue;          // 型式部分には必ず英字が入る
        let score = 4;
        if (serial.length >= 5 && serial.length <= 8) score += 2;
        if (/[0-9]/.test(model)) score += 1;
        if (model.length >= 3 && model.length <= 7) score += 1;
        if (model.length >= 9) score -= 2;
        if (vi > 0) score -= 1;
        if (labelPos >= 0 && m.index >= labelPos && m.index - labelPos < 30) score += 2;
        add(model + '-' + serial, score);
      }

      // ② 17桁のVIN（I・O・Q は使われない）
      const vin = /(?:^|[^A-Z0-9])([A-HJ-NPR-Z0-9]{17})(?=$|[^A-Z0-9])/g;
      while ((m = vin.exec(s))) {
        if (/[A-Z]/.test(m[1]) && /[0-9]/.test(m[1])) add(m[1], 4);
      }

      // ③ ハイフン無し（英字1〜3文字＋数字6〜12桁）
      const plain = /(?:^|[^A-Z0-9-])([A-Z]{1,3}[0-9]{6,12})(?=$|[^A-Z0-9-])/g;
      while ((m = plain.exec(s))) add(m[1], 2);
    });

    if (!found.length) return null;
    found.sort((a, b) => b.score - a.score);
    const best = found[0];
    best.candidates = Array.from(new Set(found.map(f => f.value))).slice(0, 5);
    return best;
  }

  /** 手入力した車台番号を整える（全角→半角、小文字→大文字、空白除去） */
  function formatChassis(input) {
    return unifyDash(nfkc(String(input || ''))).toUpperCase().replace(/\s+/g, '');
  }

  /** 車台番号らしい形か（保存前の確認用） */
  function isPlausibleChassis(v) {
    v = String(v || '');
    return /^[A-Z0-9]{2,10}-[0-9]{4,8}$/.test(v) ||
           /^[A-HJ-NPR-Z0-9]{17}$/.test(v) ||
           /^[A-Z]{1,3}[0-9]{6,12}$/.test(v) ||
           /^[0-9]{6,12}$/.test(v);
  }

  // ---------------------------------------------------------------------------
  //  車検の有効期間の満了する日（紙の車検証・自動車検査証記録事項に印字がある場合）
  // ---------------------------------------------------------------------------

  /** 「有効期間の満了する日 令和8年10月13日」→ "2026-10-13"。見つからなければ '' */
  function parseExpiry(text) {
    const s = nfkc(text).replace(/\s+/g, '');
    const at = s.indexOf('満了');
    if (at < 0) return '';
    const tail = s.slice(at, at + 40);
    // 西暦（2026年10月13日 / 2026.10.13）
    let m = /(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})/.exec(tail);
    if (m) return ymd(Number(m[1]), m[2], m[3]);
    // 和暦。元号の文字はOCRで読み違えやすい（令和→信和 など）ので、
    // 「平」「H」が付くときだけ平成、それ以外は令和として扱う（車検の満了日は令和のみ）
    m = /([^\d]{0,2})(元|\d{1,2})[年.](\d{1,2})[月.](\d{1,2})/.exec(tail);
    if (m) {
      const n = m[2] === '元' ? 1 : Number(m[2]);
      const heisei = /[平H]/.test(m[1]);
      return ymd(heisei ? 1988 + n : 2018 + n, m[3], m[4]);
    }
    return '';
  }

  function ymd(y, m, d) {
    m = Number(m); d = Number(d);
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  VIS.ocrParser = {
    PLATE_KANA,
    parsePlate, formatPlate, isPlausiblePlate,
    parseChassis, formatChassis, isPlausibleChassis,
    parseExpiry, snapRegion,
    // テスト用
    _nfkc: nfkc, _editDistance: editDistance
  };

})(typeof window !== 'undefined' ? window : globalThis);