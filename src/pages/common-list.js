/* =============================================================================
 * common-list.js  ―― 点検記録の一覧（トップ画面・車両画面・記録簿画面で共通）
 * ========================================================================== */
(function (global) {
  'use strict';
  const VIS = global.VIS, util = VIS.util;

  /** 点検記録の配列から <li> の並びを作る（新しい順に並べたものを渡す） */
  VIS.recordListHtml = function recordListHtml(rows) {
    return rows.map(r => {
      const overall = (r.summary && r.summary.overall) || '';
      return `
        <li><a href="view.html?rid=${encodeURIComponent(r.inspectionId)}">
          <div class="rec-main">
            <div class="rec-id">${util.esc(r.vehicleId)}</div>
            <div class="rec-sub">${util.esc(util.formatDateTime(r.inspectedAt))}　${util.esc(r.plateNumber || '')}　${util.esc(r.inspectorName || '')}</div>
          </div>
          <span class="rec-tag${overall === '良好' ? '' : ' ng'}">${util.esc(overall)}</span>
          <span class="chev" aria-hidden="true">&#8250;</span>
        </a></li>`;
    }).join('');
  };
})(window);