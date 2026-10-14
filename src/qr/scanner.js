/* =============================================================================
 * scanner.js  ―― QRコード読み取り（html5-qrcode のラッパー）
 * -----------------------------------------------------------------------------
 * 既存の車両キープレートに貼ってあるQRシールを、そのまま読みます。
 * QRの中身はURLではなく「DC4-0737」のような管理番号のプレーンテキストです。
 *
 * 読み取った文字列は util.normalizeVehicleId() で正規化してから返します。
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS;

  class QrScanner {

    /**
     * @param {string} elementId カメラ映像を表示する要素のid
     */
    constructor(elementId) {
      this.elementId = elementId;
      this.h5 = null;
      this.running = false;
    }

    /**
     * カメラを起動して読み取りを開始します。
     * @param {(vehicleId:string, rawText:string)=>void} onDecoded 読めたときに呼ばれる
     * @param {(err:Error)=>void} [onError]
     */
    async start(onDecoded, onError) {
      if (this.running) return;
      if (!global.Html5Qrcode) {
        throw new Error('html5-qrcode が読み込まれていません');
      }

      this.h5 = new global.Html5Qrcode(this.elementId, {
        // QRだけを対象にすると誤検出が減り、動作も速くなります
        formatsToSupport: [global.Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false
      });

      const config = {
        fps: 10,
        // 画面サイズに合わせた読み取り枠（小さいQRシールでも合わせやすい大きさ）
        qrbox: (vw, vh) => {
          const edge = Math.floor(Math.min(vw, vh) * 0.72);
          return { width: edge, height: edge };
        },
        aspectRatio: 1.0,
        // ピントを合わせやすくする
        experimentalFeatures: { useBarCodeDetectorIfSupported: true }
      };

      const handle = (decodedText) => {
        const id = VIS.util.normalizeVehicleId(decodedText);
        onDecoded(id, decodedText);
      };

      try {
        // 背面カメラを優先。指定が効かない端末では既定のカメラにフォールバック。
        await this.h5.start({ facingMode: { exact: 'environment' } }, config, handle, () => {});
      } catch (e) {
        await this.h5.start({ facingMode: 'environment' }, config, handle, () => {});
      }
      this.running = true;
    }

    async stop() {
      if (!this.h5 || !this.running) return;
      try { await this.h5.stop(); } catch (e) { /* 停止済み */ }
      try { this.h5.clear(); } catch (e) { /* ignore */ }
      this.running = false;
    }

    /**
     * 画像ファイル（写真やスクリーンショット）からQRを読む。
     * カメラが使えないPCでの動作確認にも使えます。
     * @param {File} file
     * @returns {Promise<{vehicleId:string, rawText:string}>}
     */
    static async decodeFile(file) {
      if (!global.Html5Qrcode) throw new Error('html5-qrcode が読み込まれていません');
      const tmpId = 'qr-file-tmp-' + Date.now();
      const div = document.createElement('div');
      div.id = tmpId;
      div.style.display = 'none';
      document.body.appendChild(div);
      const h5 = new global.Html5Qrcode(tmpId);
      try {
        const rawText = await h5.scanFile(file, false);
        return { vehicleId: VIS.util.normalizeVehicleId(rawText), rawText };
      } finally {
        try { h5.clear(); } catch (e) {}
        div.remove();
      }
    }
  }

  VIS.QrScanner = QrScanner;

})(window);
