# たびルート　無料で公開する手順

このフォルダの中身をそのままアップロードすると、たびルートをインターネットに公開できます。
**費用は0円です。** クレジットカードの登録も不要です。

| 使うもの | 役割 | 料金 |
|---|---|---|
| GitHub Pages | サイトを公開する場所 | 無料 |
| Firebase（Sparkプラン） | ログイン・友達との共有 | 無料（カード登録なし） |
| 地図・場所・写真・路線のデータ | 国土地理院、OpenStreetMap、Wikipedia など | 無料・登録不要 |

## フォルダの中身

| ファイル | 内容 |
|---|---|
| `index.html` | アプリ本体 |
| `privacy.html` | プライバシーポリシー（運営者名・連絡先を書き換える） |
| `og.png` | LINEなどで送ったときに表示されるプレビュー画像 |
| `img/` | トップページで使う写真（出発・電車・観光・昼食・ホテル） |
| `manifest.webmanifest`・`icons/` | スマホの「ホーム画面に追加」用のアイコン |
| `firestore.rules` | Firebaseのデータを守るルール |
| `firebase.json` | Firebase Hostingで公開する場合の設定（使わなければ無視してOK） |
| `.nojekyll` | GitHub Pages用の設定ファイル（そのままアップロード） |
| `sitemap.xml` | 検索エンジンに登録するためのページ一覧 |

---

## 手順1：まずは共有なしで公開する（約10分）

URLは **`https://tabiroute.github.io/`** です。自分のユーザー名が入らないように、無料の「組織（Organization）」を作って、その中に公開します。

### 1-1. 組織を作る（無料）
1. GitHubにログインし、右上の自分のアイコン →「Your organizations」→「New organization」。
2. プランは **Free** の「Create a free organization」を選ぶ。
3. Organization name に **`tabiroute`** と入力（これがURLになります）。連絡先メールを入れ、「My personal account」を選んで次へ。
   - 「already taken」と出たら、その名前は使えません。`tabi-route` など別の名前にして、下の1-5を読んでください。
4. メンバーの招待画面は「Skip this step」で進めてOKです。

### 1-2. 公開用の置き場所（リポジトリ）を作る
1. 作った組織の画面で「Create a new repository」（または「Repositories」→「New repository」）。
2. Owner が **tabiroute**（組織）になっていることを確認。
3. Repository name に **`tabiroute.github.io`** と入力（組織名＋`.github.io` の形にするのが決まりです）。
4. **Public** を選び、「Create repository」。

### 1-3. ファイルをアップロードする
1. 作成した画面の「uploading an existing file」をクリック。
2. このフォルダの**中身すべて**（`index.html`、`icons` フォルダなど）をドラッグ＆ドロップ。
   - `.nojekyll` は見えないファイルです。Macは Finder で `Command + Shift + .` を押すと表示されます。アップロードできなくても動きます。
3. 下の「Commit changes」を押す。

### 1-4. 公開を確認する
1. リポジトリの「Settings」→ 左の「Pages」。
2. 「Branch」が `None` なら `main`・`/ (root)` を選んで「Save」。
3. 1〜2分待って **https://tabiroute.github.io/** を開き、アプリが表示されれば公開完了です。

以前作った `naru0116/tabiroute` のリポジトリは、Settings の一番下「Delete this repository」で削除してかまいません。残すと同じ内容のサイトが2つあることになり、検索で評価が分かれてしまいます。

### 1-5. URL（設定済み）
`index.html` と `sitemap.xml` には `https://tabiroute.github.io/` を書き込み済みです。
組織名を別の名前にした場合は、両方のファイルの中にある `https://tabiroute.github.io/` をすべて、`https://組織名.github.io/` に書き換えてください（GitHubの鉛筆マークで編集できます）。

### 1-6. プライバシーポリシーを書き換える
`privacy.html` の【運営者名】【連絡先】と制定日を書き換えます。ログイン機能を使う場合は必須です。

---

## 手順2：友達との共有・ログインを使えるようにする（約15分）

### 2-1. Firebaseのプロジェクトを作る
1. https://console.firebase.google.com/ にGoogleアカウントでログイン。
2. 「プロジェクトを作成」→ 名前は `tabiroute` など →
   Googleアナリティクスは**オフ**で作成します。
3. 料金プランは最初から**Spark（無料）**です。アップグレードしないでください。

### 2-2. ログイン方法を有効にする
「構築」→「Authentication」→「始める」→「ログイン方法」で、次の3つを有効にします。
- **Google**（サポートメールを選んで保存）
- **メール / パスワード**
- **匿名**

続けて「設定」タブ →「承認済みドメイン」→「ドメインを追加」で、`tabiroute.github.io` を追加します。

### 2-3. データベースを作る
1. 「構築」→「Firestore Database」→「データベースを作成」。
2. ロケーションは `asia-northeast1（東京）`、「本番環境モード」で作成。
3. 「ルール」タブを開き、中身をすべて消して、`firestore.rules` の内容を貼り付けて「公開」。

### 2-4. 設定値をアプリに書き込む
1. 歯車アイコン →「プロジェクトの設定」→ 下の「マイアプリ」で `</>`（ウェブ）を押す。
2. アプリ名を入れて登録すると `const firebaseConfig = { ... }` が表示されるので、`{` から `}` までをコピー。
3. GitHubで `index.html` を編集し、`const FIREBASE_CONFIG = null;` を探します（ブラウザの検索で `FIREBASE_CONFIG`）。
4. `null` の部分を、コピーした `{ ... }` に置き換えて保存します。

