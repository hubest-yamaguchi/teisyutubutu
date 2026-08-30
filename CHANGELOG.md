# 変更履歴

## 2026-08-30 — Drive保存を年度別フォルダに、保存ボタンの状態表示、社員の個別編集

Drive保存機能の本番導入(前セクション)を進める中で判明した問題と、使い勝手の改善をまとめて対応した。

### サービスアカウントは共有ドライブでないと保存できない問題

- マイドライブ配下のフォルダをサービスアカウントに共有しても、`storageQuotaExceeded`エラーで保存できないことが判明(サービスアカウントは自身のストレージ容量を持たないため)
- 保存先を共有ドライブ(サービスアカウントを「コンテンツ管理者」でメンバー追加)に変更して解決。`DRIVE_ROOT_FOLDER_ID`には共有ドライブのIDをそのまま設定できる(Drive API呼び出しは元から`supportsAllDrives=true`を付けていたため、コード変更は不要だった)

### Driveの保存先を「入社年度卒」フォルダで分けるように

- 社員の`HireDate`(入社予定日)の年から`{yyyy}卒`フォルダを自動生成し、保存先フォルダ直下→年度フォルダ→`氏名_社員ID`フォルダ、の2階層構成にした(`src/api/admin.ts`)
- `src/drive.ts`の`ensureEmployeeFolder`は年度フォルダにも使う汎用処理のため`ensureFolder`に改名

### 社員ごとに氏名・フリガナ・職種・入社予定日を個別編集できるように

- これまで入社予定日は全員一括設定(`settingsBulkSetHireDate`)のみで、個別の社員だけ変更する手段が無かった
- 「設定」→「新入社員登録」の一覧に「編集」ボタンを追加し、社員ごとにインラインで氏名・フリガナ・職種・入社予定日を修正できるようにした(`settingsUpdateEmployee`)。職種を変更した場合は、LINE連携確認時と同じロジックで配属先(Company)も職種法人マスタから再計算する

### 「Driveに保存」ボタンの状態を見た目で分かるように

- 押した直後は灰色で「保存中…」、成功したら緑色で「保存しました ✓」、失敗したら赤色で「保存に失敗しました（再試行）」と表示するようにした(押している間はボタンを無効化し連打を防止)
- 保存済みの社員には、社員詳細画面に緑色のバッジで「Drive保存済み {日時}」を常時表示するようにした(単発の通知だけだと見落としやすいため)

## 2026-08-29（続き3） — Drive連携のセットアップ進捗とサービスアカウントキー発行のブロック

コード実装(前セクション)を本番へ反映し、Google Cloud/Drive側の設定を進めた。現時点の状態を記録しておく。

### 完了した作業

- マイグレーション`0006_drive_sync.sql`を本番D1に適用済み(`npm run db:migrate:remote`)
- コードを本番Workerにデプロイ済み(`npm run deploy`、Version ID: `217b0eb1-8f6a-47f4-819b-f9b9b18cdbd1`)
- GCPプロジェクト作成: `onboarding-documents-507009`(組織: hubest.jp、組織ID `177679363078`)
- Drive API有効化済み
- サービスアカウント作成済み: `teisyutubutu-drive-sync@onboarding-documents-507009.iam.gserviceaccount.com`
- Driveフォルダ作成・共有済み: マイドライブ内「提出書類」フォルダ(ID: `1NIAcTa6g7cBE62Q_etwYisVwXIWe6Keb`)を上記サービスアカウントに編集者権限で共有
- 管理画面の「Google Drive連携設定」に保存先フォルダIDを登録済み(本番settingsテーブルで確認済み)
- 動作確認用に承認済み書類を持つ社員が既に2名いることを確認済み(`E0004`山口美玲奈、`E0002`飯森航大、各1件)

### ブロック中: サービスアカウントキー(JSON鍵)の発行

- 組織ポリシー`iam.disableServiceAccountKeyCreation`により、`onboarding-documents-507009`プロジェクトでのサービスアカウントキー作成がブロックされている
- IT管理者に、組織全体ではなく`onboarding-documents-507009`プロジェクト単位でのポリシー例外設定を依頼中
- 解除・JSON鍵発行後に必要な残り作業:
  1. `wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL` / `wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` でWorker secretsを設定
  2. `E0004`または`E0002`の社員詳細画面で「承認済み書類をDriveに保存」を実行し、Driveにフォルダ・ファイルが作られることを確認

