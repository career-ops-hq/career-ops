# Career-Ops

[English](README.md) | [Español](README.es.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md) | [Українська](README.ua.md) | [Русский](README.ru.md) | [Polski](README.pl.md) | [العربية](README.ar.md)

<p align="center">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="Career-Ops マルチエージェント求職システム" width="800"></a>
</p>

<p align="center">
  <em>何ヶ月も泥臭く求職活動をしてきた。だから、当時欲しかったシステムを自分で作った。</em><br>
  企業はAIで候補者をフィルタリングしている。<strong>ならば候補者にもAIを渡し、企業を<em>選ばせる</em>側にした。</strong><br>
  <em>そして今、それをオープンソースにした。</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/25195" target="_blank"><img src="https://trendshift.io/api/badge/repositories/25195" alt="santifer%2Fcareer-ops | Trendshift" style="width: 245px; height: 54px; vertical-align: middle;" width="245" height="54"/></a>
  &nbsp;&nbsp;
  <a href="https://www.producthunt.com/products/santifer-io?utm_source=badge-featured&utm_medium=badge" target="_blank"><img src="docs/press/producthunt.svg" alt="Career-Ops on Claude | Product Hunt" style="width: 206px; height: 54px; vertical-align: middle;" width="206" height="54"/></a>
</p>

<p align="center"><sub>掲載メディア</sub></p>

<p align="center">
  <a href="https://wired.com.gr/article/to-ai-ergaleio-pou-fernei-epanastasi-ston-tropo-pou-psachnoume-douleia/" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/wired-dark.svg"><img src="docs/press/wired.svg" alt="WIRED" height="32"></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.businessinsider.com/how-i-built-tool-filter-job-listings-landed-head-ai-2026-4" rel="noopener noreferrer nofollow"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/press/business-insider-dark.svg"><img src="docs/press/business-insider.svg" alt="Business Insider" height="32"></picture></a>
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops デモ" width="800">
</p>

<p align="center"><strong>740件以上の求人を評価 · 100件以上のパーソナライズCVを生成 · 理想のポジションを獲得</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/コミュニティに参加-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@santifer/career-ops"><img src="https://img.shields.io/npm/dt/@santifer/career-ops?style=for-the-badge&logo=npm&color=CB3837&label=npx%20installs" alt="npm installs"></a></p>

<p align="center">
  <sub>使用技術</sub><br>
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Gemini_CLI-4285F4?style=flat&logo=google&logoColor=white" alt="Gemini CLI">
  <img src="https://img.shields.io/badge/Codex-412991?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Qwen-615CED?style=flat" alt="Qwen">
  <img src="https://img.shields.io/badge/GitHub_Copilot-000?style=flat&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <br>
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white" alt="Bubble Tea">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="TRADEMARK.md"><img src="https://img.shields.io/badge/Trademark-Policy-blue.svg" alt="Trademark Policy"></a>
</p>

## これは何？

Career-Opsは、あらゆるAIコーディングCLIを本格的な求職コマンドセンターに変えます。スプレッドシートで応募を手動管理する代わりに、AIによる以下のパイプラインが手に入ります:

- **オファーを評価** -- 構造化されたA-Fスコアリングシステム（10項目の重み付け評価軸）
- **テーラーメイドPDFを生成** -- 各求人票に合わせてATS最適化されたCV
- **求人ポータルを自動スキャン** （Greenhouse、Ashby、Lever、企業ページ）
- **バッチ処理** -- サブエージェントで10件以上のオファーを並列評価
- **すべてを一元管理** -- 整合性チェック付きの単一のデータソース

> **重要: これは「とにかく数を撃つ」ツールではありません。** career-opsはフィルターです -- 何百もの求人の中から、あなたの時間を割く価値のある数件を見つけ出すためのツールです。本システムは4.0/5未満のスコアの求人への応募を強く非推奨としています。あなたの時間もリクルーターの時間も貴重です。送信前に必ず内容を確認してください。

career-opsはエージェンティックです: Claude CodeがPlaywrightで求人ページを操作し、（キーワードマッチではなく）あなたのCVと求人票を突き合わせて適合度を推論し、求人ごとにレジュメを最適化します。

> **ご注意: 最初の評価はあまり良くありません。** システムはまだあなたのことを知らないからです。コンテキストを与えてください -- CV、キャリアストーリー、実績の裏付け、好み、得意なこと、避けたいこと。育てれば育てるほど精度が上がります。新人リクルーターをオンボーディングするのと同じです: 最初の1週間はあなたについて学ぶ必要があり、その後かけがえのない存在になります。

