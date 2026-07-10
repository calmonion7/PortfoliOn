# 2026-06-07 — backlog.py DART 파서 정상화 (task 12)

## Plan vs actual
- What went as planned: 4슬라이스(S1 분기 괄호파싱 / S2 _get_document_text / S3 _extract_backlog_blocks / S4 fetch_and_save_backlog 재작성) 전부 TDD RED→GREEN. 죽은 endpoint(`/api/index.json`·`/api/document.json`)·죽은 헬퍼 4종 완전 제거(grep clean), 시그니처 유지로 task 11 호출부 무변경, 전체 backend pytest 360 passed, 프론트 0. final_status=pass. commit+push(b69e57fb).
- Divergences:
  - **lxml → html.parser (S3)**: 계획·ADR-0002는 "BeautifulSoup(lxml)"을 명시했으나 로컬 `.venv`에 lxml 미설치(requirements.txt·Docker에만)라 로컬 TDD GREEN 불가 → stdlib `html.parser`로 전환. 의존성 추가 없이 로컬·프로덕션 모두 동작, 더 견고. 기존 코드의 lxml 참조는 한 번도 실행된 적 없는 죽은 경로였음.
  - docstring 자체 불일치(line 174 "BeautifulSoup(lxml)") — 워크플로우는 surgical 원칙으로 미수정, 오케스트레이터가 "html.parser"로 1줄 정정(이번 작업이 만든 부정확성 정리).
  - 순차 동일파일 편집의 중간 깨짐: S2/S3가 헬퍼를 삭제한 뒤 S4 전까지 `fetch_and_save_backlog`가 삭제된 함수를 참조(런타임 호출 시 NameError, import·테스트는 정상). S4 재작성으로 해소.

## Learnings
- Do differently next time:
  - **로컬 `.venv` ≠ Docker 의존성**: `lxml`은 requirements/Docker엔 있지만 로컬 `.venv`엔 없다. 로컬 pytest로 검증할 HTML 파싱은 stdlib `html.parser` 기본. → CLAUDE.md Gotchas에 promotion 완료(영속화). 같은 패턴(로컬엔 없고 Docker엔 있는 패키지)에 코드/테스트가 의존하면 로컬 TDD가 막히니, fg-ask 단계에서 "로컬 검증 가능한 의존성인가"를 미리 확인.
  - **삭제-재작성은 같은 슬라이스로 묶거나 순서를 마지막에**: 헬퍼를 앞 슬라이스에서 지우고 호출부를 뒤 슬라이스에서 고치면 사이 구간이 transient-broken. 테스트가 그 경로를 안 타면 무해하나, 깔끔하려면 "호출부 재작성"을 가장 먼저 두거나 삭제를 같은 슬라이스에서.
  - **fg-ask에서 실제 외부 API를 미리 검증한 효과**: document.xml 동작·현대건설 추출 문자열·ZIP 멤버 구조·보고서명 형식을 그릴링 때 실키로 확인해 계획에 박아둔 덕에 실행 서프라이즈 0. 외부 연동 작업은 그릴링 단계 실측이 비용을 크게 줄인다.
- 후속(이번 루프 밖): 배포 완료 후 `refresh-all`로 KR 34종 pending 실제 적재 → Cowork가 수치 채움(원래 "채워줘"의 실제 완수). lxml을 로컬 `.venv`에 설치하면 향후 lxml 의존 코드도 로컬 검증 가능.

## Doc updates
- CONTEXT.md promotion: none (새 용어 없음).
- ADR added: none 신규 — ADR-0002(document.xml + Cowork 수집 전략)는 fg-ask 단계에서 이미 작성.
- CLAUDE.md Gotchas 추가(영속): ① 로컬 .venv lxml 미설치 → html.parser 사용 ② backlog.py document.xml + DART_API_KEY + pending/Cowork 동작. (b69e57fb 이후 커밋 예정)