## 2026-08-29（続き2） — 承認済み書類をGoogle Driveへ保存する機能を追加

### 「Driveに保存」ボタンを社員詳細画面に追加

- アップロード時に自動でDriveへコピーするのではなく、書類の確認・承認が完了した後、管理者が明示的に「承認済み書類をDriveに保存」を押した時だけ、その社員の承認済み書類をまとめてDriveへアップロードする方式にした
- R2(`teisyutubutu-docs`)が正本のまま変わらず、Driveはあくまで承認後の控え・共有用の位置づけ
- 保存先はDrive上の指定フォルダ配下に `氏名_社員ID` のフォルダを作成(無ければ新規作成)し、ファイル名は `氏名_連番_書類名` とすることで、ファイル単体でも誰の何の書類かわかるようにした(旧gas-app/Drive.gsの命名規則を踏襲)。同名ファイルがあれば上書き
- 保存日時は `employees.DriveSavedAt` に記録し、画面に「最終保存」として表示する(`migrations/0006_drive_sync.sql`)

### Google Drive連携の認証情報

- サービスアカウントのメールアドレス・秘密鍵(`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`)は機微度が高いため、他の設定(LINEトークン等)と異なりsettingsテーブルには保存せず、`wrangler secret put`で設定するWorker secretとした(`src/bindings.ts`)
- 保存先フォルダIDはトークンほど機微ではないため、従来通りsettingsテーブルで管理し、設定画面の新タブ「Google Drive連携設定」(権限カテゴリ`drive`)から変更できるようにした
- Drive API呼び出しは`googleapis`パッケージを使わず、`src/drive.ts`でサービスアカウントJWTの署名(Web Crypto API)とREST呼び出しを直接実装した(Workers環境で完結させるため)

## 2026-08-29（続き） — ドラッグ並び替えの不具合修正、差し戻しのまとめ送信、通知ログ、管理者通知の廃止

### 設定画面のドラッグ並び替えが効かない不具合を修正

- HTML5ネイティブのドラッグ&ドロップAPIがブラウザによって不安定だったため、Pointer Eventsだけで自前実装する方式(`makeReorderable_`)に置き換え
- サイドタブは掴む場所が小さいアイコンだけだと押しにくかったため、ボタン全体を起点にしつつ、一定距離動かした場合だけドラッグ扱いにし、動かさなければ通常のクリック(タブ切り替え)として扱うよう調整(直後のclickイベントを1回だけ無効化)
- 書類マスタ側は行内に入力欄があるため、引き続き「⠿」ハンドルからのみドラッグ開始

### 差し戻しをまとめて1通で送信できるように

- LINE公式アカウントの無料プランには月間メッセージ送信数の上限があり、書類ごとに個別送信すると上限を消費しやすいため変更
- 「確認中」「原本提出待ち」の書類にチェックボックスを追加。複数選択し、それぞれの理由を入力してから「まとめて差し戻す」で1通のLINEメッセージとして送信(`adminRejectDocsBatch`、旧`adminRejectDoc`は廃止)
- 承認操作はLINE通知を送らないため、上限には影響しない

### 通知ログを管理画面に表示

- 「設定」→「LINE公式アカウント設定」に、直近100件の送信ログ(宛先・送信済み/保留中とその理由・本文)を表示する機能を追加
- 「保留中」の多くは宛先のLINEユーザーID未登録・チャネルアクセストークン未設定が原因であることが確認できるようになった

### 内定者の書類提出時の管理者通知を廃止

- 「差し戻し」「リマインダー」など、こちらから本人へ送る通知のみ残し、内定者が書類を提出した際に管理者へ自動送信していた通知(`notifyAllAdmins`)を削除
- 管理者はダッシュボードを見て提出状況を確認する運用とする

## 2026-08-29 — ID/パスワードログイン移行、ダッシュボード再設計、書類マスタ・管理者機能拡充

