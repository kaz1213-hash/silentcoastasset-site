# TANUKI FairValue × Silent Coast Asset | 無料集客導線（2026-10-24）

## 運用判断

有料販売ではなくSilent Coast Asset公式サイトの無料研究ツールとして提供準備する。目的は検索流入・ブランド認知・Project Tanuki他製品への自然な回遊であり、買取業者の営業用リードを販売しない。

査定ツールを使う「売却検討者」がSCA鎌倉拠点の「宿泊客」になるとは限らない。存在しない仲介サービスや予約サービスを訴求しない。会員登録・メール・電話番号を必須にしない。

## 実装した同一ドメイン導線（まだ本番には未反映）

- SCA公式トップ → 商品カード「TANUKI FairValue / 無料で調べる」→ /fairvalue/
- /fairvalue/ : 売却前に自分で過去の取引を確認するメリット、使い方、全国地図と価格分析対象の区別、無保証・出典・プライバシーを説明する専用ページ
- /fairvalue/app/ : Private正本v0.4.7から静的アプリに必要なHTML・JS・CSS・JSONのみを複製したブラウザアプリ
- 紹介ページは原則テキスト主体。トップで5.6MBの取引JSONを自動読み込みしない
- app内もSCAの無料研究サービスと分かる内部リンクを追加、Project Tanukiへの導線を残す
- 今はMeta robots noindex,nofollowを両ページに設定。検索露出する正式公開はまだ承認されていない
- SCAのホームページ・Vault・Tanuki Store・Blog・Media Labの既存機能と商品価格を変更せず、隔離されたworktreeに作成

## SCAの集客実績と評価指標

接続済みGSC Wizardにおける2026-09-24〜2026-10-21のSCAのGoogle検索はサイト全体で20表示、3クリック。無料ツールで訪問者や顧客が急に増えると保証できる根拠はない。

公開後に追う項目：
- /fairvalue/の検索表示、クリック、検索語（Search Console、一定期間の遅延あり）
- /fairvalue/app/のアクセス傾向とSCAトップ・Storeへの回遊（Netlifyの非個人識別の集計ベース。個別の入力条件は収集しない）
- 何か買われた・問い合わせが発生した場合でも、初期段階での経路帰属は保証できない
- 大量のテンプレート地域ページを作らず、本人の経験・独自機能・出典と限界に根ざした少数の解説記事で検索流入を育てる

## 無料でも守る技術・法務・費用ゲート

- 不動産情報ライブラリの通常の取引価格情報は2023Q1〜2026Q1の17,156件、15市区に限定。全国行政地図は47都道府県・1,905市区町村等。全国の参考価格を勝手に作らない
- 出典：国土交通省「不動産情報ライブラリ」（PDL1.0とサイト独自条項に従い、出典・編集加工を明示）、国土数値情報・デジタル庁ABR、OpenStreetMap contributors（ODbL）、GSI地図タイル（利用者が選択した場合のみ外部通信）
- 取引仲介・代理、他人の取引の斡旋、反復売買等の宅建業の範囲は免許の要否を判断する必要がある。現行の価格情報提供と匿名な資金比較を、無免許の仲介行為に変更しない
- 入力・ローン額・業者名は基本的にブラウザ内で計算し営業情報として保存しない。通常のHTTPサーバーのアクセスログは別
- 未確認の規約、誤認表示、GDPR等は一般公開前に点検
- NetlifyのFreeでも転送量/本番デプロイ等の枠は消費。現行の請求/credit状況を公開前に確認し、課金プランへ変更しない。取引JSONは生5.58MB、gzip参考約246KB（実転送量は環境による）
- 検証中は既存ドメイン・DNS・本番Netlifyプロジェクトを変更しない。Prod公開は別の明示承認ゲート

## 開発・引継ぎ

- 隔離候補：C:\TanukiFactory\Ops\SCA_FairValue_20261024
- SCA公式GitHub：kaz1213-hash/silentcoastasset-site
- 元main：e51ff02、候補ブランチ：feature/fairvalue-free-inbound-20261024
- FairValue private正本：kaz1213-hash/tanuki-fairvalue commit 4092b3e
- 複製：scripts/package_fairvalue_from_local.py
- 保護：scripts/site-release-gate.cjs / release/protected-files.json。protected filesを新候補用に再シール済み
- テスト：site-http-smoke 26ページ、negative-gate、fairvalue-funnel静的検査、ChromeからSCAトップ→無料説明→価格分析→手取り計算→スマホを実操作
- Netlify PRODUCTION は一切変更していない

## 公開する際の次回確認

最終的な再配布ライセンス、公開サイトのプライバシー表記と出典の最終確認を行う。正式承認後、Noindex解除、サイトマップ登録、GSC確認、候補branchと最新mainとの差分整合、Netlifyの単発本番デプロイの承認が必要。公開後も価格予測モデルの誤差は現行のままである。

一次資料：
https://developers.google.com/search/docs/fundamentals/creating-helpful-content
https://www.reinfolib.mlit.go.jp/help/termsOfUse/
https://www.mlit.go.jp/totikensangyo/const/1_6_bt_000242.html
https://www.openstreetmap.org/copyright
https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
