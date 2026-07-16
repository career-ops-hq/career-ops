# 모드: gonggo -- 전체 평가 A-F

후보자가 채용 공고(텍스트 또는 URL)를 붙여넣으면 항상 6개 블록을 제공합니다.

## Step 0 -- Archetype 감지

공고를 6개 archetype 중 하나로 분류합니다(`_shared.md` 참고). 하이브리드 역할이면 가장 가까운 2개를 표시합니다. 이 분류는 다음을 결정합니다.
- 블록 B에서 우선순위를 둘 proof point
- 블록 E에서 summary를 다시 쓰는 방식
- 블록 F에서 준비할 STAR story

## 블록 A -- 역할 요약

다음 항목이 포함된 표를 작성합니다.
- 감지된 archetype
- 도메인 (Platform / Agentic / LLMOps / ML / Enterprise)
- 기능 (Build / Consulting / Management / Deploy)
- Seniority
- Remote (Full remote / Hybrid / On-site)
- 팀 규모(언급된 경우)
- 한 문장 TL;DR

## 블록 B -- CV와의 매치

`cv.md`를 읽습니다. 공고의 각 자격 요건을 CV의 정확한 문장과 매핑한 표를 만듭니다.

**Archetype에 맞게 조정:**
- FDE -> 빠른 delivery와 고객 접점 proof point 우선
- SA -> 시스템 설계와 integration 우선
- PM -> product discovery와 metric 우선
- LLMOps -> evals, observability, pipeline 우선
- Agentic -> multi-agent, HITL, orchestration 우선
- Transformation -> change management, adoption, scale-up 우선

**Gaps** 섹션을 만들고 각 gap에 대한 mitigation 전략을 제시합니다. 각 gap마다 다음을 판단합니다.
1. hard blocker인가, nice-to-have인가?
2. 후보자가 인접 경험으로 증명할 수 있는가?
3. 이 gap을 커버하는 portfolio project가 있는가?
4. 구체적인 mitigation plan은 무엇인가? (커버레터 문장, 빠른 mini-project 등)

## 블록 C -- 레벨과 전략

1. 공고에서 감지된 **레벨** vs 해당 archetype에서 후보자의 **자연스러운 레벨**
2. **"거짓 없이 senior로 포지셔닝하기" 계획**: archetype에 맞춘 구체적인 표현, 강조할 실제 성과, founder 경험을 장점으로 배치하는 방법
3. **"downlevel될 경우" 계획**: 보상이 적절하면 수락, 6개월 리뷰 협상, 명확한 promotion criteria 요구

## 블록 D -- 보상과 시장 수요

WebSearch를 사용합니다.
- 해당 역할의 현재 연봉 범위(원티드, 리멤버, 잡플래닛, 블라인드, Levels.fyi, Glassdoor 등)
- 회사의 보상 평판(가능한 경우)
- 한국/아시아 또는 해당 시장에서 역할 수요 추세

데이터와 출처를 표로 정리합니다. 데이터가 없으면 명확히 없다고 말합니다. 절대 지어내지 않습니다.

**한국 시장 -- 필수 확인 사항:**
- 세전 연봉 기준인가? 월급/연봉/총보상 기준이 섞여 있지 않은가?
- 성과급, 인센티브, 사이닝 보너스가 별도로 언급되어 있는가?
- 스톡옵션, RSU, 지분 보상이 있는가? vesting 조건은 명시되어 있는가?
- 정규직인가 계약직인가? 계약직이면 기간, 전환 가능성, 계약 종료 리스크를 확인합니다.
- 수습기간이 있는가? 기간과 급여 차감 여부가 명시되어 있는가?
- 포괄임금제, 고정 OT, 야근/휴일근무 조건이 언급되어 있는가?
- 퇴직금, 4대 보험, 연차/휴가, 식대/복지포인트 등 기본 복지가 명시되어 있는가?
- 재택/하이브리드라면 실제 출근 빈도와 지역 제한이 명확한가?

## 블록 E -- 개인화 계획

| # | Section | Current state | Proposed change | Rationale |
|---|---------|---------------|-----------------|-----------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

