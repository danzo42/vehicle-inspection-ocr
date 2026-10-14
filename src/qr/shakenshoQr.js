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
        const key = (s.parity !== null ? `${s.parity}-${s.seq}` : '') + ':' + s.bytes.join(',');
        if (seen.has(key)) return;
        seen.add(key);
        found.push(s);
      }));
    };

    // ① 大きさの違う区画で探す
    fracs.forEach(frac => {
      const tw = Math.max(40, Math.round(W * frac));
      const th = frac >= 1 ? H : Math.min(H, Math.round(tw * 1.3));
      scan(tw, th);
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
  /** 二次元コード2の中身 → 登録番号・車台番号 */
  function parseCode2(text) {
    const p = text.split('/');
    if (p.length < 4 || !p[1] || p[1].length !== 12) return null;
    const f = p[1];
    // 全角→半角、全角空白（桁合わせ）を取り除く
    const z = s => s.normalize('NFKC').replace(/\s/g, '');
    return {
      kind: 'code2',
      plateNumber: z(f.slice(0, 4)) + z(f.slice(4, 7)) + f.slice(7, 8) + z(f.slice(8, 12)),
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
   * 読めたQRを貯めておき、分割されたQRがそろったら組み立てる。
   * 同じQRを何度読んでも1つとして数える。
   */
  class Collector {
    constructor() { this.symbols = new Map(); }

    /** @returns {boolean} 新しいQRだったら true */
    add(sym) {
      const key = sym.parity !== null ? `${sym.parity}-${sym.seq}` : 'single-' + sym.bytes.join(',');
      if (this.symbols.has(key)) return false;
      this.symbols.set(key, sym);
      return true;
    }

    /** 分割QRのまとまりごとの状態（そろったものは中身を解析） */
    groups() {
      const g = new Map();
      this.symbols.forEach(s => {
        const key = s.parity !== null ? 'p' + s.parity : 'single-' + g.size;
        if (!g.has(key)) g.set(key, []);
        g.get(key).push(s);
      });
      return Array.from(g.values()).map(list => {
        list.sort((a, b) => (a.seq || 0) - (b.seq || 0));
        const total = list[0].total || 1;
        const complete = list.length === total;
        let text = '', parsed = null;
        if (complete) {
          const bytes = [];
          list.forEach(s => bytes.push(...s.bytes));
          text = sjis.decode(new Uint8Array(bytes));
          parsed = parseCode2(text) || parseCode3(text);
        }
        return { have: list.length, total, complete, text, parsed };
      });
    }

    /** そろった結果をまとめる（登録番号・車台番号・型式・満了日） */
    result() {
      const r = {};
      this.groups().forEach(g => { if (g.parsed) Object.assign(r, g.parsed, { kind: undefined }); });
      delete r.kind;
      return r;
    }

    get count() { return this.symbols.size; }
  }

  VIS.shakenQr = { findAll, parseCode2, parseCode3, Collector };

})(typeof window !== 'undefined' ? window : globalThis);