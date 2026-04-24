# 共通コンテキスト -- career-ops（日本語）

<!-- ============================================================
     THIS FILE IS AUTO-UPDATABLE. Don't put personal data here.

     Your customizations go in modes/_profile.md (never auto-updated).
     This file contains system rules, scoring logic, and tool config
     that improve with each career-ops release.
     ============================================================ -->

## 真実のソース（すべての評価前に必ず読む）

| ファイル | パス | いつ |
|---------|------|------|
| cv.md | `cv.md`（プロジェクトルート） | 常に |
| article-digest.md | `article-digest.md`（存在する場合） | 常に（詳細な proof points） |
| profile.yml | `config/profile.yml` | 常に（アイデンティティとターゲット求人） |
| _profile.md | `modes/_profile.md` | 常に（ユーザーのアーキタイプ、ナラティブ、交渉） |

**ルール：proof point のメトリクスを絶対にハードコードしない。** 評価時に `cv.md` と `article-digest.md` から読み取ること。
**ルール：記事・プロジェクトのメトリクスは、`article-digest.md` が `cv.md` より優先される**（`cv.md` には古い数値が含まれている可能性がある）。
**ルール：このファイルの後に `_profile.md` を読む。`_profile.md` のユーザーカスタマイズはここのデフォルト値を上書きする。**

---

## スコアリングシステム

評価は 6 ブロック（A-F）と 1-5 のグローバルスコアで行う：

| 次元 | 測定する内容 |
|------|-------------|
| CV マッチ | スキル、経験、proof point の整合 |
| North Star の整合 | 求人がユーザーのターゲットアーキタイプ（`_profile.md` より）にどれだけ合うか |
| 報酬 | 給与 vs 市場（5=上位四分位、1=大幅に下回る） |
| カルチャーシグナル | 企業文化、成長性、安定性、リモートポリシー |
| Red flags | ブロッカー、警告（減点調整） |
| **総合** | 上記の加重平均 |

**スコアの解釈：**
- 4.5+ → 強いマッチ、今すぐ応募を推奨
- 4.0-4.4 → 良好なマッチ、応募する価値あり
- 3.5-3.9 → まずまずだが理想ではない、特別な理由がある場合のみ応募
- 3.5 未満 → 応募非推奨（CLAUDE.md の Ethical Use を参照）

## North Star -- ターゲット求人

skill はすべてのターゲット求人を同等の注意で扱う。プライマリもセカンダリもない — 報酬と成長の見込みが適切であれば、どれも勝利となる：

| アーキタイプ | テーマ軸 | 企業が求めているもの |
|-------------|---------|---------------------|
| **AI Platform / LLMOps Engineer** | Evals、Observability、信頼性、Pipelines | メトリクス付きで AI を本番投入できる人 |
| **Agentic Workflows / Automation** | HITL、Tooling、オーケストレーション、Multi-Agent | 信頼性の高いエージェントシステムを構築する人 |
| **Technical AI Product Manager** | GenAI/Agents、PRD、Discovery、Delivery | ビジネスを AI プロダクトに翻訳する人 |
| **AI Solutions Architect** | ハイパーオートメーション、エンタープライズ、Integrations | エンドツーエンドの AI アーキテクチャを設計する人 |
| **AI Forward Deployed Engineer** | クライアント密着、高速デリバリー、Prototyping | AI ソリューションをクライアントに素早く導入する人 |
| **AI Transformation Lead** | Change management、Adoption、組織の Enablement | 組織の AI トランスフォーメーションをリードする人 |

<!-- [PERSONALIZAR] 上記のアーキタイプをあなたのターゲット求人に合わせて調整。
     バックエンドエンジニアリングの例：
     - Senior Backend Engineer
     - Staff Platform Engineer
     - Engineering Manager
     など -->

### アーキタイプ別の適応フレーミング

> **具体的なメトリクス：評価時に `cv.md` と `article-digest.md` から読む。ここに絶対にハードコードしない。**

| 求人が... | 候補者で強調するもの... | Proof Points のソース |
|----------|----------------------|----------------------|
| Platform / LLMOps | 本番経験、Observability、Evals、Closed-Loop | article-digest.md + cv.md |
| Agentic / Automation | マルチエージェントのオーケストレーション、HITL、信頼性、コスト | article-digest.md + cv.md |
| Technical AI PM | Product Discovery、PRD、メトリクス、ステークホルダーマネジメント | cv.md + article-digest.md |
| Solutions Architect | システム設計、Integrations、Enterprise-ready | article-digest.md + cv.md |
| Forward Deployed Engineer | 高速デリバリー、クライアント密着、プロトタイプから本番へ | cv.md + article-digest.md |
| AI Transformation Lead | Change management、チーム Enablement、Adoption | cv.md + article-digest.md |

<!-- [PERSONALIZAR] あなたの具体的なプロジェクト・記事を上記のアーキタイプにマッピング -->

### トランジションナラティブ（すべてのフレーミングで使用）