매치를 극대화하기 위한 Top 5 CV 수정 + Top 5 LinkedIn 수정 제안을 제공합니다.

## 블록 F -- 면접 준비 계획

공고의 자격 요건에 매핑한 6-10개 STAR+R story를 준비합니다 (STAR + **Reflection**).

| # | 공고 자격 요건 | STAR+R story | S | T | A | R | Reflection |
|---|----------------|--------------|---|---|---|---|------------|

**Reflection** 열은 무엇을 배웠는지 또는 다시 한다면 무엇을 다르게 할지를 담습니다. 이는 seniority를 보여주는 신호입니다. junior는 무슨 일이 있었는지를 설명하고, senior는 그 경험에서 무엇을 배웠는지까지 설명합니다.

**Story Bank:** `interview-prep/story-bank.md`가 있으면 해당 story들이 이미 있는지 확인합니다. 없으면 새 story를 추가합니다. 시간이 지나면 어떤 면접 질문에도 재사용 가능한 5-10개의 master story bank가 만들어집니다.

**Archetype에 맞춰 선택하고 framing합니다:**
- FDE -> delivery 속도와 고객 접점을 강조
- SA -> architecture decision을 강조
- PM -> discovery와 trade-off를 강조
- LLMOps -> metric, eval, production hardening을 강조
- Agentic -> orchestration, error handling, HITL을 강조
- Transformation -> adoption과 조직 변화 관리를 강조

추가로 포함합니다.
- 추천 case study 1개(어떤 프로젝트를 어떻게 보여줄지)
- red-flag 질문과 답변 전략 (예: "왜 회사를 매각했나요?", "직접 관리한 팀이 있었나요?", "왜 짧은 기간 후 전환하려 하나요?")

---

## 평가 후 작업

블록 A-F 이후 항상 실행합니다.

### 1. report .md 저장

전체 평가를 `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`에 저장합니다.

- `{###}` = 다음 순차 번호(3자리, zero-padded). 동시성 문제를 피하기 위해 반드시 `node reserve-report-num.mjs`를 실행해 번호를 예약합니다(stdout이 `{###}`를 반환). report를 작성한 뒤 `node reserve-report-num.mjs --release {###}`를 실행해 sentinel을 해제합니다.
- `{company-slug}` = 회사명을 소문자와 하이픈으로 만든 slug
- `{YYYY-MM-DD}` = 오늘 날짜

**Report format:**

```markdown
# Evaluation : {Company} -- {Role}

**Date:** {YYYY-MM-DD}
**Archetype:** {detected}
**Score:** {X/5}
**URL:** {job URL}
**PDF:** {path or pending}

---

## A) 역할 요약
(블록 A 전체 내용)

## B) CV와의 매치
(블록 B 전체 내용)

## C) 레벨과 전략
(블록 C 전체 내용)

## D) 보상과 시장 수요
(블록 D 전체 내용)

## E) 개인화 계획
(블록 E 전체 내용)

## F) 면접 준비 계획
(블록 F 전체 내용)

## G) 지원서 답변 초안
(score >= 4.5일 때만 -- 지원서 폼 답변 초안)

---

## 추출한 키워드
(ATS 최적화를 위한 공고 키워드 15-20개)
```

### 2. tracker 추가 항목 작성

새 tracker row를 위해 `data/applications.md`를 직접 수정하지 않습니다. 평가마다 `batch/tracker-additions/{num}-{company-slug}.tsv`에 TSV 한 줄을 쓰고, 이후 `node merge-tracker.mjs`로 병합합니다.

**TSV format (status before score):**

```text
{num}\t{date}\t{company}\t{role}\tEvaluated\t{score}/5\t{pdf}\t[{num}](reports/{num}-{company-slug}-{date}.md)\t{note}
```

- `pdf`는 PDF가 생성되면 `✅`, 아니면 `❌`
- report 링크는 root-relative로 작성합니다: `[001](reports/001-company-2026-01-01.md)`
- 이미 같은 company + role이 있으면 새 row를 만들지 말고 기존 entry 업데이트 흐름을 따릅니다.
