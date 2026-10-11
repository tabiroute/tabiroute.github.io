/* 任意設定。各管理画面で発行された、ご自身の正式な広告URLだけを指定します。
   下の設定を既存 booking/config.js の末尾へ追記してください。
   この example ファイルはそのままでは読み込まれません。空欄なら通常リンクです。
   APIキー・アクセストークンをここへ記載しないでください。 */
window.TABIROUTE_AFFILIATES = {
  rakutenCarURL: '', // 楽天レンタカー専用リンク（https://hb.afl.rakuten.co.jp/...）
  jalanCarURL: '',   // 提携後のじゃらんレンタカー広告（https://ck.jp.ap.valuecommerce.com/...）
  // ホットペッパーグルメ（バリューコマース）：管理画面で作ったテキスト広告のリンクをそのまま貼る。
  // 例: 'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3783426&pid=000000000'
  // 貼ると、画面に出るホットペッパーへのリンク（お店のページ・検索ページ）がすべて広告リンクになります。
  hotpepperLink: '',
  // 管理画面の「広告のリンク先URL」にある vos= の値（例: https://www.hotpepper.jp/?vos=afhpppvczzzzx00000003 の afhpppvczzzzx00000003）
  hotpepperVos: ''
};
