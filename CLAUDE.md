# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

紡(tsumugi)は、キャラクターとの会話を主軸にしたPWAチャットアプリ。日本語UI、スマホでの片手操作が主な利用シーン。

**バックエンドは存在しない。** GitHub Pagesで配信され、LLMのAPIをブラウザから直接叩く。データはすべて利用者の端末（localStorage / IndexedDB）にある。

## ビルド・テスト

**ビルド手順はない。** `package.json`もバンドラーもテストフレームワークも無く、`index.html`（3500行規模）にHTML・CSS・JSがすべて入っている。編集＝この1ファイルを直接いじること。他にあるのは`sw.js`・`manifest.json`・アイコンだけ。

ファイル分割は意図的に見送られている。分割にはバンドラーが必要になりビルド手順が増えるため、区画はコメント（`/* ---------------- API ---------------- */` 等）で区切るに留めている。**目的の場所へはこの区画コメントをgrepして飛ぶ**のが速い:

```bash
grep -n "^/\* ----" index.html
```

CSSが`/* ---------- 名前 ---------- */`（ハイフン10個）、JSが`/* ---------------- 名前 ---------------- */`（16個）。JS側の並びは `rendering` → `sessions / chars` → `session search` → `character edit` → `room edit` → `room bar` → `screens / sheet` → `composer` → `API` → `backup` → `settings UI` → `TODO` → `toast & init`。

### ローカルで動かす

`file://` では localStorage も IndexedDB も使えないので、**必ずHTTP経由で開く**こと。この環境にはNode.jsもPythonも入っていないため、PowerShellの`HttpListener`で立てる。スクリプトをスクラッチ領域に書いてから起動する（ワンライナーにするとbashの`$`展開で壊れる）:

```powershell
$root = 'C:\Users\user\Documents\tsumugi-main'
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add('http://localhost:8765/')
$l.Start()
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [uri]::UnescapeDataString($c.Request.Url.LocalPath).TrimStart('/')
  if (-not $p) { $p = 'index.html' }
  $f = Join-Path $root $p
  if (Test-Path $f -PathType Leaf) {
    $b = [IO.File]::ReadAllBytes($f)
    if ($p -match '\.html$') { $c.Response.ContentType = 'text/html; charset=utf-8' }
    elseif ($p -match '\.png$') { $c.Response.ContentType = 'image/png' }
    $c.Response.Headers.Add('Cache-Control','no-store')
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
```

バックグラウンド実行のプロセスは落ちることがあるので、長い作業の途中で応答しなくなったら立て直す。

### 動作確認のやり方

自動テストは無い。**ブラウザのコンソールから直接検証する**のが実際的で、トップレベルの関数と状態（`chars` `sessions` `endpoints` `settings` `active` `resolveApi()` `buildSystem()` `buildHistory()` など）はすべてスクリプトスコープに出ているのでそのまま呼べる。

UIを経由する導線（「設定画面を開いた状態からモデル登録を開く」など）は、`openScreen()`を直接呼ぶ検証では重なり順の問題を見逃す。**実際のボタンを`click()`して確かめること。**

**スクリプトが最後まで走ったかを必ず確かめる。** 全体が1つの`<script>`なので、途中で例外が出ると**そこから下の`let`/`const`が初期化されないまま**アプリが動き続ける。関数宣言は巻き上げられるため、一見動いているように見えて後から「◯◯ before initialization」で気づくことになる。起動直後に末尾付近の変数（`editingCharId`など）が生きているか見れば分かる。

特に**トップレベルのコードから、それより下で定義された`const`の関数を呼ばないこと。** データ移行の処理を上の方に足したときに踏みやすい。`LS`のように先に定義されているものを直接使う。

**検証で利用者のデータを壊さないこと。** 開発用の空データではなく本人の会話ログが入った状態で確認することになる。ダミーを足すときは`saveSessions()`を通さずメモリ上だけで`renderChat()`し、終わったらリロードで捨てる。`localStorage`に試しの値を書いたら消して戻す。IndexedDBに書いてしまうとリロードでは戻らないので、`IDB.sessSync()`や`IDB.sessPut()`は検証で気軽に叩かない。

