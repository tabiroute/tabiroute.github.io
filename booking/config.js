/* 公開してよい設定だけを書きます。APIキーは絶対に書かないでください。 */
window.TABIROUTE_BOOKING = {
  apiBase: "https://tabiroute-booking.tabirouteapp.workers.dev", // 例: https://tabiroute-booking.YOUR-SUBDOMAIN.workers.dev
  enabled: true
};
/* 掲載許可のある写真を、施設ID・店舗IDに結び付けて登録できます。
   exterior / dish と確認済みの写真だけ登録してください。未確認のAPI写真は店舗・施設写真として表示します。
   例: "rakuten:12345": {url:"https://あなたのサイト/img/hotel.jpg",kind:"exterior",credit:"写真提供：○○ホテル"}
   例: "hotpepper:J000000000": {url:"https://あなたのサイト/img/dish.jpg",kind:"dish",credit:"写真提供：○○店"}
   じゃらんの同一施設を確認できた場合: jalanUrl:"https://www.jalan.net/yad123456/"
*/
window.TABIROUTE_PLACE_MEDIA = {};

/* 任意設定。各管理画面で発行された、ご自身の正式な広告URLだけを指定します。
   下の設定を既存 booking/config.js の末尾へ追記してください。
   この example ファイルはそのままでは読み込まれません。空欄なら通常リンクです。
   APIキー・アクセストークンをここへ記載しないでください。 */
window.TABIROUTE_AFFILIATES = {
  rakutenCarURL: '', // 楽天レンタカー専用リンク（https://hb.afl.rakuten.co.jp/...）
  jalanCarURL: ''    // 提携後のじゃらんレンタカー広告（https://ck.jp.ap.valuecommerce.com/...）
};
