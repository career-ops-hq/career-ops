# モード: pipeline -- URL インボックス（Second Brain）

`data/pipeline.md` に蓄積された求人 URL を処理する。候補者がいつでも URL を追加し、後から `/career-ops pipeline` を実行してまとめて処理する。

## ワークフロー

1. **読み取り** `data/pipeline.md` → 「未処理」セクションの `- [ ]` アイテムを検索
2. **各未処理 URL に対して**：
   a. 次の `REPORT_NUM` をアトミックに予約するために `node reserve-report-num.mjs` を実行し（レポートが書き込まれたら `node reserve-report-num.mjs --release <num>` を実行してセンチネルを解放します）
   b. **JD を抽出** Playwright（browser_navigate + browser_snapshot）→ WebFetch → WebSearch の順で
   c. URL にアクセスできない場合 → `- [!]` にマークし注記、次へ進む
   d. **完全な auto-pipeline を実行**：評価 A-F → Report .md → PDF（スコア >= 3.0 の場合）→ Tracker
   e. **「未処理」から「処理済み」へ移動**：`- [x] #NNN | URL | 企業名 | 求人タイトル | スコア/5 | PDF ✅/❌`
3. **3 つ以上の URL がある場合**、エージェントを並列起動（Agent tool の `run_in_background`）して速度を最大化。
4. **完了後**、サマリーテーブルを表示：

```
| # | 企業 | 求人 | スコア | PDF | 推奨アクション |
```

## pipeline.md のフォーマット

```markdown
## 未処理
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [!] https://private.url/job — エラー: ログインが必要

## 処理済み
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

> 注：セクション見出しは EN（「Pending」/「Processed」）、ES（「Pendientes」/「Procesadas」）、DE（「Offen」/「Verarbeitet」）、PT-BR（「Pendentes」/「Processadas」）、または JA（「未処理」/「処理済み」）のいずれでも可。読み取り時は柔軟に、書き込み時は既存ファイルのスタイルを維持。

## URL からの JD インテリジェント検出

1. **Playwright（推奨）：** `browser_navigate` + `browser_snapshot`。すべての SPA で動作。
2. **WebFetch（フォールバック）：** 静的ページ、または Playwright が利用できない場合。
3. **WebSearch（最終手段）：** JD をインデックスしているセカンダリポータルで検索。

**特殊ケース：**
- **LinkedIn**：ログインが必要な場合あり → `[!]` にマークし、候補者にテキストを貼り付けてもらう
- **PDF**：URL が PDF を指す場合、Read tool で直接読む
- **`local:` プレフィックス**：ローカルファイルを読む。例：`local:jds/linkedin-pm-ai.md` → `jds/linkedin-pm-ai.md` を読む
- **Wantedly / Green / Findy**：日本の主要プラットフォーム。Playwright でうまく動作
- **doda / リクナビNEXT / マイナビ転職**：日本の大手求人ポータル。通常 WebFetch でアクセス可能
- **ビズリーチ**：ハイクラス求人。ログインが必要な場合あり
- **LinkedIn JP**：グローバル LinkedIn と同じ制約 — ログインが必要な場合あり

## 自動採番

1. `node reserve-report-num.mjs` を実行して、次の連番をアトミックに予約します（標準出力から `{###}` が返されます）。
2. その番号を使用してレポートファイルを書き込みます。
3. レポートが書き込まれたら、`node reserve-report-num.mjs --release {###}` を実行してセンチネルを解放します。

## ソース同期

URL を処理する前に同期を確認：

```bash
node cv-sync-check.mjs
```

非同期がある場合、続行前に候補者に通知。