**ブラウザによって黙って無視されるAPIがある。** `scrollTo({behavior:'smooth'})`は例外も出さず何も起きないことがあった。動いたつもりにならないよう、スクロール量や座標のような**結果の値を読んで確かめる**。

## デプロイ

`main`にpushするとGitHub Pagesが配信する。反映まで1〜2分。

Service Worker(`sw.js`)は登録されるだけで**キャッシュしない**（`fetch`ハンドラが空）ので、古いコードが残る心配はない。

`core.autocrlf=false`が設定済み。単一ファイル構成では改行コードが変換されると差分が全行に広がるため、**CRLFを混入させないこと。**

改修の指針は `C:\Users\user\Documents\紡 改修手順書.md` にあり、Phaseとステップ番号で作業を指定する形式になっている。

## アーキテクチャ

### 画面の切り替え

全画面は `<div class="screen" id="scrXxx">` で、`openScreen(id)` / `closeScreen(id)` がクラスを付け外しする。通常は下からせり上がる（`translateY`）。

**重なり順の落とし穴:** `.screen`はすべて`z-index:20`なので、同値だとDOM上で後ろにある方が上に表示される。ある画面から別の画面を開く導線を足すときは、**呼び出される側がDOM順で後ろにあるか確認する**こと。前に出したいのにDOM上で先にある場合は、より強い`z-index`を与える必要がある。

現在の重なり: 画面20 < 暗幕21 < サイドバー22 < スクリム28 < アクションシート29 < トースト60。**トーストだけは全部の上**に出す前提で離した値にしてある。

**`scrSessions`だけは例外**で、左からのサイドバーとして振る舞う。`openScreen`/`closeScreen`が`scrSessions`のときだけ暗幕(`#sideBg`)も連動させているので、**閉じる処理は必ず`closeScreen()`を通すこと**（クラスを直接外すと暗幕が残る）。右スワイプで開き、左スワイプ・暗幕タップ・戻るボタンで閉じる。iOSのブラウザバックと競合しないよう、画面左端32px以内から始まったスワイプは拾わない。

### 描画

文字列でHTMLを組み立てて`innerHTML`に入れる同期処理。仮想DOMのような仕組みは無く、状態が変わったら`renderHeader()` `renderChat()` `renderCharList()` などを呼び直す。

`renderHeader`と`renderChat`は**薄いラッパー**で、本体（`renderHeaderBody` / `renderChatBody`）を呼んだあとに`hydrateImgs()`を回す。本体側に早期returnが複数あるため、この形にすることで呼び出し元（20箇所以上ある）を触らずに済ませている。

`#chat`の中身は毎回作り直されるので、**中に置いた要素は`renderChatBody`が出力する文字列に含める**しかない。末尾の`#jumpBar`（最初/最新へのジャンプ）は`position:sticky`で下端に貼り付くため**最後の子である前提**で、`appendStreamBubble()`は`appendChild`ではなくその手前へ`insertBefore`している。`#chat`に要素を足すコードを書くときは同じ配慮がいる。

生成中の吹き出しは履歴に入る前の仮のもので、`appendStreamBubble()`が返すハンドルで更新し、確定時に`remove()`してから`renderChat()`で描き直す。

### IndexedDB

DBは`tsumugi_images`（現在ver 2）ひとつで、ストアが2本ある。名前が画像寄りなのは画像用として作った名残で、**改名すると既存利用者の画像が丸ごと消えるのでそのまま使う。**

| ストア | 中身 |
| --- | --- |
| `images` | 画像の実体。`{id:'img_xxxx', data, created}` |
| `sessions` | 会話ログ。**1セッション=1レコード**（`keyPath: 'id'`） |

**ストアを足すときは`DB_VER`を上げて`onupgradeneeded`に`createObjectStore`を書く。** バージョンを上げると別タブが古いまま掴んでいる間アップグレードが止まるので、`onblocked`でその旨を知らせている。

#### 画像

localStorageの5MB上限を避けるため、**画像の実体はIndexedDBにあり、localStorageには`img_xxxx`というIDだけが入る。**

