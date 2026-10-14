/* =============================================================================
 * pdfGenerator.js  ―― 点検記録PDFの生成（紙の記録簿と同じ書式・A4一枚）
 * -----------------------------------------------------------------------------
 * 「車両法定点検実施要綱 20150525改訂.xls」の ３ヶ月／６ヶ月 定期点検整備記録簿を
 * そのまま再現し、点検結果を書き込んだ状態でA4一枚のPDFにします。
 *
 *   ・左上に会社ロゴ（YDEC）、記録簿名、対象車種（該当する車種を○で囲む）
 *   ・点検日／車検満了日／前回点検日、各走行距離、点検営業所、整備管理者、YDEC№
 *   ・自動車登録番号／車台番号／車種、車検証・三角停止板の有無（○で囲む）
 *   ・点検項目は紙と同じ左右2列。省略できない項目は「太字＋下線＋黄色の□」
 *   ・□の中に判定記号（レ△×○ＡＴＣＬ）を記入。該当なしは「／」、省略した項目は空欄
 *   ・凡例の下に、紙には無い「点検者・実施した整備・所見」欄を追加（電子記録として必要なため）
 *
 * ※ 02の点検アプリと同じファイルです（OCR版でも書式は同じ）。
 *   違いは渡す vehicle の中身だけで、OCR版では
 *     vehicleId（＝QRの管理番号）・plateNumber / chassisNo（＝OCRで読んだ値）・vehicleType
 *   を入力画面から作って渡しています。

 * ■ なぜCanvasに描いてからPDFにするのか
 *   jsPDFの標準フォントは日本語を持っていません。日本語フォントを埋め込むと
 *   ファイルが数MB大きくなり、オフライン配信にも不利です。そこで
 *   「ブラウザの日本語フォントでCanvasに描画 → 画像としてPDFに貼る」方式にしています。
 *
 * ■ 位置の調整
 *   座標はすべて mm 単位です（A4 = 幅210mm × 高さ297mm、左右余白10mm）。
 *   紙の記録簿とずれる場合は、下の各 draw〜 関数の数字を直してください。
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS;

  // A4縦を200dpi相当で描く（印刷しても文字がにじまない解像度）
  const DPI    = 200;
  const MM     = DPI / 25.4;          // 1mm あたりのピクセル数
  const PT     = DPI / 72;            // 1pt（文字サイズ）あたりのピクセル数
  const PAGE_W = Math.round(210 * MM);
  const PAGE_H = Math.round(297 * MM);

  const L = 10;                       // 左端（mm）
  const R = 200;                      // 右端（mm）
  const BOTTOM = 287;                 // 下端（mm）

  // 点検項目の2列（紙の記録簿の位置に合わせてある）
  const COL_LEFT  = { x0: L,     x1: 103.9 };
  const COL_RIGHT = { x0: 106.6, x1: R };
  const CHECK_W   = 5.7;              // □の列の幅
  const LIST_TOP  = 83.5;             // 点検項目の開始位置
  const LIST_MAX_BOTTOM = 259;        // 点検項目の最下端（この下に凡例・特記事項）

  const YELLOW = '#ffff99';           // 省略できない項目の□の色（紙と同じ黄色）
  const RED    = '#c00000';           // 「良好」以外の判定記号の色
  const FAMILY = '"MS PGothic","ＭＳ Ｐゴシック","Yu Gothic UI","Yu Gothic","Hiragino Sans","Noto Sans JP","Meiryo",sans-serif';

  // ---------------------------------------------------------------------------
  //  描画の道具（mm単位で指定できるようにしたもの）
  // ---------------------------------------------------------------------------
  function createPainter(ctx) {

    function setFont(sizePt, bold) {
      ctx.font = `${bold ? 'bold ' : ''}${(sizePt * PT).toFixed(1)}px ${FAMILY}`;
    }

    return {
      /** 直線。dash を渡すと点線（例: [0.4, 0.4]） */
      line(x1, y1, x2, y2, widthMm, dash) {
        ctx.save();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = (widthMm || 0.2) * MM;
        if (dash) ctx.setLineDash(dash.map(v => v * MM));
        ctx.beginPath();
        ctx.moveTo(x1 * MM, y1 * MM);
        ctx.lineTo(x2 * MM, y2 * MM);
        ctx.stroke();
        ctx.restore();
      },

      /** 四角形。fill を渡すと塗りつぶし */
      rect(x, y, w, h, widthMm, fill) {
        ctx.save();
        if (fill) { ctx.fillStyle = fill; ctx.fillRect(x * MM, y * MM, w * MM, h * MM); }
        ctx.strokeStyle = '#000';
        ctx.lineWidth = (widthMm || 0.2) * MM;
        ctx.strokeRect(x * MM, y * MM, w * MM, h * MM);
        ctx.restore();
      },

      /** 楕円（「有・無」を○で囲む用） */
      ellipse(cx, cy, rx, ry, widthMm) {
        ctx.save();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = (widthMm || 0.3) * MM;
        ctx.beginPath();
        ctx.ellipse(cx * MM, cy * MM, rx * MM, ry * MM, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      },

      /**
       * 文字。y は文字の上下中央の位置。
       * opt: size(pt) / bold / align('left'|'center'|'right') / color / underline
       *      fit(mm)      … この幅に収まるよう文字を小さくする（最小70%）
       *      maxWidth(mm) … この幅を超えたら末尾を「…」にする
       */
      text(str, x, y, opt) {
        opt = opt || {};
        let s = String(str == null ? '' : str);
        if (!s) return 0;
        let size = opt.size || 10;
        setFont(size, opt.bold);

        if (opt.fit) {
          const limit = opt.fit * MM;
          while (ctx.measureText(s).width > limit && size > (opt.size || 10) * 0.7) {
            size -= 0.25;
            setFont(size, opt.bold);
          }
        }
        if (opt.maxWidth && ctx.measureText(s).width > opt.maxWidth * MM) {
          while (s.length > 1 && ctx.measureText(s + '…').width > opt.maxWidth * MM) s = s.slice(0, -1);
          s += '…';
        }

        const w = ctx.measureText(s).width;
        let px = x * MM;
        if (opt.align === 'center') px -= w / 2;
        else if (opt.align === 'right') px -= w;

        ctx.save();
        ctx.fillStyle = opt.color || '#000';
        ctx.textBaseline = 'middle';
        ctx.fillText(s, px, y * MM);
        if (opt.underline) {
          ctx.strokeStyle = opt.color || '#000';
          ctx.lineWidth = Math.max(1, size * PT * 0.07);
          const uy = y * MM + size * PT * 0.5;
          ctx.beginPath(); ctx.moveTo(px, uy); ctx.lineTo(px + w, uy); ctx.stroke();
        }
        ctx.restore();
        return w / MM;
      },

      /**
       * 複数の文字片を1行に並べて描き、各片の左端・右端の位置（mm）を返す。
       * 「対象車種」のように、行の中の特定の語を○で囲むときに使う。
       * fit(mm) を渡すと、行全体がその幅に収まるよう文字を小さくする（最小70%）。
       */
      runs(parts, x, y, opt) {
        opt = opt || {};
        const base = opt.size || 10;
        let size = base;
        setFont(size, false);
        if (opt.fit) {
          const limit = opt.fit * MM;
          while (ctx.measureText(parts.join('')).width > limit && size > base * 0.7) {
            size -= 0.25;
            setFont(size, false);
          }
        }
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'middle';
        let cur = x * MM;
        const pos = parts.map(s => {
          const w = ctx.measureText(s).width;
          ctx.fillText(s, cur, y * MM);
          const r = { x0: cur / MM, x1: (cur + w) / MM };
          cur += w;
          return r;
        });
        ctx.restore();
        return pos;
      },

      /** 指定幅で折り返した行の配列を返す（日本語は1文字単位で折り返す） */
      wrap(str, widthMm, sizePt) {
        setFont(sizePt, false);
        const limit = widthMm * MM;
        const lines = [];
        String(str || '').split('\n').forEach(para => {
          let cur = '';
          for (const ch of para) {
            if (ctx.measureText(cur + ch).width > limit && cur) { lines.push(cur); cur = ch; }
            else cur += ch;
          }
          lines.push(cur);
        });
        return lines;
      }
    };
  }

  /** "2026-10-13" や ISO日時 を {y, m, d} に分ける（タイムゾーンでずれないよう文字列で処理） */
  function splitDate(v) {
    if (!v) return null;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v));
    if (m) return { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) };
    const dt = new Date(v);
    if (isNaN(dt)) return null;
    return { y: String(dt.getFullYear()), m: String(dt.getMonth() + 1), d: String(dt.getDate()) };
  }

  function formatKm(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    return isNaN(n) ? String(v) : n.toLocaleString('ja-JP');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (!src) { reject(new Error('no image')); return; }
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ---------------------------------------------------------------------------
  //  ① 見出し（ロゴ・記録簿名・対象車種）
  // ---------------------------------------------------------------------------
  function drawHeader(p, ctx, spec, logo, targetId) {
    const y = 14, h = 12;

    // ロゴ＋記録簿名（太枠）
    p.rect(L, y, 64.5, h, 0.55);
    let titleX = L + 2;
    if (logo) {
      const lh = 7.6;
      const lw = lh * logo.width / logo.height;
      ctx.drawImage(logo, (L + 1.4) * MM, (y + (h - lh) / 2) * MM, lw * MM, lh * MM);
      titleX = L + 1.4 + lw + 1.2;
    }
    p.text(spec.formTitle || spec.title, titleX, y + h / 2, { size: 10.5, fit: L + 64.5 - titleX - 1 });

    // 対象車種
    p.rect(74.5, y, 24, h, 0.25);
    p.text('対象車種', 86.5, y + h / 2, { size: 10.5, align: 'center' });
    p.rect(98.5, y, R - 98.5, h, 0.25);
    const lines = spec.targets || [[spec.targetNote || '']];
    lines.forEach((line, i, arr) => {
      const ly = arr.length === 1 ? y + h / 2 : y + 3.2 + i * 5.6;
      const parts = line.map(seg => (typeof seg === 'string' ? seg : seg.text));
      // ○が枠線にかからないよう、左に少し余白をとって書き始める
      const pos = p.runs(parts, 101.8, ly, { size: 9.5, fit: R - 101.8 - 1.5 });
      // 該当する車種を○で囲む（車検証・三角停止板の「有・無」と同じ）
      line.forEach((seg, k) => {
        if (seg && typeof seg === 'object' && seg.id === targetId) {
          const cx = (pos[k].x0 + pos[k].x1) / 2;
          const rx = (pos[k].x1 - pos[k].x0) / 2 + 1.1;
          p.ellipse(cx, ly, rx, 2.5);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  //  ② 点検日・走行距離・営業所・整備管理者・YDEC№
  // ---------------------------------------------------------------------------
  function drawDateRows(p, record, vehicle) {
    const rows = [
      { y: 37, label: '点検日',     date: record.inspectedAt,            kmLabel: '点検時走行距離',     km: record.odometer,
        rightLabel: '点検営業所', rightValue: record.branch || vehicle.branch },
      { y: 48, label: '車検満了日', date: record.shakenExpiry,           kmLabel: '車検時走行距離',     km: record.shakenOdometer,
        rightLabel: '整備管理者', rightValue: record.supervisorName },
      { y: 59, label: '前回点検日', date: record.previousInspectionDate, kmLabel: '前回点検時走行距離', km: record.previousOdometer,
        small: true, ydec: true }
    ];

    rows.forEach(r => {
      const under = r.y + 2.4;   // 下線の位置

      // 日付（年・月・日）
      p.text(r.label, 19.5, r.y, { size: 10.5, align: 'center' });
      p.line(28.5, under, 86, under, 0.2);
      p.text('年', 46.8, r.y, { size: 10.5, align: 'center' });
      p.text('月', 65.5, r.y, { size: 10.5, align: 'center' });
      p.text('日', 83.3, r.y, { size: 10.5, align: 'center' });
      const d = splitDate(r.date);
      if (d) {
        p.text(d.y, 44.2, r.y, { size: 11, align: 'right' });
        p.text(d.m, 63,   r.y, { size: 11, align: 'right' });
        p.text(d.d, 80.8, r.y, { size: 11, align: 'right' });
      }

      // 走行距離
      p.text(r.kmLabel, 92.5, r.y, { size: r.small ? 8.5 : 10.5, fit: 29.5 });
      p.line(123, under, 141.6, under, 0.2);
      p.text('km', 142.6, r.y, { size: 10 });
      p.text(formatKm(r.km), 140.8, r.y, { size: 11, align: 'right' });

      // 右側（点検営業所・整備管理者）
      if (r.rightLabel) {
        p.text(r.rightLabel, 154, r.y, { size: 10.5 });
        p.line(176, under, R, under, 0.2);
        p.text(r.rightValue || '', 188, r.y, { size: 10.5, align: 'center', fit: 23 });
      }

      // YDEC№（社内の管理番号 ＝ QRコードの中身）
      if (r.ydec) {
        const top = r.y - 4.6, h = 9.4;
        p.rect(152.5, top, R - 152.5, h, 0.25);
        p.line(170.8, top, 170.8, top + h, 0.25);
        p.text('YDEC№', 161.6, r.y, { size: 10, align: 'center' });
        p.text(vehicle.vehicleId, 185.4, r.y, { size: 11, bold: true, align: 'center', fit: 28 });
      }
    });
  }

  // ---------------------------------------------------------------------------
  //  ③ 自動車登録番号・車台番号・車種 ／ 車検証・三角停止板
  // ---------------------------------------------------------------------------
  function drawVehicleRow(p, record, vehicle) {
    const y = 65.5, h = 9.2, cy = y + h / 2;
    const xs = [L, 39.3, 75.3, 98.2, 135.2, 153, R];
    p.rect(L, y, R - L, h, 0.25);
    xs.slice(1, -1).forEach(x => p.line(x, y, x, y + h, 0.25));

    p.text('自動車登録番号', (xs[0] + xs[1]) / 2, cy, { size: 10, align: 'center', fit: 28 });
    p.text(vehicle.plateNumber || '', (xs[1] + xs[2]) / 2, cy, { size: 10.5, align: 'center', fit: 34 });
    p.text('車台番号', (xs[2] + xs[3]) / 2, cy, { size: 10, align: 'center' });
    p.text(vehicle.chassisNo || '', (xs[3] + xs[4]) / 2, cy, { size: 10.5, align: 'center', fit: 35 });
    p.text('車種', (xs[4] + xs[5]) / 2, cy, { size: 10, align: 'center' });
    p.text(vehicle.vehicleType || '', (xs[5] + xs[6]) / 2, cy, { size: 10.5, align: 'center', fit: 45 });

    // 有・無（選んだ方を○で囲む）
    const pre = record.preChecks || {};
    const py = 77, ph = 4.6, pcy = py + ph / 2;
    const presence = (x0, x1, x2, label, value) => {
      p.rect(x0, py, x1 - x0, ph, 0.25);
      p.rect(x1, py, x2 - x1, ph, 0.25);
      p.text(label, (x0 + x1) / 2, pcy, { size: 10, align: 'center' });
      const cx = (x1 + x2) / 2;
      p.text('有', cx - 6, pcy, { size: 10, align: 'center' });
      p.text('・', cx,     pcy, { size: 10, align: 'center' });
      p.text('無', cx + 6, pcy, { size: 10, align: 'center' });
      if (value === '有') p.ellipse(cx - 6, pcy, 2.6, 2.2);
      if (value === '無') p.ellipse(cx + 6, pcy, 2.6, 2.2);
    };
    presence(45.7, 74.9, 103.9, '車検証',     pre.shakensho  && pre.shakensho.value);
    presence(141.6, 171.2, R,   '三角停止板', pre.sankakuita && pre.sankakuita.value);
  }

  // ---------------------------------------------------------------------------
  //  ④ 点検項目（左右2列）
  // ---------------------------------------------------------------------------

  /** 定義から、指定した列に描く行（大分類・中分類・項目）を並べる */
  function buildRows(spec, column) {
    const rows = [];
    spec.groups.filter(g => (g.column || 'left') === column).forEach(g => {
      rows.push({ kind: 'group', text: g.name });
      g.units.forEach(u => {
        if (u.name) rows.push({ kind: 'unit', text: u.name });
        u.items.forEach(it => rows.push({ kind: 'item', item: it }));
      });
    });
    return rows;
  }

  function drawColumn(p, rows, col, top, rowH, fontPt, resultMap) {
    const checkX = col.x1 - CHECK_W;
    const box = Math.min(rowH * 0.78, 3.6);
    let y = top;

    rows.forEach((row, i) => {
      const cy = y + rowH / 2;

      if (row.kind === 'group') {
        if (i > 0) p.line(col.x0, y, col.x1, y, 0.25);
        p.text(row.text, col.x0 + 1.2, cy, { size: fontPt, fit: col.x1 - col.x0 - 3 });
      } else {
        // □の列との区切り（点線）
        p.line(checkX, y, checkX, y + rowH, 0.15, [0.35, 0.35]);

        if (row.kind === 'unit') {
          p.text(row.text, col.x0 + 4.5, cy, { size: fontPt, fit: checkX - col.x0 - 6 });
        } else {
          const it = row.item;
          const required = !it.optional;
          p.text(it.label, col.x0 + 9, cy, {
            size: fontPt, bold: required, underline: required, fit: checkX - col.x0 - 10.5
          });

          // □（省略できない項目は黄色）と判定記号
          const bx = checkX + (CHECK_W - box) / 2;
          p.rect(bx, cy - box / 2, box, box, 0.2, required ? YELLOW : null);
          const r = resultMap[it.id];
          if (r && r.mark) {
            p.text(r.mark, bx + box / 2, cy, {
              size: Math.min(fontPt + 0.5, 11), bold: true, align: 'center',
              color: (r.code === 'OK' || r.code === 'NA') ? '#000' : RED   // 該当なし（／）は黒
            });
          }
        }
      }
      y += rowH;
    });

    p.rect(col.x0, top, col.x1 - col.x0, y - top, 0.3);   // 外枠
    return y;
  }

  function drawChecklist(p, spec, record) {
    const resultMap = {};
    (record.results || []).forEach(r => { resultMap[r.itemId] = r; });

    const left  = buildRows(spec, 'left');
    const right = buildRows(spec, 'right');
    const noteLines = spec.omitNoteLines || [];

    // 右列の下に「注意」書きを置く分も含めて、行の高さを決める
    const needRows = Math.max(left.length, right.length + 1 + noteLines.length);
    const rowH   = Math.min(6.5, (LIST_MAX_BOTTOM - LIST_TOP) / needRows);
    // 文字は行の高さに合わせる（下線が次の区切り線に重ならない大きさ）
    const fontPt = Math.max(8.5, Math.min(11, rowH * 2.3));

    const leftEnd  = drawColumn(p, left,  COL_LEFT,  LIST_TOP, rowH, fontPt, resultMap);
    const rightEnd = drawColumn(p, right, COL_RIGHT, LIST_TOP, rowH, fontPt, resultMap);

    // 注意書き（省略できる条件）
    const noteSize = Math.min(fontPt, 9.8);
    const lineH = Math.max(rowH, 4.2);
    let ny = rightEnd + rowH + lineH / 2;
    noteLines.forEach((t, i) => {
      if (i === 0) p.text('注意', COL_RIGHT.x0 + 1.5, ny, { size: noteSize });
      p.text(t, COL_RIGHT.x0 + 11, ny, { size: noteSize, fit: COL_RIGHT.x1 - COL_RIGHT.x0 - 12 });
      ny += lineH;
    });

    return Math.max(leftEnd, rightEnd, ny - lineH / 2);
  }

  // ---------------------------------------------------------------------------
  //  ⑤ 判定記号の凡例
  // ---------------------------------------------------------------------------
  function drawLegend(p, def, y) {
    const codes = def.judgementCodes.filter(c => c.type !== 'skip');
    const half = Math.floor(codes.length / 2);   // 左に4つ（レ△×○）、右に残り（ＡＴＣＬ／）
    const h = 5;
    [[codes.slice(0, half), COL_LEFT], [codes.slice(half), COL_RIGHT]].forEach(([list, col]) => {
      const w = (col.x1 - col.x0) / list.length;
      list.forEach((c, i) => {
        const x = col.x0 + i * w;
        p.rect(x, y, w, h, 0.25);
        p.text(c.mark, x + 2.4, y + h / 2, { size: 9.5, align: 'center' });
        p.line(x + 4.8, y, x + 4.8, y + h, 0.2);
        p.text(c.label, x + w - 1.8, y + h / 2, { size: 9.5, align: 'right' });
      });
    });
    return y + h;
  }

  // ---------------------------------------------------------------------------
  //  ⑥ 点検者・特記事項（紙には無い欄。電子記録として残すために追加）
  // ---------------------------------------------------------------------------
  function drawRemarks(p, record, y) {
    const h = BOTTOM - y;
    if (h < 8) return;

    const labelW = 17;
    p.rect(L, y, R - L, h, 0.25);
    p.line(L + labelW, y, L + labelW, y + h, 0.25);
    p.text('点検者', L + labelW / 2, y + 3.4, { size: 9, align: 'center' });
    p.text('特記事項', L + labelW / 2, y + 7.6, { size: 9, align: 'center' });

    const s = record.summary || {};
    const textX = L + labelW + 1.8;
    const textW = R - textX - 1.5;
    const size  = 8.8;
    const lineH = 3.7;

    const parts = [];
    parts.push(`点検者：${record.inspectorName || ''}　　記録日時：${VIS.util.formatDateTime(record.inspectedAt)}` +
               `　　総合判定：${s.overall || ''}${s.actionCount ? `（整備実施 ${s.actionCount} 件）` : ''}`);

    const actions = (record.results || []).filter(r => r.code && !['OK', 'SKIP', 'NA'].includes(r.code));
    if (actions.length) {
      parts.push('実施した整備：' + actions.map(a =>
        `${a.unitName ? a.unitName + '／' : ''}${a.label} ${a.mark}${a.judgement}`
      ).join('　'));
    }
    if (record.remarks) parts.push('所見：' + record.remarks);

    // 枠に収まる行数だけ描く（はみ出す分は「…」で省略）
    const maxLines = Math.max(1, Math.floor((h - 4) / lineH));
    let lines = [];
    parts.forEach(t => { lines = lines.concat(p.wrap(t, textW, size)); });
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
    }
    lines.forEach((t, i) => p.text(t, textX, y + 2.6 + i * lineH, { size }));

    // 記録ID（電子記録の照合用）
    p.text(`記録ID：${record.inspectionId}　${VIS.config.appName || '車両法定点検アプリ'}で作成`, R - 1.5, y + h - 1.8,
           { size: 6.5, align: 'right', color: '#666' });
  }

  // ---------------------------------------------------------------------------
  //  公開する関数
  // ---------------------------------------------------------------------------

  /**
   * 記録簿1ページ分をCanvasに描いて返す（画面でのプレビューにも使えます）。
   * @returns {Promise<HTMLCanvasElement>}
   */
  async function renderPage(record, vehicle, def) {
    const spec = def.cycles[record.inspectionCycle] || def.cycles['3month'];

    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);

    const company = VIS.config.company || {};
    const logo = await loadImage(company.logoUrl).catch(() => null);

    const p = createPainter(ctx);
    let targetId = record.target && record.target.id;
    if (!targetId && VIS.form && VIS.form.guessTarget) {
      const guessed = VIS.form.guessTarget(spec, record.vehicleId || vehicle.vehicleId);
      targetId = guessed && guessed.id;
    }
    drawHeader(p, ctx, spec, logo, targetId);
    drawDateRows(p, record, vehicle);
    drawVehicleRow(p, record, vehicle);
    const listBottom   = drawChecklist(p, spec, record);
    const legendBottom = drawLegend(p, def, listBottom + 2.5);
    drawRemarks(p, record, legendBottom + 3);
    return canvas;
  }

  /**
   * 点検記録PDF（A4一枚）を作る。
   * @param {Object} record  保存する点検記録
   * @param {Object} vehicle 車両マスタ情報
   * @param {Object} def     点検項目定義
   * @returns {Promise<Blob>}
   */
  async function generate(record, vehicle, def) {
    const canvas = await renderPage(record, vehicle, def);
    const spec = def.cycles[record.inspectionCycle] || {};

    const { jsPDF } = global.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    pdf.setProperties({
      title:   `${spec.formTitle || spec.title || '定期点検整備記録簿'} ${record.vehicleId}`,
      subject: '定期点検整備記録簿',
      creator: VIS.config.appName || '車両法定点検アプリ'
    });
    // JPEG（高画質 0.92）で貼る。PNGより約10倍速く、スマホでも待ち時間が短い。
    // （PNGはjsPDFがJavaScriptで再圧縮するため、スマホでは数秒かかる）
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);

    // iPhoneはCanvasに使えるメモリの上限が小さいので、使い終わったら解放する
    canvas.width = 0;
    canvas.height = 0;

    return pdf.output('blob');
  }

  VIS.pdf = { generate, renderPage };

})(window);