このシステムは、740件以上の求人を評価し、100件以上のテーラーメイドCVを生成し、Head of Applied AIのポジションを獲得した人物によって作られました。[詳細なケーススタディを読む](https://santifer.io/career-ops-system)。

## 機能

| 機能                     | 説明                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **自動パイプライン**     | URLを貼るだけで、評価 + PDF + トラッカー記録が完了                                                                               |
| **6ブロック評価**        | 役割サマリー、CVマッチ、レベル戦略、報酬調査、パーソナライズ、面接準備（STAR+R） -- さらに詐欺やゴーストジョブを検出するブロックGの求人正当性チェック |
| **面接ストーリーバンク** | 評価を重ねるごとにSTAR+Reflectionストーリーを蓄積 -- あらゆる行動面接質問に答える5〜10のマスターストーリー                       |
| **交渉スクリプト**       | 給与交渉のフレームワーク、地域ディスカウント反論、競合オファーの活用                                                             |
| **ATS向けPDF生成**       | Space Grotesk + DM Sansデザインのキーワード注入型CV                                                                              |
| **ポータルスキャナー**   | 45社以上事前設定済み（Anthropic、OpenAI、ElevenLabs、Retool、n8n...) + Ashby、Greenhouse、Lever、Wellfound横断のカスタムクエリ   |
| **バッチ処理**           | `claude -p`ワーカーによる並列評価                                                                                                |
| **ダッシュボードTUI**    | パイプラインを閲覧・フィルター・ソートするターミナルUI                                                                           |
| **Human-in-the-Loop**    | AIは評価と推奨を行い、決定と実行はあなたが行います。システムが応募を自動送信することは絶対になく、最終判断は常にあなたが下します |
| **パイプラインの整合性** | 自動マージ、重複排除、ステータス正規化、ヘルスチェック                                                                           |

## クイックスタート

**最速の方法 — コマンド1つ:**

```bash
npx @santifer/career-ops init
```