- 書き込み: `imgSave(base64)` → ID。**保存を確定する瞬間にだけ呼ぶ**（編集中断時に行き場のない画像を残さないため）。編集中のドラフトはBase64のままメモリに持つ
- 読み出し: 描画時は`imgPlaceholder(v, cls)`が`<img data-img="ID">`を吐き、あとから`hydrateImgs(root)`が`src`を差し込む
- 削除: キャラ削除・セッション削除時に`imgDelete()`を呼ぶ

**API送信経路に注意。** `buildHistory` / `buildRoomHistory` は`o.imgs`にIDを入れたまま返し、送信直前に`resolveHistImgs()`が実データへ解決する。この2関数を非同期にしていないのは、`renderHeaderBody`がトークン数の概算に同期で呼んでいるため。**`resolveHistImgs`を通し忘れるとLLMに`"img_xxxx"`という文字列が渡り、エラーが出ないまま画像だけ認識されない状態になる。**

#### セッション

会話ログも5MBに収まらなくなるのでIndexedDBに置いている。ただし**読み取りは全部メモリ上の`sessions`配列で済ませる**形にしてあり、非同期になったのは保存側だけ。`activeSession()`も`buildHistory()`も同期のまま使える。

- 読み込み: 起動時に`loadSessions()`が1回だけ`IDB.sessAll()`で全部読み、`updated`の新しい順に並べて`sessions`に入れる（localStorage時代の`unshift`と同じ並び）
- 保存: `await saveSessions()`。**呼び出し側から見た意味は今まで通り「今の`sessions`を保存する」で、変わったのは`await`が要ることだけ。** 中身は`IDB.sessSync()`が1トランザクションで、消えたセッションのレコードを落としてから今ある分を書き直す
- **`sessionsReady`が立つまで`saveSessions()`は何もしない。** 読み込み前や読み込み失敗時に空の配列でストアを上書きしないため

**`sessions`を触る処理を足すときは、保存まで`await`で繋ぐこと。** `saveSessions()`を呼ぶ関数は`async`になり、その呼び出し元（クリックハンドラを含む）も`async`にして`await`する。途中で`await`を落とすと、画面を閉じた直後や連続操作で保存が前後する。

読み込みに失敗した場合は`sessions`を空のまま進めず、localStorageに残っている分があればそれを表示に使い、`sessionsReady`は立てない（**表示はするが保存はしない**）。元データを壊さないための安全弁。

### データ（localStorage）

| キー | 内容 |
| --- | --- |
| `tsu_chars` | キャラクター。下記の通りモデル3枠とシスプロ3タブを持つ |
| `tsu_active` | 選択中のキャラIDとセッションID |
| `tsu_endpoints` | 接続先4枠。`{name, baseUrl, apiKey}`。**常に長さ4**で空枠も持つ |
| `tsu_settings` | 温度・最大トークン・履歴上限・thinking など全体の値 |
| `tsu_todos` `tsu_memos` `tsu_shop` `tsu_shopHist` | TODO・メモ・買い物リスト |
| `tsu_migrated_v1` | 画像のIndexedDB移行が済んだかのフラグ |
| `tsu_lastExport` | 最後にエクスポートした時刻。14日空くと起動時にバナーで催促する |

**会話ログ（旧`tsu_sessions`）はもうlocalStorageに無い。** IndexedDBの`sessions`ストアにある。起動時に`loadSessions()`が旧キーを見つけたら写して消すので、**新しくlocalStorageへ書き戻さないこと。**

キャラが持つもの（どちらも**常に固定長**で、空の枠を含む）:

- `prompts`: `{title, body}` × 3。システムプロンプトのタブ
- `promptIdx`: キャラ編集で最後に開いていたタブ
- `models`: `{label, model, epIdx, promptIdx}` × 3。`epIdx`は`tsu_endpoints`の添字、`promptIdx`は`prompts`の添字
- `modelIdx`: 使用中のモデル枠。チャット画面のモデル名から切り替える
- `prompt`: 使用中タブの本文の写し。履歴とエクスポートの互換のために残している
- `promptHist`: 過去の版。`{t, p, tab}`。`tab`が無い古い版はタブ1のものとして扱う

