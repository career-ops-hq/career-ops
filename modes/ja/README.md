# career-ops -- 日本語モード (`modes/ja/`)

このフォルダには、日本市場または日本語で運営される企業での求職活動を行う候補者向けに、career-ops の主要モードを日本語に翻訳したファイルが含まれています。

## いつこれらのモードを使うか？

以下のいずれかに該当する場合は `modes/ja/` を使用してください：

- 主に**日本語の求人**（Wantedly、Green、doda、リクナビNEXT、ビズリーチ、LinkedIn JP、Indeed JP、Findy など）に応募している
- **履歴書・職務経歴書の言語**が日本語、または求人に応じて日本語と英語を使い分けている
- 機械翻訳ではない、**自然な日本語のテック系表現**で書かれた回答やカバーレターが必要
- **日本市場特有の事項**に対応する必要がある：正社員 vs 業務委託、賞与（ボーナス）、退職金、有給休暇、試用期間、36協定、通勤手当、住宅手当、みなし残業、年俸制など

ほとんどの求人が英語の場合は、デフォルトの `modes/` を使ってください。英語モードでも Claude が日本語の求人を検出すれば自動的に対応しますが、日本市場の細かい慣習までは同じレベルで把握していません。

## どうやって有効化する？

career-ops にはコード上の「言語スイッチ」フラグはありません。代わりに 2 つの方法があります：

### 方法 1 -- セッション単位で指示

セッションの冒頭で Claude にこう伝えます：

> 「`modes/ja/` の日本語モードを使って。」

または

> 「評価と応募を日本語で。`modes/ja/_shared.md` と `modes/ja/kyujin.md` を読んで。」

Claude は `modes/` の代わりにこのフォルダのファイルを読み込みます。

### 方法 2 -- プロファイルで恒久設定

`config/profile.yml` に言語設定を追加します：

```yaml
language:
  primary: ja
  modes_dir: modes/ja
```

最初のセッションで Claude にこのフィールドを尊重するよう伝えてください（「`profile.yml` を見て、`language.modes_dir` を設定してある」）。以降、Claude は自動的に日本語モードを使用します。

> 注：`language.modes_dir` は慣習であり厳密なスキーマではありません。メンテナが別の構造にしたい場合、このフィールド名はいつでも変更される可能性があります。

## 何が翻訳されているか？

この最初のイテレーションでは、インパクトの大きい 4 つのモードをカバーしています：

| ファイル | 翻訳元 | 用途 |
|---------|-------|------|
| `_shared.md` | `modes/_shared.md` (EN) | 共通コンテキスト、アーキタイプ、グローバルルール、日本市場の特記事項 |
| `kyujin.md` | `modes/oferta.md` (ES) | 求人の完全評価（A-F ブロック） |
| `oubo.md` | `modes/apply.md` (EN) | 応募フォーム記入のライブアシスタント |
| `pipeline.md` | `modes/pipeline.md` (ES) | URL のインボックス / 求人の Second Brain |

残りのモード（`scan`、`batch`、`pdf`、`tracker`、`auto-pipeline`、`deep`、`contacto`、`ofertas`、`project`、`training`）は意図的にこの PR に含めていません。これらは主にツール配管、パス、設定コマンドで構成されており、言語非依存であるべきだからです。

コミュニティが日本語モードを採用すれば、今後の PR でさらにモードを翻訳します。

## 英語のまま残しているもの

これらは意図的に翻訳していません。標準的なテック用語だからです：

- `cv.md`、`pipeline`、`tracker`、`report`、`score`、`archetype`、`proof point`
- ツール名（`Playwright`、`WebSearch`、`WebFetch`、`Read`、`Write`、`Edit`、`Bash`）
- tracker のステータス値（`Evaluated`、`Applied`、`Interview`、`Offer`、`Rejected`）
- コードスニペット、ファイルパス、コマンド

モードは、東京・大阪・福岡の実際のエンジニアリングチームで使われているような自然な日本語テック表現を使います：地の文は日本語、定着しているテック用語は英語のままです。「pipeline」を「配管」と訳したり、「cv.md」を「履歴書.md」にしたりはしません。

## 参考用語集

モードを拡張・改変する際は、トーンの一貫性を保つためこの用語を参考にしてください：

| 英語 | 日本語（このコードベース） |
|-----|--------------------------|
| Job posting | 求人 / 求人票 / 職務記述書 |
| Application | 応募 |
| Cover letter | カバーレター / 志望動機書 |
| Resume / CV | 履歴書 / 職務経歴書 |
| Salary | 給与 / 年収 |
| Compensation | 報酬 / 待遇 |
| Skills | スキル |
| Interview | 面接 |
| Hiring manager | 採用責任者 / Hiring manager |
| Recruiter | 採用担当 / リクルーター |
| AI | AI（人工知能） |
| Requirements | 必須要件 / 歓迎要件 |
| Career history | 職務経歴 |
| Notice period | 退職予告期間 |
| Probation | 試用期間 |
| Vacation | 有給休暇 |
| Bonus | 賞与 / ボーナス |
| Full-time employment | 正社員 |
| Contractor | 業務委託 / フリーランス |
| Annual salary | 年俸制 |
| Health insurance | 健康保険 |
| Overtime allowance | 残業代 / 時間外手当 |
| Fixed overtime | みなし残業 |
| Commuting allowance | 通勤手当 |
| Housing allowance | 住宅手当 |
| Stock options | ストックオプション（そのまま使用） |
| Severance | 退職金 |

## 貢献方法

翻訳を改善したり、追加のモードを翻訳したりしたい場合：

1. `CONTRIBUTING.md` に沿って issue を立てて提案する
2. トーンの一貫性のため上記の用語集に従う
3. 自然で慣用的な翻訳を行う — 一語一語の直訳はしない
4. 構造要素（A-F ブロック、テーブル、コードブロック、ツール指示）は原文と完全に一致させる
5. PR を出す前に実際の日本の求人（Wantedly や LinkedIn JP など）でテストする
