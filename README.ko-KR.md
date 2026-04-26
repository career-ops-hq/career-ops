# Career-Ops

[English](README.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [한국어](README.ko-KR.md) | [日本語](README.ja.md) | [Русский](README.ru.md) | [简体中文](README.cn.md) | [繁體中文](README.zh-TW.md)

<p align="center">
  <a href="https://x.com/santifer"><img src="docs/hero-banner.jpg" alt="Career-Ops -- 멀티 에이전트 취업 시스템" width="800"></a>
</p>

<p align="center">
  <em>수개월간의 비효율적인 수동 지원 끝에, 직접 구직 파이프라인 시스템을 설계했습니다.</em><br>
  기업은 AI로 지원자를 걸러냅니다. <strong>저는 지원자에게 AI를 줘서 <em>기업을 고르게</em> 했습니다.</strong><br>
  <em>이제 오픈소스입니다.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/OpenCode-111827?style=flat&logo=terminal&logoColor=white" alt="OpenCode">
  <img src="https://img.shields.io/badge/Codex_(soon)-6B7280?style=flat&logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white" alt="Playwright">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT">
  <a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord"></a>
  <br>
  <img src="https://img.shields.io/badge/EN-blue?style=flat" alt="EN">
  <img src="https://img.shields.io/badge/ES-red?style=flat" alt="ES">
  <img src="https://img.shields.io/badge/DE-grey?style=flat" alt="DE">
  <img src="https://img.shields.io/badge/FR-blue?style=flat" alt="FR">
  <img src="https://img.shields.io/badge/PT--BR-green?style=flat" alt="PT-BR">
  <img src="https://img.shields.io/badge/KO-white?style=flat" alt="KO">
</p>

---

<p align="center">
  <img src="docs/demo.gif" alt="Career-Ops 데모" width="800">
</p>

<p align="center"><strong>740개 이상의 채용 공고 평가 · 100개 이상의 맞춤형 이력서 생성 · 꿈의 직장 1곳 합격</strong></p>

<p align="center"><a href="https://discord.gg/8pRpHETxa4"><img src="https://img.shields.io/badge/커뮤니티_참여하기-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a></p>

## 이게 뭔가요

Career-Ops는 AI 코딩 CLI를 취업 활동 전체를 관리하는 커맨드 센터로 바꿔줍니다. 스프레드시트에서 수동으로 지원 현황을 관리하는 대신, AI 파이프라인이 알아서 처리합니다:

- **공고 평가** -- 구조화된 A-F 스코어링 (10개 가중 평가 항목)
- **맞춤형 PDF 생성** -- JD별로 최적화된 ATS 이력서
- **포털 자동 스캔** -- Greenhouse, Ashby, Lever, 기업 채용 페이지
- **일괄 처리** -- 서브 에이전트로 10개 이상의 공고를 병렬 평가
- **통합 추적** -- 무결성 검사가 포함된 단일 데이터 소스

> **중요: 이 도구는 무차별 지원 도구가 아닙니다.** Career-ops는 필터입니다 -- 수백 개의 공고 중 당신의 시간을 투자할 가치가 있는 소수의 공고를 찾아줍니다. 4.0/5 미만의 공고에는 지원하지 않는 것을 강력히 권장합니다. 당신의 시간도, 채용 담당자의 시간도 소중합니다. 제출 전에 항상 직접 검토하세요.

Career-ops는 에이전트 기반으로 작동합니다: Claude Code가 Playwright로 채용 페이지를 탐색하고, 키워드 매칭이 아닌 이력서와 JD를 비교 분석하여 적합도를 판단하고, 공고별로 이력서를 맞춤 생성합니다.

> **참고: 처음 몇 번의 평가는 정확하지 않을 수 있습니다.** 시스템이 아직 당신을 모르기 때문입니다. 이력서, 커리어 스토리, 주요 성과, 선호도, 잘하는 것, 피하고 싶은 것 등 맥락을 알려주세요. 정보를 줄수록 더 정확해집니다. 새로운 리크루터를 온보딩한다고 생각하세요: 첫 주는 당신을 파악하는 시간이고, 그 이후부터 진가를 발휘합니다.

740개 이상의 채용 공고를 평가하고, 100개 이상의 맞춤 이력서를 생성하여, Head of Applied AI 포지션에 합격한 사람이 직접 만들었습니다. [전체 케이스 스터디 읽기](https://santifer.io/career-ops-system).

## 주요 기능

| 기능 | 설명 |
|------|------|
| **자동 파이프라인** | URL 입력만으로 [평가 → PDF 생성 → 트래커 등록] 전 과정 자동화 |
| **6단계 정밀 평가** | 직무 요약, 이력서 매치, 레벨링 전략, 연봉 리서치, 개인화, 면접 준비 (STAR+R) |
| **면접 스토리 뱅크** | 평가 데이터 기반 STAR+Reflection 스토리 축적 -- 어떤 행동 면접 질문도 커버하는 5~10개의 마스터 답변 생성 |
| **협상 전략 스크립트** | 연봉 협상 프레임워크, 거주지 기반 연봉 차등(Geographic Discount) 대응 논리, 경쟁 오퍼 활용 전략 |
| **ATS PDF 생성** | Space Grotesk + DM Sans 디자인, 키워드가 주입된 이력서 |
| **포털 스캐너** | 45개 이상의 기업 사전 설정 (Anthropic, OpenAI, ElevenLabs, Retool, n8n 등) + Ashby, Greenhouse, Lever, Wellfound 전반의 커스텀 검색 |
| **일괄 처리** | `claude -p` 워커로 병렬 평가 |
| **Dashboard TUI** | 터미널 UI에서 파이프라인 탐색, 필터링, 정렬 |
| **Human-in-the-Loop** | AI가 평가하고 추천하면, 당신이 판단하고 행동합니다. 시스템은 절대 지원서를 자동 제출하지 않습니다 -- 최종 결정은 항상 당신의 몫 |
| **파이프라인 무결성** | 자동 병합, 중복 제거, 상태 정규화, 헬스 체크 |

## 빠른 시작

```bash
# 1. 클론 및 설치
git clone https://github.com/santifer/career-ops.git
cd career-ops && npm install
npx playwright install chromium   # PDF 렌더링을 위한 브라우저 엔진 설치

# 2. 설정 확인
npm run doctor                     # 모든 사전 요구사항 및 환경 변수 검증

# 3. 설정
cp config/profile.example.yml config/profile.yml  # 사용자 정보로 수정
cp templates/portals.example.yml portals.yml       # 기업 목록 커스터마이즈

# 4. 이력서 추가
# 프로젝트 루트에 'cv.md' 파일을 생성하고 마크다운으로 이력서를 작성하세요.

# 5. Claude로 개인화
claude   # 이 디렉토리에서 Claude Code 실행

# Claude에게 시스템을 맞춤 설정해달라고 요청:
# "Change the archetypes to backend engineering roles"
# "Translate the modes to English"
# "Add these 5 companies to portals.yml"
# "Update my profile with this CV I'm pasting"

# 6. 사용 시작
# 채용 공고 URL을 붙여넣거나 /career-ops 실행
```

> **이 시스템은 Claude가 직접 커스터마이즈하도록 설계되었습니다.** 모드, 아키타입, 스코어링 가중치, 협상 스크립트 -- 그냥 요청하세요. Claude가 사용하는 파일을 직접 읽기 때문에, 무엇을 수정해야 하는지 정확히 알고 있습니다.

자세한 설정 가이드는 [docs/SETUP.md](docs/SETUP.md)를 참고하세요.

## 사용법

Career-ops는 다양한 모드를 가진 하나의 슬래시 커맨드입니다:

```
/career-ops                → 사용 가능한 모든 명령어 표시
/career-ops {JD 붙여넣기}  → 전체 자동 파이프라인 (평가 + PDF + 트래커)
/career-ops scan           → 포털에서 새 공고 스캔
/career-ops pdf            → ATS 최적화 이력서 생성
/career-ops batch          → 여러 공고 일괄 평가
/career-ops tracker        → 지원 현황 확인
/career-ops apply          → AI로 지원서 양식 작성
/career-ops pipeline       → 대기 중인 URL 처리
/career-ops contacto       → LinkedIn 아웃리치 메시지
/career-ops deep           → 기업 심층 리서치
/career-ops training       → 교육 및 자격증 가치 평가
/career-ops project        → 포트폴리오 프로젝트 평가
```

채용 공고 URL이나 설명을 바로 붙여넣어도 됩니다 -- career-ops가 자동으로 감지하여 전체 파이프라인을 실행합니다.

## 작동 원리

```
채용 공고 URL 또는 설명을 붙여넣기
          │
          ▼
┌────────────────────────┐
│  아키타입 감지           │  직무 페르소나(Archetype) 분류: LLMOps / Agentic / PM / SA / FDE / Transformation
└──────────┬─────────────┘
           │
┌──────────▼─────────────┐
│  A-F 평가               │  이력서 기반 매칭도 및 갭 분석, 연봉 리서치, STAR 스토리
│  (cv.md 참조)           │
└──────────┬─────────────┘
           │
      ┌────┼────┐
      ▼    ▼    ▼
   Report  PDF  Tracker
    .md   .pdf   .tsv
```

## 사전 설정된 포털

스캐너에는 **45개 이상의 기업**과 주요 채용 보드에 걸친 **19개의 검색 쿼리**가 사전 설정되어 있습니다. `templates/portals.example.yml`을 `portals.yml`로 복사하고 원하는 기업을 추가하세요:

**AI Labs:** Anthropic, OpenAI, Mistral, Cohere, LangChain, Pinecone
**Voice AI:** ElevenLabs, PolyAI, Parloa, Hume AI, Deepgram, Vapi, Bland AI
**AI Platforms:** Retool, Airtable, Vercel, Temporal, Glean, Arize AI
**Contact Center:** Ada, LivePerson, Sierra, Decagon, Talkdesk, Genesys
**Enterprise:** Salesforce, Twilio, Gong, Dialpad
**LLMOps:** Langfuse, Weights & Biases, Lindy, Cognigy, Speechmatics
**Automation:** n8n, Zapier, Make.com
**European:** Factorial, Attio, Tinybird, Clarity AI, Travelperk

**검색 대상 채용 보드:** Ashby, Greenhouse, Lever, Wellfound, Workable, RemoteFront

## Dashboard TUI

내장 터미널 대시보드로 파이프라인을 시각적으로 탐색할 수 있습니다:

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..
```

기능: 6개의 필터 탭, 4가지 정렬 모드, 그룹/플랫 뷰, 지연 로딩 미리보기, 인라인 상태 변경.

## 프로젝트 구조

```
career-ops/
├── CLAUDE.md                    # 에이전트 지시사항
├── cv.md                        # 내 이력서 (직접 생성)
├── article-digest.md            # 주요 성과 정리 (선택)
├── config/
│   └── profile.example.yml      # 프로필 템플릿
├── modes/                       # 14개 스킬 모드
│   ├── _shared.md               # 공유 컨텍스트 (커스터마이즈 가능)
│   ├── oferta.md                # 개별 평가
│   ├── pdf.md                   # PDF 생성
│   ├── scan.md                  # 포털 스캐너
│   ├── batch.md                 # 일괄 처리
│   └── ...
├── templates/
│   ├── cv-template.html         # ATS 최적화 이력서 템플릿
│   ├── portals.example.yml      # 스캐너 설정 템플릿
│   └── states.yml               # 정규 상태값
├── batch/
│   ├── batch-prompt.md          # 독립형 워커 프롬프트(Self-contained)
│   └── batch-runner.sh          # 오케스트레이터 스크립트
├── dashboard/                   # Go TUI 파이프라인 뷰어
├── data/                        # 트래킹 데이터 (gitignored)
├── reports/                     # 평가 리포트 (gitignored)
├── output/                      # 생성된 PDF (gitignored)
├── fonts/                       # Space Grotesk + DM Sans
├── docs/                        # 설정, 커스터마이즈, 아키텍처
└── examples/                    # 예시 이력서, 리포트, 성과
```

## Tech Stack

![Claude Code](https://img.shields.io/badge/Claude_Code-000?style=flat&logo=anthropic&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat&logo=playwright&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white)
![Bubble Tea](https://img.shields.io/badge/Bubble_Tea-FF75B5?style=flat&logo=go&logoColor=white)

- **에이전트**: Claude Code + 커스텀 스킬 및 모드
- **PDF**: Playwright/Puppeteer + HTML 템플릿
- **스캐너**: Playwright + Greenhouse API + WebSearch
- **대시보드**: Go + Bubble Tea + Lipgloss (Catppuccin Mocha 테마)
- **데이터**: Markdown 테이블 + YAML 설정 + TSV 배치 파일

## 관련 오픈소스 프로젝트

- **[cv-santiago](https://github.com/santifer/cv-santiago)** -- 포트폴리오 웹사이트 (santifer.io). AI 챗봇, LLMOps 대시보드, 케이스 스터디가 포함되어 있습니다. 취업 활동과 함께 포트폴리오가 필요하다면, 포크해서 자유롭게 활용하세요.

## 저자 소개

Santiago입니다 -- Head of Applied AI, 전직 창업자 (직접 사업을 만들고 매각했으며, 아직도 제 이름으로 운영되고 있습니다). 제 취업 활동을 관리하기 위해 career-ops를 만들었습니다. 효과가 있었습니다: 이 시스템으로 현재 포지션에 합격했습니다.

포트폴리오 및 기타 오픈소스 프로젝트 → [santifer.io](https://santifer.io)

## Star History

<a href="https://www.star-history.com/?repos=santifer%2Fcareer-ops&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
   <img alt="Star History 차트" src="https://api.star-history.com/chart?repos=santifer/career-ops&type=timeline&legend=top-left" />
 </picture>
</a>

## 면책 조항

**career-ops는 로컬 오픈소스 도구이며, 별도의 호스팅 서비스가 아닙니다.** 이 소프트웨어를 사용함으로써 다음 사항에 동의하는 것으로 간주됩니다:

1. **데이터 주권:** 모든 데이터는 사용자의 로컬 머신에 머물며, 선택한 AI 프로바이더와 직접 통신합니다. 이력서, 연락처, 개인정보는 사용자의 컴퓨터에 저장되며, 선택한 AI 제공사 (Anthropic, OpenAI 등)에게만 직접 전송됩니다. 저희는 어떤 데이터도 수집, 저장, 접근하지 않습니다.
2. **AI 제어는 사용자 책임입니다.** 기본 프롬프트는 AI가 지원서를 자동 제출하지 않도록 설정되어 있으나, AI 모델은 예측 불가능하게 동작할 수 있습니다. 프롬프트를 수정하거나 다른 모델을 사용하는 경우 사용자의 책임입니다. **제출 전에 항상 AI가 생성한 콘텐츠의 정확성을 확인하세요.**
3. **약관 준수:** 채용 포털(Greenhouse, Lever, Workday, LinkedIn 등)의 이용약관을 반드시 준수하세요. 본 도구를 스팸 전송이나 ATS 시스템 과부하 용도로 사용하는 것을 금지합니다.
4. **보증은 없습니다.** 평가 결과는 추천이지 사실이 아닙니다. AI 모델은 스킬이나 경험을 허위로 생성할 수 있습니다. 저자는 채용 결과, 거절된 지원, 계정 제한 또는 기타 결과에 대해 책임지지 않습니다.

자세한 내용은 [LEGAL_DISCLAIMER.md](LEGAL_DISCLAIMER.md)를 참고하세요. 이 소프트웨어는 [MIT 라이선스](LICENSE)에 따라 어떠한 보증 없이 "있는 그대로" 제공됩니다.

## 라이선스

MIT

## 소통하기

[![Website](https://img.shields.io/badge/santifer.io-000?style=for-the-badge&logo=safari&logoColor=white)](https://santifer.io)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/santifer)
[![X](https://img.shields.io/badge/X-000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/santifer)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/8pRpHETxa4)
[![Email](https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white)](mailto:hi@santifer.io)