枠以外にキャラが持つのは、会話の中身を決める値だけ: `memory`（記憶）、`todoLevel`・`memoLevel`・`shopLevel`（注入の段階）、`thinkMode`（思考の上書き。空なら全体設定に従う）。

セッション側は`name`が**任意**。無ければ`sessionTitle()`が最初の発言から作る。**古いデータには無いので、必ず「無い場合」を書くこと。**

**データ構造を変えるときは移行処理を必ず書く。** 既存利用者の端末にデータが入っているため。先例が4つある。

- 起動時の`migrateImages()` — 完了フラグ`tsu_migrated_v1`で二重実行を防ぐ非同期の移行
- 起動時の`loadSessions()` — localStorageの`tsu_sessions`をIndexedDBへ写す。**フラグではなく旧キーの有無で判断し、写した分がストアに入ったのを読み直して確かめてから消す。** 途中で落ちたら次回起動でやり直しになるだけで、消えるタイミングが無い。やり直しのときに古い方で上書きしないよう、既にIDB側にあるものは`updated`の新しい方を残す
- `endpoints`の初期化 — 旧`settings.openai`/`settings.anthropic`から枠を作る
- `chars`の`prompts`/`models`の初期化 — 旧`c.prompt`や旧API上書きから枠を作り、足りない枠を空で埋める

後者2つは読み込み直後に同期で走る。**固定長の枠を埋めるパターンなので、枠数を増やすときも同じ場所を直せばいい。**

**起動処理の順番に注意。** `init()`は`loadSessions()`→`migrateImages()`の順で、`migrateImages()`は`sessions`を触るので先に読めていないと実行しない（中途半端に画像だけIDへ変換して保存されないのを防ぐ）。

エクスポート/インポート（`btnExport`/`btnImport`）は**Base64を直接埋め込む従来形式**を保つ。エクスポート時にIDから実データを引き、インポート時にIDへ戻す。新しいキーを足したらここにも追加すること。

### 生成中の状態

**排他はモジュール直下のフラグでやっている。** 仕組みは無いので、生成を絡める処理を足すときは自分で見る必要がある。

| フラグ | 意味 |
| --- | --- |
| `busy` | 生成中。多くのハンドラが冒頭で`if (busy) return`して弾く。`setBusyUI()`が送信ボタンを停止ボタンに差し替える |
| `sending` | 添付画像をIndexedDBへ書いている最中。`sendMessage()`の二重発火よけ |
| `abortCtl` | 停止用の`AbortController`。**`callAPI()`は引数ではなくこの変数を直接読んで`signal`に渡す** ので、生成のたびに`generateFor()`が差し替える |
| `roomStop` | ルームの巡回を途中で止めるフラグ。停止ボタン→`abort()`→`generateFor()`が`AbortError`を捕まえたところで立つ。`roomRound()`のループが次の番で見る |

**思考（thinking）は`<think>…</think>`というテキストとして本文に埋め込まれる。** APIの思考deltaを`thinkWrapper(onDelta)`という小さな状態機械がタグで包み、既存の折りたたみUIにそのまま流し込む形。だから思考の扱いは表示側と送信側で別々になっていて、**表示には残り、`stripThink()`を通した履歴だけがAPIへ行く。**

ストリーミングを使わない一発ものは`oneShot(promptText, maxTok)`。「記憶」の要約（`btnMemSum`）と買い物リストの抽出（`extractShopping`）がこれを使う。

### API

送信形式は2つだけ。`callAPI()`が`api.prov`で分岐する。

- **`anthropic`** — `api.anthropic.com/v1/messages` 固定
- **`openai`** — `baseUrl`を差し替える**汎用のOpenAI互換実装**

**OpenRouterもGoogleも`openai`分岐で通る。** GoogleにはOpenAI互換エンドポイント(`generativelanguage.googleapis.com/v1beta/openai`)があるため、プロバイダを増やすのにAPI実装を書く必要はなく、接続先を登録するだけでよい。

**送信形式はURLで自動判定する。** `isAnthropicUrl()`が`api.anthropic.com`を見るだけ。接続先の登録に形式の選択肢は無い。

`resolveApi(c)`は**キャラの使用中モデル枠から引く**。枠が指す`epIdx`の接続先からURLとキーを、枠自身からモデル名を取る。枠が空なら、埋まっている接続先で代用する。