### ログイン方式をCloudflare AccessからID/パスワードへ完全移行

- Cloudflare Accessは新規管理者ごとにダッシュボード側のポリシー編集が必要で運用が煩雑だったため廃止。Worker自身がログインを検証する方式に変更
- `admins`テーブルに`PasswordHash`(PBKDF2)・`admin_sessions`テーブル(Cookieトークンはハッシュ化して保存)を追加(`migrations/0003_auth_and_permissions.sql`)
- ログイン画面（メール+パスワード）と、管理者登録済みだが未ログインのメールが自分でパスワードを設定する「初回アカウント有効化」画面を新設
- `src/auth.ts`(Cloudflare Access JWT検証)・`jose`依存を削除、`wrangler.toml`のCF_ACCESS_*も削除
- パスワード表示/非表示の切り替えチェックボックスを全パスワード欄に追加

### 権限をチェックボックス化(代表管理者フラグを廃止)

- 「代表管理者かどうか」の単一フラグを廃止し、設定ページの9カテゴリ(新入社員登録/テンプレート/職種法人マスタ/管理者一覧/LINE設定/書類マスタ/初期セットアップ等)ごとにチェックボックスで権限を付与する方式に変更
- 管理者一覧で「全権限を付与」ワンクリック切り替え、既存管理者の氏名・メール・担当法人(プルダウン化)・LINEユーザーID・権限・マイナンバー閲覧権限をまとめて編集可能に

### 設定ページをサイドタブ形式に再構成

- 縦一列だった9枚のカードを、左サイドタブ+右コンテンツの構成に変更
- サイドタブの並び順・書類マスタの並び順をドラッグ&ドロップで変更可能に(`SETTINGS_TAB_ORDER`設定・`company_document_config.SortOrder`)
- Liny HR連携・通知の送信方式(未使用だったため)を削除。通知は常にLINE公式アカウント直接送信に固定
- 保存・削除・並び替えなど全14箇所の保存操作で、画面下に「✓ 保存しました」トーストを表示するように変更

### ダッシュボードを左リスト+右詳細の2カラムに再設計

- 左25%に内定者リスト(LINEアイコン・フルネーム・提出状況「提出完了/未提出/一部提出」)、右75%に選択した人の詳細(書類ごとのカード・提出日時・進捗「n/m」表示)
- 上部のKPIカード(未提出/確認中/差し戻し中など)をクリックしてリストを絞り込み可能に
- 内定者がLIFFで本人確認する際にLINEプロフィール画像URLを保存するように(`employees.PictureUrl`, `migrations/0004_employee_picture.sql`)

### 書類マスタ・新入社員管理の拡充

- 書類名をその場で編集可能に
- 書類ごとに「対象法人」を複数チェックボックスで設定可能に(`company_document_config.CompaniesJson`, `migrations/0005_doc_companies.sql`)。`DocType.condition`は通勤手段専用に整理
- テスト登録などを取り消せるよう、新入社員の削除機能を追加(提出書類・履歴も合わせて削除)

### 内定者の本人確認フローを変更

- 「フリガナ+職種」の2項目入力から「フリガナのみ」入力に変更(職種の記憶違いによる失敗を防止)
- フリガナで一致した1件について、氏名・フリガナ・配属先法人を表示し「この内容で合っていますか？」で本人に確認させる方式に変更。「いいえ」の場合は「お手数ですが総務課へご連絡ください」と表示
- なりすまし対策として、「はい」確定時にサーバー側でフリガナを再検証してから連携
- フリガナ入力欄はスペース入力時に自動除去、説明文も追加

## 2026-08-28 — Cloudflare Access設定・LINE公式アカウント接続

前回(2026-08-27)の「この後やることリスト」のうち、Cloudflare AccessとLINE接続の2つに対応した。

### Cloudflare Access設定

