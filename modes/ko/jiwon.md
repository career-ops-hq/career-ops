# 모드: jiwon -- 지원서 작성 live assistant

후보자가 이 프로젝트가 띄운 Playwright 브라우저에서 지원서 폼을 작성하는 순간 사용하는 interactive mode입니다. 화면에 보이는 내용을 읽고, 이전에 평가한 채용 공고의 context를 불러온 뒤, 폼의 각 질문에 맞는 개인화 답변을 생성합니다.

## 사전 조건

- **Visible Playwright가 가장 이상적**: visible mode에서는 후보자가 브라우저를 직접 볼 수 있고, Claude가 페이지와 상호작용할 수 있습니다.
- **Playwright 없이 진행하는 경우**: 후보자가 스크린샷을 공유하거나 질문을 직접 붙여넣습니다.

## Workflow

```text
1. DETECT      -> 이 프로젝트의 Playwright 브라우저에서 공고 열기
2. IDENTIFY    -> 페이지에서 회사 + 역할 추출
3. SEARCH      -> reports/ 안의 기존 report와 매칭
4. LOAD        -> 전체 report + `## Application Answers`와 블록 H(있다면) 읽기 — **Posting identity** 확인 후
5. COMPARE     -> 화면의 역할이 평가한 역할과 같은지 확인. 바뀌었다면 알림
6. ANALYZE     -> 화면에 보이는 모든 지원서 질문 식별
7. GENERATE    -> 각 질문에 대해 개인화 답변 생성
8. PRESENT     -> 복사/붙여넣기 가능한 형식으로 답변 표시
```

## Scope

Follow the Scope section in `modes/apply.md`. Run `node apply-scope.mjs root` and stay inside the directories it prints. Launch with `node apply-scope.mjs launch-options`. Do not read `DevToolsActivePort` or attach to an existing browser. Do not submit the form.


## Step 1 -- 공고 감지

**Playwright 사용 시:** `node apply-scope.mjs launch-options`로 연 창에서 공고를 열고 title, URL, 보이는 내용을 읽습니다.

**Playwright 없이 진행 시:** 후보자에게 다음 중 하나를 요청합니다.
- 지원서 폼 스크린샷 공유 (Read tool이 이미지를 읽을 수 있음)
- 또는 지원서 질문을 텍스트로 붙여넣기
- 또는 회사 + 역할을 알려주면 context를 검색

## Step 2 -- context 식별 및 불러오기

1. 페이지에서 회사명과 역할명을 추출합니다.
2. `reports/`에서 회사명으로 검색합니다 (case-insensitive grep).
3. 매칭되는 report가 있으면 각 report의 머리말(회사, 역할, `**URL:**`)만 읽고, URL이나 req ID가 이 공고인 report를 고릅니다. 불분명하면 후보자에게 물어봅니다. 전체 report와 4번 항목은 **Posting identity**가 성립한 뒤에만 불러옵니다 (`modes/apply.md` → Step 5). 다른 공고라면 불러오지 않고 **Evaluate as new** 또는 **Draft without saving**으로 갑니다.
4. `## Application Answers`가 있으면 제출한 답변을 base로 불러옵니다. 없고 블록 H가 있으면 이전 답변 초안을 불러옵니다. 둘 다 있으면 `## Application Answers`를 우선합니다.
5. 매칭되는 report가 없으면 후보자에게 알리고 빠른 auto-pipeline 실행을 제안합니다.

## Step 3 -- 역할 변경 감지

