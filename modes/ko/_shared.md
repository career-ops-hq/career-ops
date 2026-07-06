# 공통 컨텍스트 -- career-ops (한국어)

<!-- ============================================================
     사용 전 개인 설정 안내
     ============================================================
     이 파일은 한국어 career-ops 모드 전체에서 공유하는 컨텍스트입니다.
     career-ops를 사용하기 전에 반드시 다음을 준비하세요.
     1. config/profile.yml에 개인 정보를 입력
     2. 프로젝트 루트에 cv.md 생성 (Markdown CV)
     3. (선택) article-digest.md에 proof point 정리
     4. 아래 [개인화] 표시가 있는 섹션을 자신의 상황에 맞게 조정
     ============================================================ -->

## Source of Truth (매 평가 전 항상 읽기)

| 파일 | 경로 | 언제 |
|------|------|------|
| cv.md | `cv.md` (프로젝트 루트) | 항상 |
| article-digest.md | `article-digest.md` (있다면) | 항상 (상세 proof point) |
| profile.yml | `config/profile.yml` | 항상 (신원 정보와 목표 역할) |

**규칙: proof point의 metric을 절대 하드코딩하지 않습니다.** 평가 시점에 `cv.md`와 `article-digest.md`에서 읽습니다.
**규칙: article/project metric은 `article-digest.md`가 `cv.md`보다 우선합니다** (`cv.md`에는 더 오래된 수치가 있을 수 있음).

---

## North Star -- 목표 역할

이 skill은 모든 목표 역할을 같은 비중으로 다룹니다. primary/secondary 구분은 없습니다. 보상과 성장 가능성이 맞다면 각 역할은 모두 성공입니다.

| Archetype | 주제 축 | 회사가 구매하는 가치 |
|-----------|---------|----------------------|
| **AI Platform / LLMOps Engineer** | Evaluation, Observability, Reliability, Pipelines | metric 기반으로 AI를 production에 올리는 사람 |
| **Agentic Workflows / Automation** | HITL, Tooling, Orchestration, Multi-Agent | 신뢰할 수 있는 agent system을 만드는 사람 |
| **Technical AI Product Manager** | GenAI/Agents, PRDs, Discovery, Delivery | business 요구를 AI product로 번역하는 사람 |
| **AI Solutions Architect** | Hyperautomation, Enterprise, Integrations | end-to-end AI architecture를 설계하는 사람 |
| **AI Forward Deployed Engineer** | Client-facing, Fast delivery, Prototyping | 고객 현장에서 AI solution을 빠르게 배포하는 사람 |
| **AI Transformation Lead** | Change management, Adoption, Enablement | 조직의 AI transformation을 이끄는 사람 |

<!-- [개인화] 위 archetype을 자신의 목표 역할에 맞게 조정하세요.
     Backend engineering 예시:
     - Senior Backend Engineer
     - Staff Platform Engineer
     - Engineering Manager
     등 -->

### Archetype별 adaptive framing

> **구체적인 수치는 평가 시점에 `cv.md`와 `article-digest.md`에서 읽습니다. 이 파일에 고정값으로 적어두지 마세요.**

| 역할이... | 후보자에게서 강조할 것 | Proof point source |
|-----------|------------------------|--------------------|
| Platform / LLMOps | production 경험, observability, evals, closed-loop | article-digest.md + cv.md |
| Agentic / Automation | multi-agent orchestration, HITL, reliability, cost | article-digest.md + cv.md |
| Technical AI PM | product discovery, PRD, metric, stakeholder management | cv.md + article-digest.md |
| Solutions Architect | system design, integration, enterprise readiness | article-digest.md + cv.md |
| Forward Deployed Engineer | 빠른 delivery, 고객 접점, prototype to production | cv.md + article-digest.md |
| AI Transformation Lead | change management, team enablement, adoption | cv.md + article-digest.md |

<!-- [개인화] 자신의 구체적인 project/article을 위 archetype에 연결하세요. -->

### 전환 narrative (모든 framing에 사용)

<!-- [개인화] 자신의 narrative로 바꾸세요. 예:
     - "5년간 SaaS를 만들고 매각. 이제 enterprise applied AI에 100% 집중."
     - "Series-B에서 x10 성장기를 겪은 engineering lead. 다음 도전을 찾는 중."
     - "컨설팅에서 product로 전환. 높은 책임 범위의 역할을 찾는 중."
     config/profile.yml -> narrative.exit_story에서 읽음 -->

모든 콘텐츠에서 `config/profile.yml`의 전환 narrative를 사용해 framing합니다.
- **PDF summary:** 과거와 미래를 연결합니다 -- "이제 같은 [역량]을 [공고의 domain]에 적용합니다."
- **STAR story:** `article-digest.md`의 proof point를 참조합니다.
- **답변 초안(블록 G):** 전환 narrative는 첫 답변에 넣습니다.
- **공고가 "entrepreneurial", "autonomy", "builder", "end-to-end"를 언급할 때:** 이것이 핵심 차별점입니다. match weight를 높입니다.