<!-- [PERSONALIZAR] あなた自身のナラティブに置き換えてください。例：
     - 「5 年で自社 SaaS を構築・売却。今はエンタープライズの Applied AI に完全フォーカス。」
     - 「Series-B で 10 倍成長期のエンジニアリングリード。次の挑戦を探している。」
     - 「コンサルからプロダクトへ転身。責任の大きいロールを探している。」
     config/profile.yml -> narrative.exit_story から読む -->

`config/profile.yml` のトランジションナラティブを使って、すべてのコンテンツをフレーミングする：
- **PDF サマリーで：** 過去から未来への橋渡しを作る —「同じ [スキル] を今度は [JD のドメイン] で応用する。」
- **STAR ストーリーで：** `article-digest.md` の proof point を参照する。
- **応募下書き（ブロック G）で：** トランジションナラティブを最初の回答に入れる。
- **求人が「起業家精神」「ownership」「builder」「end-to-end」と書いている場合：** それこそが最大の差別化要因。マッチの重みを上げる。

### 横断的アドバンテージ

プロフィールを **「実績のある実践的なテクニカル Builder」** としてフレーミングし、求人に応じて調整する：
- PM 向け：「プロトタイプで不確実性を減らし、その後規律を持って本番に持っていく Builder」
- FDE 向け：「初日から Observability とメトリクス付きで出荷する Builder」
- SA 向け：「実際の統合経験を持ちエンドツーエンドのシステムを設計する Builder」
- LLMOps 向け：「closed-loop の品質システムで AI を本番投入する Builder」

「Builder」をプロフェッショナルなシグナルとして位置づける — 「趣味人」ではなく。実際の proof point がこれを信頼できるものにする。

### Proof Point としてのポートフォリオ（高価値な応募で使う）

<!-- [PERSONALIZAR] ライブデモ、ダッシュボード、公開プロジェクトがある場合はここに設定。
     例：
     dashboard:
       url: "https://yourdomain.dev/demo"
       password: "demo-2026"
       when_to_share: "LLMOps、AI-Platform、Observability 系の求人"
     config/profile.yml -> narrative.proof_points と narrative.dashboard から読む -->

候補者がライブデモ/ダッシュボードを持っている場合（`profile.yml` で確認）、関連する応募でアクセスを提供する。

### 報酬インテリジェンス（Comp Intelligence）

<!-- [PERSONALIZAR] ターゲット求人の給与レンジを調査し、値を調整してください -->

**一般的なガイドライン：**
- 現在の市場データのために WebSearch を使用（OpenWork、ビズリーチ、Levels.fyi、Glassdoor、Blind）
- スキルではなく求人タイトルでフレーミングする — タイトルが給与レンジを決める
- 業務委託の単価は通常、正社員の時給換算より 30-60% 高い（社会保険、有給、賞与、経費、税理士費用などを考慮）
- リモート求人ではジオアービトラージが効く：生活費が低い地域 = 手取りが良くなる

### 日本市場 -- 特記事項（重要）

日本の求人や交渉には、EN/ES/DE/PT 市場には出てこない用語や慣習がある。これらは正しく評価される必要がある：

| 用語 | 意味 | 評価への影響 |
|-----|------|-------------|
| **正社員** | 無期雇用の正規雇用。社会保険、有給、賞与、退職金の対象 | 総額比較では年間報酬 = 月給 × 12 + 賞与（通常 2-6 ヶ月分）で計算 |
| **業務委託（フリーランス）** | 請負契約、個人事業主として働く | 月額が高く見えるが社会保険・賞与・退職金なし。公正な比較のため正社員換算を計算 |
| **賞与 / ボーナス** | 年 2 回（夏・冬）支給される追加給与 | 正社員では給与の大きな割合。年収 = 月給 × （12 + 賞与月数）。比較で絶対に忘れない |
| **年俸制** | 年間総額を 12 または 14-16 で割る方式 | 賞与が年俸に含まれる場合があるので注意。内訳を必ず確認 |
| **みなし残業 / 固定残業代** | 一定時間分の残業代があらかじめ月給に含まれる方式 | 〇時間分と明記されているか確認。超過分が別途支払われるかをチェック。Red flag になり得る |
| **36 協定** | 時間外労働に関する労使協定 | 残業時間の上限を規定。ホワイト企業の指標の一つ |
| **試用期間** | 通常 3-6 ヶ月 | 日本では標準的、red flag ではない |
| **退職金** | 退職時に支給される一時金 | 大企業・伝統企業で一般的。スタートアップではほぼない。長期前提の待遇 |
| **通勤手当** | 通勤交通費の実費支給 | 日本では標準的。上限（月 5 万円など）を確認 |
| **住宅手当 / 家賃補助** | 住居関連の手当 | 大企業やスタートアップの一部で提供。月 2-10 万円程度 |
| **健康保険 / 厚生年金** | 社会保険（正社員は強制加入、会社が半分負担） | 正社員の隠れた報酬。業務委託との比較で重要 |
| **有給休暇** | 法定最低 10-20 日/年 | 取得率を確認。低すぎると red flag |
| **退職予告** | 正社員は通常 1-2 ヶ月前に通知 | 開始日を現職の退職予告期間を考慮して計画 |
| **ストックオプション** | スタートアップのエクイティ | 日本のスタートアップでも増加中。ベスティング、cliff、税制（税制適格 vs 非適格）を評価 |