> 💡 `npx` は [Node.js](https://nodejs.org) に付属しています — グローバルに何もインストールせず、
> インストーラーを一度だけ実行します。まだNodeがない場合は、先にインストールしてください。
> （すでにClaude Code / Gemini / Codex CLIを使っているなら、もう持っています。）

これにより最新リリースが `./career-ops` にクローンされ、依存関係がインストールされます。その後:

```bash
cd career-ops
claude   # or gemini / codex / qwen / opencode — ここでAI CLIを起動
```

**初回起動時、career-opsが対話するだけでセットアップ（CV、プロフィール、対象ロール）をご案内します。手で編集するものは何もありません。**

<details>
<summary><b>手動でセットアップしたいですか？（git clone）</b></summary>

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # PDF生成にのみ必要
claude   # AI CLIを起動 — 初回起動時にオンボーディングします
```

</details>

> **このシステムはClaude自身がカスタマイズする前提で設計されています。** モード、アーキタイプ、スコアリング重み、交渉スクリプト -- すべてClaudeに依頼すれば変更してくれます。Claudeは自分が使うのと同じファイルを読むので、どこを編集すればよいか正確に把握しています。

完全なセットアップガイドは [docs/SETUP.md](docs/SETUP.md) を参照してください。

## 使い方

career-opsは複数のモードを持つ単一のスラッシュコマンドです:

```
/career-ops                → 利用可能なすべてのコマンドを表示
/career-ops {求人票を貼る}  → 完全自動パイプライン（評価 + PDF + トラッカー）
/career-ops scan           → ポータルをスキャンして新しい求人を探す
/career-ops pdf            → ATS最適化CVを生成
/career-ops batch          → 複数オファーをバッチ評価
/career-ops tracker        → 応募ステータスを表示
/career-ops apply          → AIで応募フォームを入力
/career-ops pipeline       → 保留中のURLを処理
/career-ops contacto       → LinkedInアウトリーチメッセージ
/career-ops deep           → 企業の深掘りリサーチ
/career-ops training       → コース/資格を評価
/career-ops project        → ポートフォリオプロジェクトを評価
```

または、単に求人URLや記述を直接貼り付けるだけ -- career-opsが自動検知してフルパイプラインを実行します。

## 仕組み

```
求人URLまたは記述を貼り付け
        │
        ▼
┌──────────────────┐
│  アーキタイプ     │  分類: LLMOps / Agentic / PM / SA / FDE / Transformation
│  検出            │
└────────┬─────────┘
         │
┌────────▼─────────┐
│  A-F 評価        │  マッチ度、ギャップ、報酬調査、STARストーリー
│  (cv.mdを読む)   │
└────────┬─────────┘
         │
    ┌────┼────┐
    ▼    ▼    ▼
 レポート PDF トラッカー
  .md   .pdf   .tsv
```

## 事前設定済みポータル

スキャナーには **45社以上** のスキャン対象企業と、主要求人ボード横断の **19の検索クエリ** が事前設定されています。`templates/portals.example.yml` を `portals.yml` にコピーして、独自の企業を追加してください:

**AIラボ:** Anthropic、OpenAI、Mistral、Cohere、LangChain、Pinecone
**ボイスAI:** ElevenLabs、PolyAI、Parloa、Hume AI、Deepgram、Vapi、Bland AI
**AIプラットフォーム:** Retool、Airtable、Vercel、Temporal、Glean、Arize AI
**コンタクトセンター:** Ada、LivePerson、Sierra、Decagon、Talkdesk、Genesys
**エンタープライズ:** Salesforce、Twilio、Gong、Dialpad
**LLMOps:** Langfuse、Weights & Biases、Lindy、Cognigy、Speechmatics
**オートメーション:** n8n、Zapier、Make.com
**欧州:** Factorial、Attio、Tinybird、Clarity AI、Travelperk

**検索対象の求人ボード:** Ashby、Greenhouse、Lever、Wellfound、Workable、RemoteFront

## ダッシュボードTUI

内蔵のターミナルダッシュボードで、パイプラインを視覚的に閲覧できます:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

機能: 6つのフィルタータブ、4つのソートモード、グループ表示/フラット表示、遅延読み込みプレビュー、インラインステータス変更。

## プロジェクト構成

```
career-ops/
├── CLAUDE.md                    # エージェントの指示
├── cv.md                        # あなたのCV（自分で作成）
├── article-digest.md            # あなたの実績の裏付け（任意）
├── config/
│   └── profile.example.yml      # プロフィールのテンプレート
├── modes/                       # 14個のスキルモード
│   ├── _shared.md               # 共有コンテキスト（ここをカスタマイズ）
│   ├── oferta.md                # 単一オファー評価
│   ├── pdf.md                   # PDF生成
│   ├── scan.md                  # ポータルスキャナー
│   ├── batch.md                 # バッチ処理
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS最適化CVテンプレート
│   ├── portals.example.yml      # スキャナー設定テンプレート
│   └── states.yml               # 正規ステータス
├── batch/
│   ├── batch-prompt.md          # 自己完結型ワーカープロンプト
│   └── batch-runner.sh          # オーケストレータースクリプト
├── dashboard/                   # Go製TUIパイプラインビューア
├── data/                        # 追跡データ（gitignore対象）
├── reports/                     # 評価レポート（gitignore対象）
├── output/                      # 生成PDF（gitignore対象）
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # セットアップ、カスタマイズ、アーキテクチャ
└── examples/                    # サンプルCV、レポート、実績の裏付け
```

## 技術スタック

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **エージェント**: Claude Code（カスタムスキルとモード付き）
- **PDF**: Playwright/Puppeteer + HTMLテンプレート
- **スキャナー**: Playwright + Greenhouse API + WebSearch
- **ダッシュボード**: Go + Bubble Tea + Lipgloss（Catppuccin Mochaテーマ）
- **データ**: Markdownテーブル + YAML設定 + TSVバッチファイル

## 同じくオープンソース

- **[cv-santiago](https://github.com/santifer/cv-santiago)** -- AIチャットボット、LLMOpsダッシュボード、ケーススタディ付きのポートフォリオサイト（santifer.io）。求職活動と並行して提示するポートフォリオが必要なら、フォークして自分のものにしてください。

## 作者について

Santiagoです -- Head of Applied AI、元創業者（自分の名前を冠した事業を立ち上げて売却、その事業は今も稼働中）。career-opsは自分自身の求職活動を管理するために作りました。結果、現職を獲得することに成功しました。

ポートフォリオと他のオープンソースプロジェクト → [santifer.io](https://santifer.io)

## Star History

<a href="https://www.star-history.com/?repos=santifer%2Fcareer-ops&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
 </picture>
</a>

## 免責事項

**career-opsはローカルで動作するオープンソースツールです — ホステッドサービスではありません。** 本ソフトウェアを使用することにより、以下を承諾したものとみなされます:

1. **データはあなたが管理します。** CV、連絡先、個人情報はあなたのマシン上にとどまり、あなたが選択したAIプロバイダー（Anthropic、OpenAIなど）に直接送信されます。当方はあなたのデータを収集、保存、アクセスすることは一切ありません。
2. **AIはあなたが管理します。** デフォルトのプロンプトはAIに応募の自動送信を行わないよう指示していますが、AIモデルは予測できない挙動をする場合があります。プロンプトを変更したり、別のモデルを使用する場合は自己責任でお願いします。**送信前に必ずAI生成コンテンツの正確性を確認してください。**
3. **第三者の利用規約を遵守してください。** 本ツールは、あなたが操作する求人ポータル（Greenhouse、Lever、Workday、LinkedInなど）の利用規約に従って使用する必要があります。本ツールを使って雇用主にスパムを送ったり、ATSシステムに過負荷をかけたりしてはいけません。
4. **保証はありません。** 評価はあくまで推奨であり、真実ではありません。AIモデルはスキルや経験を幻覚（ハルシネーション）する可能性があります。作成者は雇用結果、応募の不採用、アカウント制限、その他いかなる結果についても責任を負いません。

詳細は [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md) を参照してください。本ソフトウェアは [MITライセンス](LICENSE) のもと「現状のまま」提供され、いかなる保証もありません。

## ライセンス

MIT

## つながりましょう

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