### Cross-cutting advantage

프로필을 **"실제 실행 경험을 가진 technical builder"**로 framing하고, 역할에 맞게 조정합니다.
- PM: "prototype으로 불확실성을 줄이고 discipline 있게 production까지 전달하는 builder"
- FDE: "day 1부터 observability와 metric을 갖춰 delivery하는 builder"
- SA: "실제 integration 경험으로 end-to-end system을 설계하는 builder"
- LLMOps: "closed-loop quality system으로 AI를 production에 올리는 builder"

"Builder"를 전문성의 신호로 positioning합니다. "그냥 이것저것 만드는 사람"처럼 보이면 안 됩니다. 실제 proof point가 credibility를 만듭니다.

### Portfolio as proof point (중요 지원에 사용)

<!-- [개인화] live demo, dashboard, public project가 있다면 여기에 설정하세요.
     예:
     dashboard:
       url: "https://yourdomain.dev/demo"
       password: "demo-2026"
       when_to_share: "LLMOps, AI Platform, Observability roles"
     config/profile.yml -> narrative.proof_points 및 narrative.dashboard에서 읽음 -->

후보자에게 live demo / dashboard가 있다면(`profile.yml` 확인), 관련성 높은 지원에서 접근 정보를 제안합니다.

### 보상 정보 (Comp Intelligence)

<!-- [개인화] 목표 역할의 보상 범위를 조사해 값을 조정하세요. -->

**일반 가이드:**
- 현재 시장 데이터는 WebSearch로 확인합니다(원티드, 리멤버, 잡플래닛, 블라인드, Levels.fyi, Glassdoor 등).
- 직무 title 기준으로 framing합니다. salary band는 보통 skill보다 title이 정의합니다.
- 한국에서는 base salary, performance bonus, stock option/RSU, signing bonus, welfare benefit이 섞여 제시될 수 있으므로 total compensation을 분해해서 봅니다.
- remote role의 geo-arbitrage는 가능하지만, 일부 회사는 한국 거주 여부, 시차, 고용 형태(EOR/contractor)를 기준으로 보상을 조정할 수 있습니다.

### 한국 채용 시장 -- 특이사항 (중요)

한국어 공고와 협상에서는 EN/ES 시장과 다른 용어가 등장합니다. 반드시 정확히 반영하세요.

| 용어 | 의미 | 평가 영향 |
|------|------|-----------|
| **정규직** | 기간의 정함이 없는 고용 형태 | senior tech role의 기본값. 계약직이면 이유와 전환 가능성 확인 |
| **계약직** | 기간이 정해진 고용 형태 | 특정 project/전환형이면 가능. 기간, 연장/전환 가능성, 종료 리스크 확인 |
| **수습기간** | 보통 3개월. 일부 회사는 급여 감액 조건을 둠 | 급여 100% 지급 여부, 평가 기준, 해고 조건 확인 |
| **포괄임금제** | 연장/야간/휴일근로 수당을 연봉에 포함하는 구조 | 근무시간 리스크. 고정 OT 시간과 실제 야근 culture 확인 |
| **퇴직금** | 1년 이상 근무 시 발생하는 법정 퇴직급여 | 연봉에 포함/별도 표현이 혼동될 수 있으므로 확인 |
| **4대 보험** | 국민연금, 건강보험, 고용보험, 산재보험 | 정규직/계약직의 기본 위생 요건. 프리랜서는 다를 수 있음 |
| **세전 연봉** | 세금/보험료 공제 전 연봉 | 한국 연봉 협상은 보통 세전 기준. 실수령액과 구분 |
| **성과급 / 인센티브** | 개인/회사 성과에 따른 변동 보상 | target, payout history, 지급 조건 확인 |
| **스톡옵션 / RSU** | equity compensation | vesting schedule, exercise price, liquidity 가능성 확인 |
| **사이닝 보너스** | 입사 보너스 | clawback 조건이 있는지 확인 |
| **연차 / 유급휴가** | 근로기준법상 유급휴가 | 최소 기준 미달은 red flag. 사용 문화도 중요 |
| **식대 / 복지포인트** | 현금성 또는 준현금성 복지 | 작은 항목이지만 total package 비교에 포함 |
| **재택근무** | 원격 근무 | "가능"과 "상시 가능"은 다릅니다. 출근 빈도 확인 |
| **하이브리드 근무** | 재택 + 오피스 출근 혼합 | 주 n회 출근, team day, 지역 제한 확인 |
| **프리랜서 / 개인사업자** | 고용계약이 아닌 용역/위탁 계약 | rate, 세금, 보험, 계약 종료 리스크를 별도로 평가 |

### 협상 스크립트

<!-- [개인화] 자신의 상황에 맞게 조정하세요. -->

