/* =============================================================================
 * storageFactory.js  ―― 「どこに保存するか」を決める唯一の場所 ＋ 各画面の共通初期化
 * -----------------------------------------------------------------------------
 * 保存先を切り替えたいときは config/app-config.js の storage を変え、
 * 下の switch に1行足すだけです（画面側は変更不要）。
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS;

  async function createStorage() {
    let adapter;
    switch (VIS.config.storage) {
      case 'local':
        adapter = new VIS.LocalStorageAdapter();
        break;

      // ★将来、社内の保存先に送る場合はここに追加する
      // case 'sharepoint':
      //   adapter = new VIS.SharePointAdapter(global.SHAREPOINT_CONFIG); break;

      default:
        throw new Error(`未知の保存先です: ${VIS.config.storage}（config/app-config.js を確認してください）`);
    }
    await adapter.init();
    VIS.storage = adapter;
    return adapter;
  }

  /** 各画面の先頭で呼ぶ共通の初期化 */
  VIS.ready = function ready() {
    if (!VIS._readyPromise) {
      VIS._readyPromise = createStorage().then(() => VIS);
    }
    return VIS._readyPromise;
  };

  // オフラインでも開けるよう、Service Worker を登録する（https か localhost のときだけ動く）
  if ('serviceWorker' in navigator) {
    global.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW登録失敗', e));
    });
  }

})(window);