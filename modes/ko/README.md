# career-ops -- 한국어 모드 (`modes/ko/`)

이 디렉터리는 한국어권 후보자와 한국 채용 시장을 대상으로 career-ops의 주요 모드를 한국어로 번역한 파일을 담고 있습니다.

## 언제 이 모드를 사용하나요?

다음 중 하나라도 해당하면 `modes/ko/`를 사용하세요.

- 주로 **한국어 채용 공고**에 지원하는 경우
- CV/이력서, 커버레터, 지원서 답변을 **한국어**로 작성해야 하는 경우
- 기계 번역투가 아니라 **한국 테크 채용 문맥에 맞는 자연스러운 한국어**가 필요한 경우
- 한국 채용 시장의 조건을 평가해야 하는 경우: 정규직, 계약직, 수습기간, 포괄임금제, 퇴직금, 4대 보험, 성과급, 스톡옵션/RSU, 재택/하이브리드 근무 등

대부분의 공고가 영어이고 글로벌/외국계 채용 프로세스라면 기본 `modes/`를 사용하세요. 기본 영어 모드도 한국 기업의 영어 공고를 처리할 수 있지만, 한국 채용 시장 특유의 보상/계약 조건을 세밀하게 반영하지는 않습니다.

## 어떻게 활성화하나요?

### 옵션 1 -- 세션 단위

세션 시작 시 Claude에게 이렇게 말하세요.

> "`modes/ko/` 아래의 한국어 모드를 사용해."

그러면 Claude는 기본 `modes/` 대신 이 디렉터리의 파일을 읽습니다.

### 옵션 2 -- 영구 설정

`config/profile.yml`에 다음을 추가하세요.

```yaml
language:
  primary: ko
  modes_dir: modes/ko
```

첫 세션에서 Claude에게 이 설정을 확인하라고 알려주세요. 예: "`profile.yml`에 `language.modes_dir`를 설정해뒀어." 이후 Claude는 자동으로 한국어 모드를 사용합니다.

## 어떤 모드가 번역되어 있나요?

이번 첫 버전은 영향도가 가장 큰 네 가지 모드를 다룹니다.

| 파일 | 번역 기준 | 역할 |
|---------|----------------|------|
| `_shared.md` | `modes/_shared.md` (EN) | 공통 컨텍스트, archetype, 전역 규칙, 한국 채용 시장 특화 맥락 |
| `gonggo.md` | `modes/oferta.md` (ES) | 채용 공고 전체 평가 (블록 A-F) |
| `jiwon.md` | `modes/apply.md` (EN) | 지원서 입력 폼을 채우는 live assistant |
| `pipeline.md` | `modes/pipeline.md` (ES) | 수집한 채용 공고 URL inbox / Second Brain |

다른 모드(`scan`, `batch`, `pdf`, `tracker`, `auto-pipeline`, `deep`, `contacto`, `ofertas`, `project`, `training`)는 기존 EN/ES 모드를 그대로 사용합니다. 해당 파일들은 주로 tooling, 경로, 명령어 중심이라 언어와 독립적으로 동작합니다.

## 영어로 유지하는 것

테크 채용에서 표준적으로 쓰이는 표현은 의도적으로 번역하지 않습니다.

- `cv.md`, `pipeline`, `tracker`, `report`, `score`, `archetype`, `proof point`
- 도구 이름(`Playwright`, `WebSearch`, `WebFetch`, `Read`, `Write`, `Edit`, `Bash`)
- tracker 상태값(`Evaluated`, `Applied`, `Interview`, `Offer`, `Rejected`)
- 코드 조각, 경로, 명령어

이 모드는 한국 테크 업계에서 실제로 쓰는 자연스러운 문체를 지향합니다. 본문은 한국어로 쓰되, `pipeline`, `deployment`, `embedding`, `stack`처럼 현장에서 영어로 쓰는 용어는 억지로 번역하지 않습니다.

## 기준 용어집

모드를 수정하거나 확장할 때 문체를 일관되게 유지하기 위한 기준입니다.

| 영어 | 한국어 (이 codebase 기준) |
|---------|-------------------------------|
| Job posting | 채용 공고 |
| Application | 지원 / 지원서 |
| Cover letter | 커버레터 |
| Resume / CV | CV / 이력서 |
| Salary | 연봉 |
| Compensation | 보상 / 보상 패키지 |
| Skills | 역량 / 기술 역량 |
| Interview | 면접 |
| Hiring manager | 채용 매니저 / 실무 리더 |
| Recruiter | 리크루터 |
| AI | AI / 인공지능 |
| Requirements | 자격 요건 / 요구사항 |
| Career history | 경력 |
| Notice period | 퇴사 통보 기간 |
| Probation | 수습기간 |
| Vacation | 연차 / 유급휴가 |
| Permanent employment | 정규직 |
| Fixed-term contract | 계약직 |
| Freelance | 프리랜서 / 개인사업자 |
| Gross annual salary | 세전 연봉 |
| Net salary | 실수령액 |
| Severance pay | 퇴직금 |
| Social insurance | 4대 보험 |
| Inclusive wage system | 포괄임금제 |
| Bonus | 성과급 / 보너스 |
| Stock option / RSU | 스톡옵션 / RSU |
| Meal allowance | 식대 |
| Flexible work | 유연근무 |
| Remote work | 재택근무 / 원격근무 |
| Hybrid work | 하이브리드 근무 |

## 기여하기

번역을 개선하거나 새 모드를 추가하려면:

1. 제안을 담은 Issue를 엽니다 (`CONTRIBUTING.md` 참고)
2. 위 용어집을 따라 문체를 일관되게 유지합니다
3. 직역이 아니라 자연스러운 한국어로 번역합니다
4. 구조 요소(블록 A-F, 표, 코드블록, 도구 지시문)는 그대로 유지합니다
5. 실제 한국어 채용 공고(원티드, 리멤버, 잡코리아, 사람인, LinkedIn KR 등)로 테스트한 뒤 PR을 보냅니다
