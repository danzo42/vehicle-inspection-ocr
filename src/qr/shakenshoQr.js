/* =============================================================================
 * shakenshoQr.js  ―― 車検証の二次元コード（QR）から登録番号・車台番号を取り出す
 * -----------------------------------------------------------------------------
 * 国土交通省「二次元コード項目定義（2023.1版）」に従って読みます。
 *   二次元コード2（2分割）: バージョン / 自動車登録番号(全角12文字) / 標板区分 / 車台番号 / 原動機型式 / 帳票種別
 *   二次元コード3（3分割）: バージョン / 打刻位置 / 型式指定番号 / 有効期間の満了する日 / 初度登録年月 / 型式 / …
 * 区切りは半角スラッシュ、文字コードは Shift_JIS。
 * QRは読み取れた時点で中身が正確なので、OCRのような読み違いが起きません。
 *
 * ※ 電子車検証の券面のQRでは、有効期間の満了する日は "999999"（空）固定です。
 *    「自動車検査証記録事項」（A4の紙）のQRには満了日が入っています。
 *
 * 軽自動車は形が違います（軽自動車検査協会の仕様。下の parseKei）。
 *   QRは分割なしで1つずつ。紙の車検証・記録事項は6個（コード1〜6）、電子車検証は2個（コード2・3）。
 *   コード4・5は使用者の氏名・住所なので、読んでも中身は使わず、表示も保存もしません。
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS = global.VIS || {};
  const sjis = new TextDecoder('shift_jis');

  /**
   * jsQR の結果を、分割QRの情報と生のバイト列にまとめる。
   * QRの中身は「数字」「英数字」「バイト」「漢字」の書き方が混ざっていることがある
   * （車検証では、全角の登録番号は漢字、車台番号は英数字で入っていることがある）。
   * 区切りごとの情報（chunks）は数字・英数字の部分にバイト列を持たないため、
   * すべての部分が順番どおりに入っている binaryData を使う。
   */
  function toSymbol(r) {
    const sa = r.chunks.find(c => c.type === 'structuredappend');
    const bytes = Array.from(r.binaryData || []);
    return {
      seq: sa ? sa.currentSequence : null,
      total: sa ? sa.totalSequence + 1 : null,
      parity: sa ? sa.parity : null,
      bytes
    };
  }

  /** 0 から total までを、size の窓を step ずつずらして並べた位置（右端・下端も必ず含める） */
  function positions(total, size, step) {
    const out = [];
    if (size >= total) return [0];
    step = Math.max(1, Math.round(step || size / 2));
    for (let p = 0; p + size < total; p += step) out.push(p);
    out.push(total - size);
    return out;
  }

  /**
   * 画像（canvas）の中のQRを全部探す。
   * QRが横に並んでいると、まとめて探したときに隣のQRの目印と取り違えて読めなくなるため、
   * 画像を大きさの違う区画に分け、区画ごとに探す（車検証はQRが2個・3個並んでいる）。
   * @param {HTMLCanvasElement} canvas
   * @param {number[]} [fracs] 区画の幅（画像の幅に対する割合）。1 は画像全体
   * @returns {Array<{seq:number|null, total:number|null, parity:number|null, bytes:number[]}>}
   */
  function findAll(canvas, fracs, knownSize) {
    fracs = fracs || [1, 0.5, 0.34, 0.25, 0.17, 0.12];
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const W = canvas.width, H = canvas.height;
    const found = [], seen = new Set(), sizes = [];

    const scan = (tw, th, stepX, stepY) => {
      positions(H, th, stepY).forEach(y => positions(W, tw, stepX).forEach(x => {
        const d = ctx.getImageData(x, y, Math.min(tw, W - x), Math.min(th, H - y));
        const r = global.jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
        if (!r) return;
        const L = r.location;
        sizes.push(Math.hypot(L.topRightCorner.x - L.topLeftCorner.x, L.topRightCorner.y - L.topLeftCorner.y));
        const s = toSymbol(r);
        const key = (s.parity !== null ? `${s.parity}-${s.total}-${s.seq}` : '') + ':' + s.bytes.join(',');
        if (seen.has(key)) return;
        seen.add(key);
        found.push(s);
      }));
    };

    // ① 大きさの違う区画で探す
    //    区画は3分の1ずつずらす（半分ずつだと、区画の半分より大きいQRがどの区画にも収まらないことがある。
    //    軽自動車のQRは1つずつ並んでいて小さいため、特に起きやすい）
    fracs.forEach(frac => {
      const tw = Math.max(40, Math.round(W * frac));
      const th = frac >= 1 ? H : Math.min(H, Math.round(tw * 1.3));
      scan(tw, th, tw / 3, th / 3);
    });

    // ② 1つでも見つかったら、そのQRの大きさに合わせた細かい区画で探し直す
    //    （隣のQRが入り込まない大きさにすると、並んだQRを取りこぼしにくい）
    const qs = knownSize || (sizes.length ? sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] : 0);
    if (qs > 20) {
      const tw = Math.round(qs * 1.45);
      scan(tw, tw, tw * 0.3, tw * 0.3);
    }
    findAll.lastSize = qs || findAll.lastSize || 0;
    return found;
  }
  // 全角→半角、全角空白（桁合わせ）を取り除く
  const z = s => s.normalize('NFKC').replace(/\s/g, '');

  /**
   * 全角12文字の登録番号・車両番号 → 「金沢400わ1234」
   *   標板文字(4)＋分類番号(3)＋かな(1)＋一連番号(4) の順。
   *   軽自動車の小板（昔の小さいナンバー）だけは 分類番号(3)＋標板文字(4)＋かな(1)＋一連番号(4) の順
   *   （地名が数字で始まることはないので、先頭が数字なら小板）。
   */
  function plateOf(f) {
    if (!f || f.length !== 12) return '';
    const small = /^[0-9０-９]/.test(f);
    const region = small ? f.slice(3, 7) : f.slice(0, 4);
    const cls    = small ? f.slice(0, 3) : f.slice(4, 7);
    return z(region) + z(cls) + f.slice(7, 8) + z(f.slice(8, 12));
  }

  /** 二次元コード2の中身 → 登録番号・車台番号 */
  function parseCode2(text) {
    const p = text.split('/');
    if (p.length < 4 || !p[1] || p[1].length !== 12) return null;
    return {
      kind: 'code2',
      plateNumber: plateOf(p[1]),
      chassisNo: (p[3] || '').trim(),
      engineModel: (p[4] || '').trim()
    };
  }

  /** 二次元コード3の中身 → 型式・満了日・初度登録年月 */
  function parseCode3(text) {
    const p = text.split('/').map(s => s.trim());
    if (p.length < 6) return null;
    // 有効期間の満了する日（YYMMDD、未設定は999999）が続き、その後に初度登録年月（YYMM）、型式
    let i = 3;
    const dates = [];
    while (i < p.length && /^\d{6}$/.test(p[i])) dates.push(p[i++]);
    const first = /^\d{4}$/.test(p[i] || '') ? p[i++] : '';
    const model = p[i] || '';
    const d = dates.find(v => v !== '999999') || '';
    return {
      kind: 'code3',
      shakenExpiry: d ? `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}` : '',
      firstRegistration: first && first !== '9999' ? `20${first.slice(0, 2)}-${first.slice(2, 4)}` : '',
      model,
      typeDesignation: p[2] || ''
    };
  }

  /**
   * 軽自動車の二次元コード（軽自動車検査協会「各帳票に表示する二次元コードの仕様書」2024.01.04 適用）
   *   QR1つに1つのコード（分割なし）。先頭は “K” ／ バージョン2桁（1桁目がコード番号）。
   *     コード1  K/02/輸出整理番号/車両番号(全角12)/車台番号(半角20・左詰)/型式指定番号
   *     コード2  K/22/車両番号(全角12)/標板の枚数・大きさ/車台番号/原動機型式/帳票種別
   *     コード3  K/32/打刻位置/型式指定番号/有効期間満了日(YYMMDD)/初度検査年月/型式/…
   *     コード4・5  使用者の氏名・住所 → 個人情報なので中身は使わず、画面にも出さない
   *     コード6・7  自動車の種別・重量など／車両ID → このアプリでは使わない
   *   紙の車検証（令和5年12月まで）と自動車検査証記録事項はコード1〜6、
   *   電子車検証はコード2・3（満了日は "999999" 固定）。
   */
  function parseKei(text) {
    const p = text.split('/');
    if (p[0] !== 'K' || !/^\d{2}$/.test(p[1] || '')) return null;
    const code = p[1].charAt(0);
    if (code === '5' || code === '6') return { kind: 'personal', kei: true };
    if ((code === '2' || code === '0') && p.length >= 5) {
      const plate = plateOf(code === '2' ? p[2] : p[3]);
      const chassis = (p[4] || '').trim();
      if (plate && chassis) return { kind: 'code2', kei: true, keiCode: code === '2' ? 2 : 1, plateNumber: plate, chassisNo: chassis };
    }
    if (code === '3' && p.length >= 7) {
      const d = (p[4] || '').trim(), first = (p[5] || '').trim();
      return {
        kind: 'code3', kei: true,
        shakenExpiry: /^\d{6}$/.test(d) && d !== '999999' ? `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}` : '',
        firstRegistration: /^\d{4}$/.test(first) && !/99$/.test(first) ? `20${first.slice(0, 2)}-${first.slice(2, 4)}` : '',
        model: (p[6] || '').trim(),
        typeDesignation: (p[3] || '').trim()
      };
    }
    return { kind: 'kei-other', kei: true };
  }

  /** 中身の解析（軽自動車の形を先に見る。普通車の二次元コード3は形の決まりがゆるいため） */
  function parse(text) {
    return parseKei(text) || parseCode2(text) || parseCode3(text);
  }

  /** 分割していないQRを見分けるための短い値（中身そのものを鍵に残さない） */
  function digest(bytes) {
    let h = 0x811c9dc5;
    bytes.forEach(b => { h ^= b; h = Math.imul(h, 0x01000193); });
    return (h >>> 0).toString(36) + '-' + bytes.length;
  }

  /**
   * 読めたQRを貯めておき、分割されたQRがそろったら組み立てる。
   * 同じQRを何度読んでも1つとして数える。
   */
  class Collector {
    constructor() { this.symbols = new Map(); }

    /** @returns {boolean} 新しいQRだったら true */
    add(sym) {
      // 組の見分けは「パリティ＋何個で1組か」。パリティは1バイトなので、2つ並び・3つ並びで
      // 偶然同じ値になることがある（約256台に1台）。個数も見ないと2つの組が混ざってしまう
      const key = sym.parity !== null ? `${sym.parity}-${sym.total}-${sym.seq}` : 'single-' + digest(sym.bytes);
      if (this.symbols.has(key)) return false;
      // 軽自動車のコード4・5（使用者の氏名・住所）は、中身を捨てて「読んだ」ことだけ覚える
      if (sym.parity === null) {
        const k = parseKei(sjis.decode(new Uint8Array(sym.bytes)));
        if (k && k.kind === 'personal') sym = { seq: null, total: null, parity: null, bytes: [], personal: true };
      }
      this.symbols.set(key, sym);
      return true;
    }

    /** 分割QRのまとまりごとの状態（そろったものは中身を解析） */
    groups() {
      const g = new Map();
      this.symbols.forEach(s => {
        const key = s.parity !== null ? `p${s.parity}-${s.total}` : 'single-' + g.size;
        if (!g.has(key)) g.set(key, []);
        g.get(key).push(s);
      });
      return Array.from(g.values()).map(list => {
        list.sort((a, b) => (a.seq || 0) - (b.seq || 0));
        const total = list[0].total || 1;
        const complete = list.length === total;
        let text = '', parsed = null;
        if (complete && list[0].personal) {
          parsed = { kind: 'personal', kei: true };
        } else if (complete) {
          const bytes = [];
          list.forEach(s => bytes.push(...s.bytes));
          text = sjis.decode(new Uint8Array(bytes));
          parsed = parse(text);
        }
        return { have: list.length, total, complete, text, parsed };
      });
    }

    /** そろった結果をまとめる（登録番号・車台番号・型式・満了日） */
    result() {
      const r = {};
      this.groups().forEach(g => {
        if (g.parsed && (g.parsed.kind === 'code2' || g.parsed.kind === 'code3')) Object.assign(r, g.parsed, { kind: undefined });
      });
      delete r.kind;
      return r;
    }

    get count() { return this.symbols.size; }
  }
  VIS.shakenQr = { findAll, parse, parseCode2, parseCode3, parseKei, Collector };

})(typeof window !== 'undefined' ? window : globalThis);