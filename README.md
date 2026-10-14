# 車両法定点検（OCR版）

車両のQRシール（管理番号）をスマートフォンで読み取り、車検証をカメラで撮って
自動車登録番号・車台番号を文字認識（OCR）で転記し、法定点検（3ヶ月／6ヶ月）の
定期点検整備記録簿PDF（A4一枚）を作る PWA です。

https://danzo42.github.io/vehicle-inspection-ocr/

- **このアプリには車両データ（車両マスタ）は入っていません。**
- 文字の読み取りはスマホの中だけで行い、撮影した画像はどこにも送信しません。
- 点検記録はそのスマホの中にだけ保存されます。外部に出るのは、利用者が共有・印刷したPDFだけです。
- 外部サーバーと通信できない設定（Content-Security-Policy）にしています。

同梱ライブラリ：Tesseract.js 5.1.1・tesseract.js-core 5.1.1・tessdata（Apache-2.0）、
html5-qrcode（Apache-2.0）、jsPDF（MIT）