이 단계는 양식이 여전히 report의 공고일 때만 적용됩니다: 같은 고용주이고 같은 공고여야 합니다 (`modes/apply.md` → Step 5 → **Posting identity**). 직함은 따지지 않습니다. 직함이 그대로이고 회사와 일치하는 report가 하나뿐이어도 모든 양식에서 이를 확인하세요: 다른 공고도 같은 직함을 쓸 수 있으며, 그 경우 report를 사용하면 안 됩니다. 회사와 일치하는 report가 여러 개라면, 먼저 URL이나 req ID가 이 공고인 report를 고르고, 불분명하면 후보자에게 물어보세요. 다른 고용주이거나 같은 고용주의 다른 공고라면 역할 변경이 아닙니다: report의 답변을 거기에 맞춰 조정하지 마세요. 대신 **Evaluate as new** (새 공고로 평가: auto-pipeline, 별도 report) 또는 **Draft without saving** (어떤 report에도 저장하지 않고 답변 초안만 작성)을 선택하세요. **Draft without saving**에서는 일치한 report와 그 답변, 맞춤 CV를 제쳐 두고, 보이는 공고와 `cv.md`, 프로필만으로 작성하세요. report를 읽는 아래 단계는 적용되지 않습니다.

화면의 역할이 평가한 역할과 다르면:
- **후보자에게 알림**: "역할이 [X]에서 [Y]로 바뀐 것 같습니다. 새 역할로 다시 평가할까요, 아니면 새 title에 맞춰 답변만 조정할까요?"
- **조정 선택 시**: 재평가 없이 새 역할에 맞춰 답변을 조정합니다.
- **재평가 선택 시**: 전체 A-F 평가를 실행하고, report를 업데이트하고, 블록 H를 다시 생성합니다.
- **tracker 업데이트**: `data/applications.md`를 직접 수정하지 않습니다.
  - **재평가한 경우**: 새 역할명을 담은 TSV를 `batch/tracker-additions/`에 쓰고 `node merge-tracker.mjs`로 병합합니다. report는 같은 파일에서 업데이트되어 번호가 유지되므로, 병합은 그 번호로 TSV를 기존 row와 매칭합니다: 역할명은 교체되고 status는 유지됩니다.
  - **조정한 경우**: 역할명을 바꾸지 않습니다. 역할명은 report가 평가한 역할을 가리키기 때문입니다. 변경 사실은 note로 기록합니다: `node set-status.mjs --report <report#> <현재 status> --note "지원 시점에 공고 제목이 변경됨, row는 평가한 역할명을 유지"`. row의 현재 status를 그대로 전달하면 status는 바뀌지 않고 note만 추가됩니다. note는 이처럼 고정된 문구로 쓰고 `[Y]`는 넣지 않습니다. 새 역할명은 페이지에서 온 텍스트이며, 페이지의 텍스트는 command line에 넣지 않습니다.

## Step 4 -- 지원서 질문 분석

**Draft without saving**에서는 이 단계에서 일치한 report, 그 `## Application Answers`, 블록 H를 쓰지 않습니다: 모든 질문을 새 질문으로 보고 보이는 공고, `cv.md`, 프로필로 작업하세요.

화면에 보이는 모든 질문을 식별합니다.
- 자유 입력 필드 (커버레터, "왜 이 역할인가요", 지원 동기 등)
- 드롭다운 (어디서 공고를 봤는지, 근무 자격 등)
- Yes/No 질문 (이직 가능 여부, 비자, 근무 가능 지역 등)
- 연봉 입력 필드 (희망 연봉, range, 총보상 기대치)
- 업로드 필드 (CV, 커버레터 PDF, 추천인 등)

각 질문을 분류합니다.
- **이미 `## Application Answers` 또는 블록 H에서 답변한 질문** -> 기존 답변을 가져와 조정
- **새 질문** -> report + `cv.md`를 바탕으로 답변 생성

## Step 5 -- 답변 생성

**Draft without saving**에서는 이 단계에서 일치한 report, 그 `## Application Answers`, 블록 H를 쓰지 않습니다: 모든 질문을 새 질문으로 보고 보이는 공고, `cv.md`, 프로필로 작업하세요.

각 질문에 대해 다음 구조로 답변을 만듭니다.