**희망 연봉 (일반 framework):**
> "이 역할의 시장 기준과 제 경험 범위를 고려하면, 저는 [profile.yml의 범위] 수준을 기대하고 있습니다. 다만 base, bonus, equity, 복지까지 포함한 전체 보상 패키지 기준으로 유연하게 논의할 수 있습니다."

**지역 기반 discount에 대한 답변:**
> "제가 비교 중인 역할들은 location보다 delivery와 impact를 기준으로 평가합니다. 제 track record는 근무지와 관계없이 동일하게 적용됩니다."

**제안이 목표보다 낮을 때:**
> "현재 [더 높은 범위] 수준의 package를 기준으로 논의 중입니다. [회사]에는 [구체적 이유] 때문에 관심이 큽니다. [목표 금액/구조]까지 맞출 수 있을까요?"

**성과급 / equity 협상:**
> "공정하게 비교하려면 base salary, target bonus, equity/stock option, signing bonus를 나눠서 보고 싶습니다. 각 항목의 지급 조건과 과거 payout range도 확인할 수 있을까요?"

### Location Policy

<!-- [개인화] 자신의 상황에 맞게 조정하세요. config/profile.yml -> location에서 읽음 -->

**지원서 폼에서:**
- "출근 가능 여부" 같은 binary 질문: `profile.yml`의 실제 availability에 따라 답합니다.
- 자유 입력 필드: 시차 overlap, 출근 가능 빈도, 지역 제한을 명확히 씁니다.

**평가 scoring에서:**
- 국내 하이브리드인데 출근 빈도가 불명확하면 remote dimension을 **3.0**으로 둡니다.
- Score 1.0은 공고가 "주 4-5일 필수 출근, 예외 없음"처럼 명시할 때만 사용합니다.

### Time-to-offer priority
- 작동하는 demo + metric > 완벽함
- 더 많이 조사하기보다 빠르게 지원
- 80/20 접근, 모든 작업은 timebox

---

## 전역 규칙

### 절대 하지 말 것

1. 경험이나 metric을 지어내기
2. `cv.md` 또는 portfolio 파일을 임의로 수정하기
3. 후보자 대신 지원서를 제출하기
4. 생성 메시지에 전화번호 공유하기
5. 시장가보다 낮은 보상을 추천하기
6. 공고를 읽기 전에 PDF 생성하기
7. 공허한 corporate jargon 사용하기
8. tracker 무시하기 (평가한 모든 공고는 기록)

### 항상 할 것

0. **커버레터:** 폼이 허용하면 항상 포함합니다. CV와 같은 visual design의 PDF. 공고 문구를 proof point와 매핑. 최대 1페이지.
1. 공고 평가 전 `cv.md`와 `article-digest.md`(있다면)를 읽습니다.
1b. **세션 첫 평가:** Bash로 `node cv-sync-check.mjs`를 실행합니다. 경고가 있으면 후보자에게 알립니다.
2. 역할 archetype을 감지하고 framing을 조정합니다.
3. matching 시 CV의 정확한 문장을 인용합니다.
4. 보상/회사 데이터에는 WebSearch를 사용합니다.
5. 매 평가 후 tracker에 기록합니다.
6. 생성 콘텐츠는 공고 언어에 맞춥니다(한국어 공고면 한국어, 영어 공고면 영어).
7. 직접적이고 구체적으로 씁니다. 불필요한 말은 줄입니다.
8. 한국 테크 채용 문맥에 맞는 자연스러운 한국어를 사용합니다. 짧은 문장, 동사 중심, 수동태 회피. stack, pipeline, deployment, embedding 같은 현장 용어는 억지로 번역하지 않습니다.
8b. **PDF Professional Summary의 case study URL:** PDF가 case study나 demo를 언급하면 URL은 반드시 첫 문단(Professional Summary)에 들어갑니다. recruiter는 summary만 읽는 경우가 많습니다. HTML에서는 모든 URL에 `white-space: nowrap` 적용.
9. **Tracker entry는 TSV로 작성** -- 새 항목을 위해 applications.md를 직접 수정하지 않습니다. `batch/tracker-additions/`에 TSV를 쓰고 `merge-tracker.mjs`가 병합합니다.
10. **모든 report header에 `**URL:**` 포함** -- Score와 PDF 사이에 둡니다.

### 도구

| 도구 | 용도 |
|------|------|
| WebSearch | 보상, 시장 trend, 회사 culture, LinkedIn contact, 공고 fallback 조사 |
| WebFetch | 정적 페이지의 공고 추출 fallback |
| Playwright | 공고 활성 여부 확인(browser_navigate + browser_snapshot), SPA에서 공고 추출. **중요: Playwright를 쓰는 agent를 2개 이상 병렬로 띄우지 않습니다 -- 같은 browser instance를 공유합니다** |
| Read | cv.md, article-digest.md, cv-template.html |
| Write | PDF용 임시 HTML, applications.md, reports .md |
| Edit | tracker 업데이트 |
| Bash | `node generate-pdf.mjs` |
