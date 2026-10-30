# 면접 스킬

면접 준비를 처음부터 끝까지 지원하는 재사용 가능한 스킬 모음입니다.

## 스킬

| 스킬 | 파일 | 언제 사용하나요 |
|---|---|---|
| 면접 준비 플래너 | `plan.md` | JD와 면접 일시가 주어지면, 시간 블록 단위의 체계적인 준비 계획을 세웁니다 |
| 모의 면접관 | `practice.md` | 모의 면접 질문을 진행하고 구조화된 피드백을 줍니다 |
| 면접 후 디브리프 | `debrief.md` | 실제 면접이 끝난 뒤 갭을 메우고 question bank를 업데이트합니다 |

## 관련 스킬 (상위 `modes/` 디렉터리)

| 스킬 | 파일 | 언제 사용하나요 |
|---|---|---|
| 회사 조사 | `../../interview-prep.md` | 면접 전에 특정 회사와 역할을 조사합니다 |

## 파일 규약

이 스킬들은 다음 파일이 있다고 가정합니다(career-ops 기본값):

| 파일 | 용도 |
|---|---|
| `cv.md` | 후보자 CV — 경험과 proof point의 기준이 되는 원본 |
| `article-digest.md` | 포트폴리오에서 뽑은 압축된 proof point (선택) |
| `config/profile.yml` | 후보자 프로필 — 목표 역할, 보상, narrative |
| `modes/_profile.md` | 후보자의 archetype, narrative, dealbreaker |
| `interview-prep/story-bank.md` | 누적된 STAR+R 스토리 |
| `interview-prep/question-bank.md` | 갭을 추적하는 question bank (처음 사용할 때 생성) |
| `interview-prep/interview-prep-guide.md` | 일반적인 면접 원칙 (선택) |
| `interview-prep/{company}-{role}.md` | 역할별 준비 파일 |
| `interview-prep/sessions/*.md` | 라운드별 트랜스크립트. 선택 항목인 `stated_priorities` front matter(면접관이 밝힌 역할의 우선순위)는 debrief가 쓰고, plan과 practice가 읽습니다 |
| `interview-prep/retracted-claims.md` | 후보자가 방어할 수 없다고 철회한 주장 — practice와 debrief에서 절대 기준(hard gate) (형식: `**"[claim]"** ([context]). Reason: [one-line reason + correct framing if applicable].`) |