- Zero Trustチーム`hubest`(`hubest.cloudflareaccess.com`)を作成し、アプリケーション`teisyutubutu`を登録(`/admin`・`/api/admin`を保護、パス2つを1アプリの複数宛先として設定)
- ログイン方法はIDプロバイダー未追加のためデフォルトのOne-time PINを使用
- ポリシー「HR管理者」で`m-yamaguchi@hubest.jp`・`yechang@hubest.jp`を許可
- `wrangler.toml`の`CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`に実際の値を設定してデプロイし、管理画面ログインを確認
- 副次的に発見した不具合を修正: ルートURL(`/`)にフェーズ1〜2時代の古いプレースホルダー文言(`public/index.html`)が残っており、Cloudflareの静的アセット配信がWorkerコードの`/`→`/liff/`リダイレクトより先に処理されるため、そのまま表示されてしまっていた。`/liff/`へのmetaリフレッシュに変更

### LINE公式アカウント接続

以下の理由から、GAS版が使っていた公式アカウントとは別に、新規で用意する方針とした。

- 最有力候補だった既存の「ヒューベストホールディング【採用】」(友だち3,397人)は、LINE Official Account Manager上では管理者権限があるにもかかわらず、LINE Developersコンソール側のプロバイダー権限が(複数アカウントで試したが)無く、アクセスできなかった。OA Manager側の権限とDeveloper Console側のプロバイダー権限は別の仕組みであることが判明
- LIFF(ログイン)チャネルとMessaging API(通知送信)チャネルは、必ず同じプロバイダー配下にある必要がある(違うとLINE IDが一致せず通知が届かない)。これを踏まえ、まず動作確認のため一時的に間借りした「U-Select佐賀車両問合せ専用窓口」(既存の別事業用アカウント)で一連の動作を検証
- 最終的に、入社書類提出専用の新しい公式アカウント「hubest入社書類提出」(Basic ID: `@355bzxfm`)を作成。同じプロバイダー内にLINEログイン(LIFF)チャネルも作成し直し(LIFF ID: `2011305186-qpvABmIY`)、「リンクされたLINE公式アカウント」設定で紐付け、公開(Publish)済み
- 管理画面の「設定」にチャネルアクセストークン・LIFFチャネルIDを登録
- 手順は[公式LINEアカウント切替手順.md](./公式LINEアカウント切替手順.md)に記録(今後、正式な公式アカウントへさらに切り替える際にも流用可能)

### 今回はデータ移行を対象外とした

新規利用(既存データの移行元が無い)であることを確認し、`migrate-from-sheets.ts`は今回は使用しないと決定。

### 残課題(2026-08-29以降にやること)

- [ ] **管理者権限エラーの解消**: `admins`テーブルの登録メール(`yechang@hubest.co.jp`)とCloudflare Accessポリシーのメール(`yechang@hubest.jp`/`m-yamaguchi@hubest.jp`)でドメインが食い違っており(`.co.jp`か`.jp`か)、「アクセス権限がありません（管理者として登録されていません）」エラーが発生中。どちらが正しいメールアドレスか確認し、Accessポリシーと`admins`テーブルの両方を同じアドレスに揃える
- [ ] **LIFF動作確認の完了**: 新しいLIFF URL(`https://liff.line.me/2011305186-qpvABmIY`)で、「hubest入社書類提出」の友だち追加プロンプト→本人確認→書類提出→管理者への通知、の一連の流れが実機で正常に動くか最終確認
- [ ] **GitHubリポジトリの作成・push**: `teisyutubutu`用のリモートリポジトリがまだ無い。作成後、ローカルの未pushコミットをpush
- [ ] **HR確認事項**(継続): 賃貸借契約書の対象範囲、3社別の必要書類リスト、マイナンバー閲覧グループの実メンバー
- [ ] **本番切替の判断**: 上記が全て確認できたら、LINEのLIFF URL・管理画面URLを正式配布し、GASのWeb Appデプロイを停止(コードは保存したまま)

### 保留中の検討事項

- GAS関連コード(`gas-app`/`gas-app-liff`)の削除は時期尚早と判断し保留。Cloudflare版が安定運用に入ってから再検討

## 2026-08-27 — 実装完了(フェーズ1〜6)・Cloudflareアカウント側の初期セットアップ

