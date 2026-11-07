# 面接スキル

面接準備を最初から最後まで支える、再利用可能なスキルのセット。

## スキル

| スキル | ファイル | 使う場面 |
|---|---|---|
| 面接準備プランナー | `plan.md` | 求人票（JD）と面接日をもとに、時間ブロック単位の構造化された準備プランを組み立てる |
| 模擬面接官 | `practice.md` | 模擬面接の質問を出し、構造化されたフィードバックを返す |
| 面接後デブリーフ | `debrief.md` | 実際の面接のあとにギャップを埋め、質問バンクを更新する |

## 関連スキル（親ディレクトリ `modes/` 内）

| スキル | ファイル | 使う場面 |
|---|---|---|
| 企業リサーチ | `../../interview-prep.md` | 面接の前に、特定の企業と職種について調べる |

## ファイルの前提

これらのスキルは、次のファイルが存在することを前提とする（career-ops の既定）：

| ファイル | 用途 |
|---|---|
| `cv.md` | 候補者の CV — 経験と proof point の source of truth |
| `article-digest.md` | ポートフォリオから抜き出した簡潔な proof point（任意） |
| `config/profile.yml` | 候補者のプロファイル — ターゲット職種、報酬、narrative |
| `modes/_profile.md` | 候補者の archetype、narrative、譲れない条件 |
| `interview-prep/story-bank.md` | 蓄積された STAR+R ストーリー |
| `interview-prep/question-bank.md` | ギャップを追跡する質問バンク（初回使用時に作成） |
| `interview-prep/interview-prep-guide.md` | 面接の一般原則（任意） |
| `interview-prep/{company}-{role}.md` | 職種別の準備ファイル |
| `interview-prep/sessions/*.md` | ラウンドごとのトランスクリプト。任意の `stated_priorities` front matter（面接官が述べた職種の優先事項）を debrief が書き込み、plan と practice が読む |
| `interview-prep/retracted-claims.md` | 候補者が擁護できないとして撤回した主張 — practice と debrief におけるハードゲート（形式：`**"[claim]"** ([context]). Reason: [one-line reason + correct framing if applicable].`） |
