/* =============================================================================
 * util.js  ―― 画面共通の小さな道具箱（02の util.js ＋ OCR版で使う関数）
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS = global.VIS || {};

  const util = {

    /** document.querySelector の短縮 */
    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },

    /**
     * URLのクエリ文字列（?id=DC4-0737）を取り出す。
     * 将来QRをURL形式にした場合に備え、id が無いときは
     * パス末尾（/v/DC4-0737）も見に行きます。
     */
    param(name) {
      const q = new URLSearchParams(location.search).get(name);
      if (q) return q;
      if (name === 'id' && /\/v\//.test(location.pathname)) {
        return decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
      }
      return q;
    },

    /** HTMLに埋め込む文字列をエスケープする（表示崩れ・不正コード混入の防止） */
    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /* -------------------------------------------------------------------------
     * QRコードから読んだ文字列を、車両IDの正しい形に整える。
     *
     * 実機のQRは「DC4-0737」のようなプレーンテキストですが、
     * 端末や貼り替えの都合で次のような揺れが起こり得ます。
     *   ・前後に空白や改行が入る
     *   ・小文字で読める（dc4-0737）
     *   ・全角文字になっている（ＤＣ４－０７３７）
     *   ・将来QRをURL化したときの "https://.../v/DC4-0737"
     * これらをすべて "DC4-0737" に正規化します。
     * ---------------------------------------------------------------------- */
    normalizeVehicleId(raw) {
      if (raw == null) return '';
      let s = String(raw).trim();

      // URL形式だった場合は最後の区切り以降を取り出す
      if (/^https?:\/\//i.test(s)) {
        try {
          const u = new URL(s);
          const fromQuery = u.searchParams.get('id') || u.searchParams.get('v');
          s = fromQuery || u.pathname.split('/').filter(Boolean).pop() || s;
          s = decodeURIComponent(s);
        } catch (e) { /* URLとして解釈できなければそのまま扱う */ }
      }

      // 全角英数字を半角へ
      s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

      // ハイフンに見える文字をすべて半角ハイフンに統一する。
      //   －(全角) −(マイナス) ‐‑‒–—―(各種ダッシュ) ー(長音) ｰ(半角長音)
      s = s.replace(/[－−‐‑‒–—―ーｰ⁃]/g, '-');

      // 空白・制御文字を除去し、大文字に統一
      s = s.replace(/[\s　]/g, '').toUpperCase();

      return s;
    },

    /** 車両IDの形になっているか（DC4-0737 / K1BOX-0114 など） */
    looksLikeVehicleId(s) {
      return /^[A-Z0-9]{1,8}-\d{3,5}$/.test(s);
    },

    /** 「DC4-0737」→「DC4」 */
    prefixOf(vehicleId) {
      const m = /^([A-Z0-9]+)-\d+$/.exec(vehicleId || '');
      return m ? m[1] : '';
    },

    /** 2026-08-24T13:05:00+09:00 のようなローカル時刻のISO文字列 */
    nowIso() {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      const off = -d.getTimezoneOffset();
      const sign = off >= 0 ? '+' : '-';
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
             `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
             `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
    },

    /** 表示用の日時（2026/08/24 13:05） */
    formatDateTime(iso) {
      if (!iso) return '―';
      const d = new Date(iso);
      if (isNaN(d)) return String(iso);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },

    /** 点検記録のID（例: 20260824-130500-DC4-0737） */
    makeInspectionId(vehicleId) {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
             `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${vehicleId}`;
    },


    /** 画面上部にメッセージを出す */
    toast(message, kind) {
      let el = document.getElementById('vis-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'vis-toast';
        document.body.appendChild(el);
      }
      el.className = 'toast ' + (kind || 'info') + ' show';
      el.textContent = message;
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('show'), 3500);
    },

    /** オンラインかどうか */
    isOnline() { return navigator.onLine !== false; },

    // ---------------------------------------------------------------- OCR版で追加

    /**
     * 管理番号の記号から「車種」と「点検区分」を引く（config/app-config.js の prefixes）。
     * 例）DC4-0754 → { prefix:'DC4', type:'4tダンプカー', cycle:'3month' }。表に無ければ null
     */
    prefixInfo(vehicleId) {
      const p = util.prefixOf(vehicleId);
      const map = (VIS.config && VIS.config.prefixes) || {};
      return p && map[p] ? Object.assign({ prefix: p }, map[p]) : null;
    },

    cycleLabel(cycle) { return cycle === '6month' ? '６ヶ月定期点検' : '３ヶ月定期点検'; },

    /** ファイル名用の日付（2026-10-14T… → 20261014） */
    ymdCompact(iso) { return String(iso || '').slice(0, 10).replace(/-/g, ''); },

    /** この端末に覚えておく入力値（点検担当者名・整備管理者名・点検営業所） */
    loadPrefs() {
      try { return JSON.parse(localStorage.getItem('vis-ocr-prefs') || '{}') || {}; } catch (e) { return {}; }
    },
    savePrefs(values) {
      try { localStorage.setItem('vis-ocr-prefs', JSON.stringify(Object.assign(util.loadPrefs(), values))); } catch (e) { /* 保存できない端末 */ }
    },

    /** 入力途中の内容（下書き）。電話などでブラウザが閉じても続きから入力できるように */
    loadDraft(vehicleId) {
      try { return JSON.parse(localStorage.getItem('vis-ocr-draft:' + vehicleId) || 'null'); } catch (e) { return null; }
    },
    saveDraft(vehicleId, draft) {
      try { localStorage.setItem('vis-ocr-draft:' + vehicleId, JSON.stringify(draft)); } catch (e) { /* 容量不足など */ }
    },
    clearDraft(vehicleId) {
      try { localStorage.removeItem('vis-ocr-draft:' + vehicleId); } catch (e) { /* ignore */ }
    }
  };

  VIS.util = util;

})(window);