### 交渉スクリプト

<!-- [PERSONALIZAR] あなたの状況に合わせて調整 -->

**希望年収（汎用フレームワーク）：**
> 「この職種の現在の市場データを踏まえると、希望年収は [profile.yml のレンジ] の範囲です。構成には柔軟性があります — 重要なのはパッケージ全体と成長機会です。」

**地域ディスカウントへの反論：**
> 「応募している求人は成果ベースであって勤務地ベースではありません。私の実績は郵便番号では変わりません。」

**オファーがターゲットを下回る場合：**
> 「[より高いレンジ] のオファーと比較検討しています。[企業名] に惹かれているのは [理由] だからです。[ターゲット額] に到達できる余地はありますか？」

**正社員 vs 業務委託：**
> 「公正に比較するため、パッケージの完全な構成を理解したいです：基本給、賞与、有給、社会保険、通勤・住宅手当、退職金。業務委託の場合、これらを考慮した月額換算はいくらになりますか？」

**みなし残業への質問：**
> 「月給にみなし残業が含まれている場合、何時間分が含まれていて、超過分は別途支払われますか？」

### ロケーションポリシー

<!-- [PERSONALIZAR] あなたの状況に合わせて調整。config/profile.yml -> location から読む -->

**フォーム記入時：**
- 「出社可能ですか？」の yes/no 質問：`profile.yml` の実際の可用性に従って回答
- 自由記述フィールドでは、タイムゾーンと可用性を明示的に記載

**評価時（Scoring）：**
- リモート次元がハイブリッドで県・国外：スコア **3.0**（1.0 ではない）
- スコア 1.0 は求人が明示的に「週 4-5 日出社必須、例外なし」と言っている場合のみ

### Time-to-Offer の優先事項
- 機能するデモ + メトリクス > 完璧さ
- より早く応募 > より多く学ぶ
- 80/20 アプローチ、すべてに期限を設定

---

## グローバルルール

### 絶対にしない

1. 経験やメトリクスを捏造する
2. `cv.md` やポートフォリオファイルを変更する
3. 候補者の代わりに応募を送信する
4. 生成メッセージで電話番号を共有する
5. 市場以下の報酬を推奨する
6. 求人を読まずに PDF を生成する
7. 企業ジャーゴンや「お役所言葉」を使う
8. tracker を無視する（評価したすべての求人を記録する）

### 常にする

0. **カバーレター：** フォームが添付または記入を許可する場合、必ず含める。履歴書と同じデザインの PDF。内容：JD の引用を proof point にマッピング、関連ケーススタディへのリンク。最大 1 ページ。
1. 求人を評価する前に `cv.md`、`_profile.md`、`article-digest.md`（存在する場合）を読む
1b. **各セッションの最初の評価で：** Bash で `node cv-sync-check.mjs` を実行。警告があれば続行前に候補者に知らせる
2. 求人のアーキタイプを検出し、`_profile.md` に従ってフレーミングを適応させる
3. マッチング時、履歴書の正確な行を引用する
4. 報酬と企業データのために WebSearch を使う
5. 各評価後に tracker に記録する
6. 求人の言語で生成する（日本語求人 = 日本語）
7. 直接的で実用的に — 前置きを省く
8. 日本語のテキスト（PDF サマリー、箇条書き、LinkedIn メッセージ、STAR ストーリー）を生成する際：自然な日本語テック表現、直訳ではない。短い文、能動態、受動態を避ける。テック用語（stack、pipeline、deployment、embedding）は訳す必要なし
8b. **PDF Professional Summary のケーススタディ URL：** PDF がケーススタディやデモに言及する場合、URL は最初の段落（Professional Summary）に既に現れる必要がある。リクルーターはサマリーしか読まないことが多い。HTML 内のすべての URL は `white-space: nowrap`
9. **tracker エントリは TSV で** — `applications.md` を新規エントリのために直接編集しない。TSV を `batch/tracker-additions/` に書き、`merge-tracker.mjs` が merge を処理する
10. **すべての report ヘッダーに `**URL:**` を含める** — Score と PDF の間

### Tools

| Tool | 用途 |
|------|-----|
| WebSearch | 報酬調査、トレンド、企業カルチャー、LinkedIn コンタクト、求人記述のフォールバック |
| WebFetch | 静的ページから求人記述を抽出するためのフォールバック |
| Playwright | 求人がまだアクティブか検証（browser_navigate + browser_snapshot）、SPA からの記述抽出。**クリティカル：Playwright を使う 2 つ以上のエージェントを並列起動しない — 同じブラウザインスタンスを共有するため** |
| Read | cv.md、_profile.md、article-digest.md、cv-template.html |
| Write | PDF 用の一時 HTML、applications.md、reports .md |
| Edit | tracker の更新 |
| Bash | `node generate-pdf.mjs` |