`activePrompt(c)`も**同じ枠が指すタブ**を返す。これによりモデルを切り替えるとシスプロも一緒に入れ替わる。**この連動が設計の中心**なので、片方だけ別経路で決めないこと。

### 送信内容の組み立て

**実際にLLMへ渡るシスプロは、キャラのシスプロそのものではない。** `buildSystem(c, room)`が毎回この順で連結して作る:

1. 現在日時（JST。曜日付き）
2. `activePrompt(c)` — 使用中タブの本文
3. `c.memory` — 「記憶」。過去セッションの要約を貯めた欄（キャラ編集で手でも書ける）
4. `buildTodoBlock` / `buildMemoBlock` / `buildShopBlock` — TODO・メモ・買い物リストの現在値
5. ルームなら、グループ会話の指示と`room.scene`

3〜5は**キャラごとの段階設定で出し分ける**（`c.todoLevel` = `none`/`weak`/`mid`/`strong`、`c.memoLevel`・`c.shopLevel` = `off`/`on`）。TODOの`weak`は件数だけ、`mid`は期限が近いものだけ、`strong`は全件。**新しい注入ブロックを足すならここに並べる。**

「記憶」はサイドバーの`btnMemSum`から作る。現在のセッションをLLMに要約させ、日時見出しを付けて`c.memory`へ**追記**する（置換ではない）。

履歴は`buildHistory(sess)`が作り、送信量を抑える規則が3つ入っている:

- `stripThink()`で`<think>`ブロックを落とす（表示からは消えない）
- 画像は**直近2枚だけ実体を送り**、それより古いものは`[画像を送った]`というテキストに置き換える
- `settings.historyLimit`が正なら直近n往復に切る

### ルーム（複数キャラ）

`charIds`を持つセッションがルーム。**APIにグループ会話の機能はないので、履歴を各キャラの視点に組み替えて1対1として投げている。**

`buildRoomHistory(sess, me)`が、生成する本人の発言だけ`assistant`、他キャラとユーザーの発言は`名前: 本文`を付けて`user`に寄せる。末尾が`assistant`で終わると続きを書けないので`(そのまま会話を続けて)`を足す。

`roomRound(only)`が参加キャラを順に回して`generateFor()`を呼ぶ。停止は`roomStop`フラグ。**1回の「進める」で人数分のAPIコールが走る。**

`generateFor(spk, prevAlts)`は単体チャットとも共用で、`prevAlts`を渡すと再生成の候補として`m.alts`に積む。`m.ai`が今表示している添字で、チャット下部の`‹ 1/3 ›`で入れ替える。**`m.content`は選択中の候補の写し**なので、`alts`を触るときは両方直すこと。

## コードの書き方

- **コメントもUI文字列も日本語。** 既存の語り口（断定調でやや素っ気ない）に合わせる
- コミットメッセージも日本語。何をしたかだけでなく**なぜそうしたか**を書く
- 一括リファクタはしない。各改修で触る範囲だけ、ついでに整理する
- 既存利用者のデータと設定を壊さないことを最優先する

## 設計の考え方

**会話を決めるものはキャラが持ち、全体設定は部品だけを持つ。**

以前は「全体の既定をキャラが部分的に上書きする」二階建てで、キャラが人格を持つというアプリの前提と噛み合っていなかった。今は一階建てに寄せてある。

- **グローバル設定**（キャラ一覧の下から開く）= 接続先の登録と、温度などアプリ全体の値だけ
- **キャラ** = モデル3枠とシスプロ3タブ。実際に何を使うかは全部こちら
- **チャット画面** = ヘッダーのモデル名から枠を切り替える

**新しい設定項目を足すときは、まずどちらに属するか決めること。** 迷ったらキャラ側に寄せる。全体設定に会話の中身を決める値を増やすと、また二階建てに戻る。

**片手で届く場所を優先する。** スマホで使うアプリなので、よく触るものを右上の隅に置かない。サイドバーは右スワイプで開き、グローバル設定はキャラ一覧の下にあり、モデル切り替えはヘッダーのモデル名から下に出る。右上は「今開いているものの設定」に充てている。