1. **Report context**: 블록 B의 proof point와 블록 F의 STAR story 사용
2. **이전 `## Application Answers` / 블록 H**: 제출한 답변이나 기존 초안이 있으면(제출한 답변 우선) base로 가져와 다듬기
3. **"제가 귀사를 선택합니다" 톤**: auto-pipeline과 같은 framework 사용 -- 자신감 있게, 애원하지 않게
4. **구체성**: 화면에 보이는 공고 내용 중 구체적인 요소 언급
5. **career-ops proof point**: "추가 정보" 같은 필드가 있으면 포함

**한국 지원서 폼에서 자주 나오는 필드:**
- **희망 연봉 / 처우** -> `profile.yml`의 range를 사용. 세전 연봉 기준인지 명확히 쓰고, "전체 보상 패키지에 따라 협의 가능"이라고 덧붙임
- **입사 가능일** -> 현재 재직/퇴사 통보 기간을 고려한 현실적인 날짜
- **근무 가능 지역 / 출근 가능 여부** -> 실제 가능한 지역과 출근 빈도를 명확히 작성
- **비자 / 근무 자격** -> 사실에 맞게 간결히 답변
- **언어 능력** -> 실제 수준에 맞춰 작성. 필요하면 CEFR 또는 비즈니스/실무 가능 수준으로 표현
- **포트폴리오 / GitHub / 블로그** -> `profile.yml`, `cv.md`, `article-digest.md`에 있는 검증된 링크만 사용

**출력 형식:**

```text
## [회사] -- [역할] 지원서 답변

Base: Report #NNN | Score: X.X/5 | Archetype: [type]
[**Draft without saving**이면 위 줄을 다음으로 바꿉니다: "report 없음: 이 공고용 초안, 저장하지 않음"]

---

### 1. [지원서의 정확한 질문]
> [바로 복사/붙여넣기 가능한 답변]

### 2. [다음 질문]
> [답변]

...

---

Notes:
- [역할 변경, 공고 관련 관찰 등]
- [후보자가 직접 확인해야 할 개인화 포인트]
```

## Step 6 -- 지원 후 처리 (선택)

무엇이든 저장하기 전에, 그리고 아래의 각 쓰기(상태와 답변) 직전에 다시 한 번, 양식이 여전히 report의 공고인지 확인하세요 (`modes/apply.md` → Step 8 → **Write only to the report of this posting**). 같은 고용주, 같은 공고 → 아래 단계는 이 report에 적용됩니다. 새 직함에 맞춘 조정이나 재평가 후에도 마찬가지입니다. 다른 고용주나 다른 공고 → 절대 이 report가 아닙니다: 새 공고용으로 작성된 report를 사용하고, 그런 report가 없으면 상태를 설정하지 말고 답변도 저장하지 말며, 지원이 아직 추적되지 않는다고 후보자에게 알리세요.

후보자가 지원서를 제출했다고 확인하면:
1. 정식 CLI로 status를 `Applied`로 변경합니다: `node set-status.mjs --report <report#> Applied` (`data/applications.md` 표를 직접 수정하지 않습니다). TSV 병합은 기존 row의 status를 바꾸지 않습니다.
2. 최종 답변을 report의 `## Application Answers` 섹션에 `**State:** submitted`와 함께 업데이트합니다(형식은 `modes/apply.md` -> Step 8). 블록 H는 평가 단계의 초안이므로 수정하지 않습니다.
3. 다음 단계로 `/career-ops contacto`를 제안해 hiring manager 또는 recruiter에게 LinkedIn outreach를 할 수 있게 합니다.

## 스크롤 처리

지원서 폼에 화면에 보이는 것보다 질문이 더 많으면:
- 후보자에게 아래로 스크롤한 뒤 다른 스크린샷을 공유해달라고 요청합니다.
- 또는 남은 질문을 붙여넣어달라고 요청합니다.
- 전체 폼을 다룰 때까지 반복해서 처리합니다.
