# Silent Coast Asset｜TANUKI Fair Value 公開候補 v080（2026-10-30）

## 結論と公開境界

**2026年10月30日の作業範囲は、SCA公式サイトへの組み込みを独立ブランチで実装・検証し、承認待ちのDraft PRにすること。**

- **本番 `https://silentcoastasset.com/` は変更しない。**
- **既存NetlifyチームSSO付き `tanuki-fairvalue-private-preview` も変更しない。**
- SCA公開用パス候補：`https://silentcoastasset.com/fairvalue/`（SEO向け静的日本語紹介）、`https://silentcoastasset.com/fairvalue/app/`（地図・取引・計算アプリ）。
- 既存のSCAブログ、メディア、販売中製品には修正を加えない。
- **絶対にDraft PRを承認前にmergeしない。** `release/fairvalue-v080.json` の `generalPublicReleaseApproved=false` と `status=READY_FOR_REVIEW_NOT_PUBLISHED` の組合せにより、Netlify `CONTEXT=production` はビルド失敗で止まる。
- PRプレビューは `CONTEXT=deploy-preview` で生成し、**両ページのmeta robotsはnoindex**。SCAのNetlifyサイトでは非本番のDeploy Previewsにチームログイン保護が設定されている。これはNetlify側での継続確認も要る。

## 構造と出典

- 公開向け静的ページは`fairvalue/index.html`。タイトル、meta description、canonical、見出し、2026Q2、操作手順、FAQと出典は初期HTMLに収録。GooglebotにJavaScript実行を必要としない説明ページ。
- SCAホームの製品カードは`index.html`最初の製品欄へ日本語・英語で追加。旧Media Lab/Project Vault/主要製品は維持。SCA既存の言語スイッチは同じドメインのリンクに `?lang=ja` を付けるため、canonicalはクエリのない `/fairvalue/` を指定。
- `sitemap.xml`に説明ページとアプリURLを追加。公開承認が来るまでは元ブランチに留める。
- `netlify.toml`の`/fairvalue/*`のみCSP・frame禁止・nosniffなどを追加。既存サイトのNetlify redirects等はそのまま。
- 元ソースはFairValue private GitHubコミット`cd98d16732064b3e8b7e05356d25876f972c02c6`からローカルで検証されたv079。元の静的220ファイル＝**60,934,902バイト**を、決定的なgzip tar形式で`release/fairvalue-v080.tar.gz`へ封入（約3.5MB）。
- アーカイブSHA256：`fe08685bc68f3264de071ddadcd49b3584870d6945bcf5d5592b3994a342c414`。`release/fairvalue-v080.json`に220ファイルの個別バイト数・SHA、最新期・旧モデルの凍結・521件追加の出典・原本レシートSHAを保持。**元のQ2/旧Q1データファイルは書換えず、HTMLのnoindexからの切替のみが許容される。**
- `scripts/stage-fairvalue-v080.cjs`は**Node標準モジュールのみ**使用：tarの見出し・チェックサム・ファイルサイズ・ファイル名・SHA・220件の一致を検証してから、安全な`public-build/fairvalue/app/`へ218ファイルを展開。元のレビュー専用`_headers`と`robots.txt`は配信物から除外。
- 全国の過去公表取引は**167,559件（2026Q1まで）**、別欄の2026Q2新規**5,763件**、閲覧用候補合計**173,322件**。参考価格研究βは**21市区**のままで、Q2を予測モデルには投入しない。旧期間の遡及追加303件と匿名修正候補2組は依然別隔離。

## 既存SCAの保護と安全ゲート

- 新ブランチは最新SCA `origin/main` のコミット `4f1a24bc94690b0f1b17d3b086f116ed4a113d1c` から作成。以前の`feature/fairvalue-free-inbound-20261024`ブランチ（17,156件・15市区）は旧版として再使用せず、静的SEOページの設計方針とブログ保護のノウハウだけ継承。
- 既存保護ファイルのSHA-256（37件）は**SCAホーム`index.html`の承認待ちリンク追加に対応する1件のみ更新**。旧ブログ・漫画・既存製品の静的HTMLなどはすべて既存SHAのまま保持。
- `scripts/site-release-gate.cjs`に`fairvalue`を追加し、元サイトの検証を省略せず、FairValue固有の独立ゲートを追加した。`public-build`へ展開したデータも全部再SHA検査する。
- `CONTEXT=production`で`generalPublicReleaseApproved=false`のときは**ビルド拒否**。未承認版をうっかりmergeしても本番へ反映しない設計。
- `CONTEXT=deploy-preview`でビルドすると説明ページもアプリも`noindex,nofollow`となり、さらにNetlifyプレビューのSSOで一般アクセスを防止。
- 実公開承認後には**別コミットで**明示フラグとステータスを変更し、`CONTEXT=production`ビルドを独立試験した後にmergeする。公開版のみに`index,follow`とcanonicalを生成する。既存のFairValue SSOプレビューを一般公開へ変更する必要はない。

## 検証・URL/UX・ライセンス

