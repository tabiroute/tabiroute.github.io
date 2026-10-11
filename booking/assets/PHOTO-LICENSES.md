桜島の写真（sakurajima.jpg）

原題: Sakurajima -城山展望台より.jpg
撮影者: こたつむり (Photozou)
公開元での露出調整: Nkon21
出典: https://commons.wikimedia.org/wiki/File:Sakurajima_-%E5%9F%8E%E5%B1%B1%E5%B1%95%E6%9C%9B%E5%8F%B0%E3%82%88%E3%82%8A.jpg
ライセンス: CC BY-SA 2.1 Japan
https://creativecommons.org/licenses/by-sa/2.1/jp/

公開元の現行ファイルをそのまま収録。アプリは画面サイズに応じて表示します。
ほかの観光写真はWikimedia APIから取得し、取得した作者・ライセンス・出典を写真情報に保持します。

料理イメージの写真（booking/dish-photos.js）

有名店・お店のカードで、お店自身の写真が見つかるまでのあいだ（見つからないときも）出す「その土地の名物料理」の写真です。
Wikimedia Commons の写真を料理ごとに1枚、目で確認して選びました（2026年10月）。各写真の作者・ライセンス・出典ページは
dish-photos.js に保持し、画面の「写真・出典」から確認できます。表示は Wikimedia の縮小画像（330px）で、カードの枠に合わせてトリミングしています。
カードには「料理イメージ」と表示し、「このお店の写真ではありません」と明記しています。

お店自身の写真（booking/famous-photos.js と Worker の /shop-photos）

料理イメージのあと、画面に出たお店について、お店自身の写真を次の方法で探して差し替えます。
- ホットペッパー グルメ（店名と住所・位置が合うお店の写真。画像提供：ホットペッパー グルメ）
- OpenStreetMap（お店の位置で店名が合う地点の写真・Wikidata・公式サイトの情報。© OpenStreetMap contributors, ODbL）
- Wikimedia Commons（お店の近くで撮られ、写真名か説明に店名がある写真。「〜の近くの道」「〜から見た景色」のような写真は除く。作者・ライセンスを表示）
- Wikipedia・Wikidata（お店の記事・項目の写真。記事・項目の位置がお店から2km以内のものだけ）
- 公式サイト（famous-photos.js の確認済みURL、OpenStreetMap・Wikidata に載っている公式サイトの紹介用画像 og:image。出典としてサイト名とリンクを表示し、サイトから直接表示）
有名店のうち Wikimedia Commons にお店の写真があるもの（64店）は、1枚ずつ目で確認して famous-photos.js に入れてあり、すぐに表示されます。
公式サイトが確認できた有名店（86店）は、そのURLも famous-photos.js に入れてあり、Worker が写真を探す手がかりにします。