```js
const FIREBASE_CONFIG = {
  apiKey: "AIza....",
  authDomain: "tabiroute-xxxx.firebaseapp.com",
  projectId: "tabiroute-xxxx",
  storageBucket: "tabiroute-xxxx.firebasestorage.app",
  messagingSenderId: "....",
  appId: "1:....:web:...."
};
```

この値は公開しても問題ありません。データは手順2-3のルールで守られます。

1〜2分後に公開URLを開き直すと、「ログイン」ボタンと「共有」ボタンが使えるようになっています。

---

## 無料のまま使うために

- **Firebaseは「Spark（無料）」のまま使う**：カードを登録していなければ、上限を超えても請求されません（その日の分が止まるだけです）。
  無料で使える量は、1日あたり読み取り5万回・書き込み2万回、保存容量1GBです。友達同士で使うには十分な量です。
- **地図・場所検索・路線・写真のデータ**：国土地理院、OpenStreetMap（Nominatim・Overpass）、OSRM、Wikipedia の無料サービスです。いずれも善意で提供されているため、個人や友達同士の利用を想定しています。
  - 大勢に宣伝して使ってもらう規模になったら、各サービスの利用条件を確認してください。
  - 画面下の出典表示は利用条件なので、消さないでください。
- **GitHub Pages**：公開リポジトリなら無料です。月100GBまで転送でき、個人の利用では超えません。

## 別の公開方法（どれも無料）

- **Cloudflare Pages**：https://pages.cloudflare.com/ →「Create a project」→「Direct Upload」で、このフォルダをドラッグ＆ドロップ。
  URLは `https://好きな名前.pages.dev/` になります。Firebaseの承認済みドメインに `好きな名前.pages.dev` を追加してください。
- **Firebase Hosting**：Firebaseに付いている公開機能です。パソコンでコマンド（Firebase CLI）を使います。
  このフォルダで `firebase init hosting`（既存の `firebase.json` を使う）→ `firebase deploy` を実行します。
  URLは `https://プロジェクトID.web.app/` です。

## 困ったとき

- **Googleでログインできない**：
  - 承認済みドメインに公開URLのドメインが入っているか確認してください。
  - LINEの中で開いている場合は、画面に出る「外部のブラウザで開く」を押してください。
- **共有ボタンが「設定が必要」と出る**：`FIREBASE_CONFIG` の書き換えが保存されているか確認してください。公開に1〜2分かかります。
- **写真が出ない**：写真の下の「再読み込み」を押してください。Wikipediaに写真がない場所は表示されません。
- **LINEのプレビューが出ない**：手順1-5のURLが公開URLと一致しているか確認してください。LINEはプレビューを一時保存するため、反映まで時間がかかることがあります。

---

## 検索で見つけてもらうために（SEO）

サイトには、検索エンジン向けの設定をあらかじめ入れてあります。

アプリ名は「旅行プラン自動作成 たびルート」です。検索結果に出るタイトルは「旅行プラン自動作成アプリ たびルート｜旅程表・旅のしおりを無料で作成」にしてあり、「旅行プラン 自動作成」「旅程表 作成」「旅のしおり 作成」で探す人に見つかりやすい言葉を入れています。

- 検索結果に出るタイトルと説明文（「旅行 予定表 自動作成」「合流場所」など、探す人が使う言葉を含めています）
- 検索エンジンが内容を理解するためのデータ（アプリの種類・無料であること・よくある質問）
- トップページの紹介文・使い方・よくある質問・都道府県別の人気スポット一覧（検索エンジンが読めるように、アプリとは別に文章で書いてあります）
- サイトマップ（`sitemap.xml`）

### Googleに登録する（無料・約10分）

公開しただけでは、Googleに見つけてもらえるまで何週間もかかることがあります。Google Search Console に登録すると早くなります。

1. https://search.google.com/search-console を開き、Googleアカウントでログイン。
2. 「プロパティを追加」→ 右側の **URLプレフィックス** に `https://tabiroute.github.io/` を入力。
3. 所有権の確認で「**HTMLタグ**」を選び、表示された `<meta name="google-site-verification" content="……">` をコピー。
4. GitHubで `index.html` を編集し、`<link rel="canonical"` の行のすぐ上に貼り付けて「Commit changes」。
5. 1〜2分待ってから Search Console に戻り、「確認」を押す。
6. 左のメニュー「サイトマップ」で `sitemap.xml` と入力して「送信」。
7. 上の検索窓に `https://tabiroute.github.io/` を入れ、「インデックス登録をリクエスト」を押す。

Bing にも出したい場合は、https://www.bing.com/webmasters で「Google Search Console からインポート」を選ぶだけで登録できます。

### 上位に出るために続けること

- **知ってもらう**：SNS（X・Instagram・LINE VOOM）やブログ、noteで紹介し、リンクを貼ってもらう。ほかのサイトからのリンクは、検索順位にいちばん効きます。
- **使い方の記事を増やす**：「京都 2日間 モデルコース」「東京と大阪の友達と合流するなら」のような記事ページが増えるほど、検索で見つかる入口が増えます。
- **Search Console を月に1回見る**：どんな言葉で表示されているかがわかるので、その言葉を紹介文に足していきます。

検索順位は、Googleが時間をかけて決めるものです。確実に上位に出る方法はありません。登録から効果が出るまでに、数週間〜数か月かかるのがふつうです。