- `node scripts/site-release-gate.cjs verify`、`CONTEXT=deploy-preview node scripts/site-release-gate.cjs build`、`node tests/fairvalue-release-v080.cjs`、`python tests/check_fairvalue_netlify_config_v080.py` 合格。
- ARK実Chromeで `http://127.0.0.1:8780/`（ローカル）：PC1440pxとスマホ390pxともSCAホーム→`/fairvalue/`→`/fairvalue/app/`の導線・地図・Q2取引・Q1参考価格・SEO静的文字列・canonical・プレビューnoindexに合格。文京区のQ2新規40件・地図592件、松本市70㎡の旧参考価格1,917万円を維持。JS例外0、予期しない外部通信0、横はみ出しなし。危険な`/release/fairvalue-v080.tar.gz`や内部`_headers`はHTTP404。
- 国交省「不動産情報ライブラリ」の取引価格情報は公式掲載コンテンツ一覧で商用利用可。取引価格はアンケート由来の匿名化公表情報であり、実際の全取引・正式査定ではない。デジタル庁ABRは公共データ利用規約に基づき出典・加工主体を表示、道路のOpenStreetMapはODbLとデータ提供者を表示。一般公開する前には**地図の第三者加工原本・OSM派生データのODbL条項の適合性を再点検する**。
- 主な一次情報：
  - 国交省：https://www.reinfolib.mlit.go.jp/help/contents/ 、https://www.reinfolib.mlit.go.jp/help/termsOfUse/
  - デジタル庁：https://www.digital.go.jp/policies/base_registry_address_tos
  - OpenStreetMap：https://www.openstreetmap.org/copyright 、https://osmfoundation.org/wiki/Attribution_Guidelines
  - Netlify Deploy Previewコンテキスト：https://docs.netlify.com/deploy/deploy-overview/
  - Google検索用JavaScript/静的HTML：https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics

## GitHub→Netlify自動プレビューの接続ブロッカー（2026-10-30）

- GitHubのDraft PR **#34**：`https://github.com/kaz1213-hash/silentcoastasset-site/pull/34`。本番のSCAサイトは変更していない。
- NetlifyのSCAサイト`inquisitive-clafoutis-525f7c`へのDeploy Preview #34（デプロイID`6ae40fd4f0dccd1f4f382214`）は、`Failed during stage 'preparing repo'`、GitHubプライベートリポジトリ`kaz1213-hash/silentcoastasset-site`に対して`Repository not found`（git exit128）で失敗。
- **2026-10-28のSCA productionデプロイでも同じ原因で失敗**しており、FairValueのSCA統合コードや今回のtar展開コードが原因ではない。SCA既存の最後の正常なproduction deployは`6ae194b96576c9b2404e1290`のまま。
- Netlify Project configuration → Developer settings → Continuous deployment → Repository → Manage repository → Link to a different repository、同じprivate GitHub repoを再選択して**Netlify GitHub Appのリポジトリアクセスを再承認**する必要がある可能性。連携解除・OAuth再接続は所有者の判断が必要なので未実行。
- Netlify公式ヘルプ：`https://docs.netlify.com/build/configure-builds/troubleshooting-tips/`、`https://docs.netlify.com/build/git-workflows/repo-permissions-linking/`。
- 認証が復旧したらPR #34を**Draftのまま**再ビルドし、`deploy-preview`環境のnoindex・SSO・ブラウザ動作を本番と区別して確認。**本番公開の許可ではない**。

## クロスプラットフォーム保護

- WindowsのGit checkout（CRLF）とNetlify/Linuxのcheckout（LF）でテキストのバイトが異なる可能性を実際の隔離試験で検出。SCA紹介ページ**のみ**改行をLFに正規化してハッシュ比較する。ZIP/JSON/APIデータ、静的アプリ、取引データは引き続きバイト単位の厳格SHA検査。
- **模擬本番ビルドに合格（2026-10-30 12:41 JST頃）**。ARKの使い捨てdetached worktreeに限り仮の承認フラグを設定して`CONTEXT=production node scripts/site-release-gate.cjs build`を実行。展開ファイル218件の全SHA、`/fairvalue/`・`/fairvalue/app/`の`index,follow`とcanonical、既存旧167,559件／Q2新5,763件／価格モデル凍結を確認し`BUILD_PASS`。作業後、一時worktreeは削除済み。
- 模擬試験の証拠：`C:\TanukiFactory\Ops\SCA_FairValue_V080_PRODUCTION_DRYRUN.json`。コミット`c96e3dfe81037afabae50a256b32930bde39cf7d`で確認。**実際のNetlify productionは一切変更せず、PRの`generalPublicReleaseApproved=false`を維持したまま**。

## 公開後の流入測定方針

- SCAの既存サイトではFairValueの一般公開導線はまだ存在しない。SCA公開時に初めて検索エンジンのクロール対象となる。
- 初期2〜4週間は`/fairvalue/`と`/fairvalue/app/`のSearch Console **表示回数、クリック数、検索クエリ**を確認し、SCAトップ・商品棚へ流れたかを分析する。アクセス解析のNetlifyリクエスト数をユニーク訪問者数と呼ばない。
- GSC Wizardは2026-10-29時点で`subscription_required`によりデータが読めず、Googleの現在の訪問者数や増加割合は推測しない。
- 少数件数の都市を網羅的に量産して検索ページへすることは避ける。最初は独立したSEO紹介ページ1つと使えるツール1つを軸に、検索結果を見て地域別の説明を足す。