GASからCloudflareへの完全移行(入社書類管理システム)を実施。既存のGASコード(`gas-app`/`gas-app-liff`)は一切変更せず、リポジトリとして手を加えず保存。新規実装は本リポジトリ`teisyutubutu`で行った。詳細な設計は `.claude/plans` のプラン(GAS→Cloudflare 完全移行)を参照。

### 実装した内容

- **土台**: wrangler + Hono + TypeScript + D1 + R2 の構成。`migrations/`でD1スキーマ管理
- **データ層**: `src/model.ts`(gas-app/Model.gs相当)、`src/db/*.ts`(Repo.gs/Sheets.gs相当)
- **LIFF側**: `src/api/liff.ts` + `public/liff/index.html`。`?demo=1`でLINEログインなしの画面デモが可能
- **管理画面**: `src/api/admin.ts` + `public/admin/index.html`。Cloudflare Access(Zero Trust)のJWT検証で認可(GroupsApp判定は廃止し、`admins`テーブルの列(IsSuperAdmin/マイナンバー閲覧法人)で管理)
- **新設UI**: 書類マスタ・職種法人マスタのCRUD画面(旧GAS版はスプレッドシート直接編集だった分)
- **書類ファイル閲覧**: `submissions`にStorageKey/MimeType列を追加し、管理画面から提出書類(R2上のファイル)を表示できるように
- **データ移行スクリプト**: `scripts/migrate-from-sheets.ts`(Googleスプレッドシート/DriveからD1/R2への一回限りの移行。dry-run既定、`--apply`で実書き込み)

### Cloudflareアカウント側で完了した作業

- `wrangler login`でアカウント連携(m-yamaguchi@hubest.jp)
- D1データベース`teisyutubutu-db`作成、マイグレーション適用(local/remote両方)
- R2バケット`teisyutubutu-docs`作成(ダッシュボードでの初回有効化が必要だった)
- workers.devサブドメイン`hubest`を登録
- Workerを本番デプロイ。本番URL: **https://teisyutubutu.hubest.workers.dev**
  - 補足: サブドメイン登録直後、HTTPS(443番)の証明書がCloudflareエッジに反映されるまで通常より時間がかかった(体感30〜45分程度。HTTPは早い段階から応答していたので、デプロイ自体は問題なかった)。現在は解消済み

### 今、問題となっている点

- **Cloudflare Accessが未設定**: `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`が空のため、本番の管理画面API(`/api/admin/*`)は現状「誰からのリクエストも認証エラーで拒否」される状態(安全側に倒れているが、管理画面自体がまだ使えない)
- **LINE公式アカウント未接続**: 本番のLIFFチャネルID・チャネルアクセストークンが未設定のため、LIFF画面を開くと「LIFFチャネルIDが未設定です」と表示される
- **本番データが空**: 実データの移行(`migrate-from-sheets.ts --apply`)がまだ未実施。現在の本番D1は空(`/health`で`employees:0`)

### この後やることリスト

1. **Cloudflare Access設定**: Zero Trustでチーム作成→ログイン方法(One-time PIN推奨)→`/admin*`と`/api/admin*`を保護するアプリケーション作成→Application Audience(AUD)タグ取得→`wrangler.toml`の`CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`に反映して再デプロイ
2. **LINE本番公式アカウント接続**: Messaging API有効化→チャネルアクセストークン発行→本番URL(`https://teisyutubutu.hubest.workers.dev/liff/`)をエンドポイントにしたLIFFアプリを追加→LIFF ID取得→管理画面「設定」からトークン・LIFF IDを登録
3. **データ移行の実行**: Googleサービスアカウント準備(対象スプレッドシート/Driveに閲覧権限付与)→`npm run migrate:from-sheets`でdry-run→件数確認→HRにGAS側の操作を止めてもらう→`npm run migrate:from-sheets:apply`で本実行→管理画面で「代表管理者」「マイナンバー閲覧可否」を手動再設定(旧シートに無い情報のため)
4. **切替前の一連テスト**: 実LINEアカウントでのLIFFログイン〜提出〜通知、Cloudflare Accessでの管理画面ログイン、CSV一括登録などをブラウザで確認
5. **本番切替**: LINEのLIFF URLと管理画面URLを新しいものに切替→GASのWeb Appデプロイを停止(コードは保存したまま)
