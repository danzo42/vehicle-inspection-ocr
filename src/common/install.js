/* =============================================================================
 * install.js  ―― 「アプリとしてインストール」の案内
 * -----------------------------------------------------------------------------
 * ホーム画面に追加すると、アプリのように1タップで開け、全画面で使えます。
 *
 *   Android（Chrome）・パソコン（Chrome / Edge）
 *     … ブラウザが「インストールできます」と知らせてくれる（beforeinstallprompt）。
 *       その合図を受け取っておき、ボタンを押したら標準のインストール画面を出す。
 *   iPhone / iPad
 *     … ボタンでのインストールはできない仕組みなので、
 *       「共有ボタン →『ホーム画面に追加』」の手順を図で案内する。
 *   すでにアプリとして開いているとき … 案内は出さない。
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS = global.VIS || {};
  const DISMISS_KEY = 'vis-ocr-install-dismissed';
  let deferred = null;          // ブラウザから受け取ったインストールの合図
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });

  global.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();         // ブラウザ任せの表示はやめ、こちらのボタンから出す
    deferred = e;
    notify();
  });
  global.addEventListener('appinstalled', () => {
    deferred = null;
    if (VIS.util) VIS.util.toast('アプリとしてインストールしました。ホーム画面から開けます', 'ok');
    notify();
  });

  /** アプリとして（ホーム画面から）開いているか */
  function isStandalone() {
    return (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
           global.navigator.standalone === true;
  }

  /** 'ios' | 'android' | 'desktop' */
  function platform() {
    const ua = global.navigator.userAgent || '';
    const iPadOS = global.navigator.platform === 'MacIntel' && global.navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }

  function state() {
    const ua = global.navigator.userAgent || '';
    return {
      standalone: isStandalone(),
      canPrompt: !!deferred,
      platform: platform(),
      iosOtherBrowser: /CriOS|FxiOS|EdgiOS/.test(ua)    // iPhoneのChromeなど（Safariの方が確実）
    };
  }

  /** インストール画面を出す。'accepted' | 'dismissed' | 'unavailable' */
  async function prompt() {
    if (!deferred) return 'unavailable';
    const ev = deferred;
    deferred = null;
    ev.prompt();
    let outcome = 'dismissed';
    try { outcome = (await ev.userChoice).outcome; } catch (e) { /* ignore */ }
    notify();
    return outcome;
  }

  const ICON_SHARE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="vertical-align:-4px"><path fill="currentColor" d="M12 2 7.5 6.5l1.4 1.4L11 5.8V15h2V5.8l2.1 2.1 1.4-1.4L12 2zM5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10h-3v2h1v8H7v-8h1v-2H5z"/></svg>';
  const ICON_ADD = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="vertical-align:-4px"><path fill="currentColor" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h14V5H5zm6 2h2v4h4v2h-4v4h-2v-4H7v-2h4V7z"/></svg>';

  /**
   * 案内を描く。
   * @param {HTMLElement} box 描く場所
   * @param {{dismissible?:boolean, showInstalled?:boolean}} opts
   *   dismissible   … 「今は表示しない」を付ける（トップ画面用）
   *   showInstalled … アプリとして開いているときも「インストール済み」と表示する（設定画面用）
   */
  function render(box, opts) {
    opts = opts || {};
    const draw = () => {
      const st = state();
      let dismissed = false;
      try { dismissed = opts.dismissible && localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { /* ignore */ }

      if (st.standalone) {
        box.hidden = !opts.showInstalled;
        box.innerHTML = opts.showInstalled
          ? '<h2>アプリとして使う</h2><p class="small" style="margin:0">インストール済みです（アプリとして開いています）。</p>' : '';
        return;
      }
      if (dismissed) { box.hidden = true; return; }

      let body = '';
      if (st.canPrompt) {
        body = `
          <p class="small muted">ホーム画面から1タップで開けるようになり、電波の無い所でも使えます。</p>
          <button type="button" class="btn" data-install>アプリとしてインストール</button>`;
      } else if (st.platform === 'ios') {
        body = `
          <p class="small muted">ホーム画面に追加すると、アプリのように1タップで開けます。</p>
          <ol class="install-steps">
            <li>画面${/iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && navigator.platform === 'MacIntel' ? '上' : '下'}の <b>共有ボタン</b> ${ICON_SHARE} を押す
              <span class="muted">（見当たらないときは「…」を押すと出てきます）</span></li>
            <li>メニューを下へずらして <b>「ホーム画面に追加」</b> ${ICON_ADD} を押す</li>
            <li>右上の <b>「追加」</b> を押す</li>
          </ol>
          ${st.iosOtherBrowser ? '<p class="small" style="margin:6px 0 0">うまくいかないときは、このページを <b>Safari</b> で開いてから行ってください。</p>' : ''}
          <p class="small muted" style="margin:8px 0 0">※ iPhoneでは、ホーム画面のアプリとSafariとで記録が別々に保存されます。
            点検はホーム画面のアプリで行ってください（設定 →「今すぐ準備する」もアプリで1回）。</p>`;
      } else if (st.platform === 'android') {
        body = `
          <p class="small muted">ホーム画面から1タップで開けるようになり、電波の無い所でも使えます。</p>
          <ol class="install-steps">
            <li>右上の <b>メニュー（︙）</b> を押す</li>
            <li><b>「アプリをインストール」</b>（または「ホーム画面に追加」）を押す</li>
          </ol>`;
      } else {
        body = `
          <p class="small muted">パソコンでも、アプリとして別の窓で開けます。</p>
          <ol class="install-steps">
            <li>アドレスバーの右にある <b>インストール</b> のマーク、またはメニューを押す</li>
            <li><b>「アプリをインストール」</b> を押す</li>
          </ol>`;
      }
      box.hidden = false;
      box.innerHTML = `<h2>アプリとしてインストール</h2>${body}
        ${opts.dismissible ? '<button type="button" class="link-btn" data-install-dismiss style="margin-top:6px">今は表示しない</button>' : ''}`;
    };

    box.addEventListener('click', async e => {
      if (e.target.closest('[data-install]')) {
        const outcome = await prompt();
        if (outcome === 'unavailable' && VIS.util) VIS.util.toast('このブラウザのメニューから「アプリをインストール」を選んでください', 'warn');
        draw();
      } else if (e.target.closest('[data-install-dismiss]')) {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch (err) { /* ignore */ }
        box.hidden = true;
      }
    });
    listeners.add(draw);
    if (global.matchMedia) {
      const mq = global.matchMedia('(display-mode: standalone)');
      if (mq.addEventListener) mq.addEventListener('change', draw);
    }
    draw();
  }

  VIS.install = { state, prompt, render, isStandalone, platform };

})(window);