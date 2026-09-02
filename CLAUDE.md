# seminar-studio

세미나 녹음에서 요약·카드뉴스·인포그래픽·PPT 4종을 뽑는 작업 공간.

## 하네스: 세미나 산출물

**목표:** 세미나 녹음 1개 → 검증된 코어 1개 → 산출물 4종.
**트리거:** 세미나·강연 녹음/전사본 관련 요청 시 `seminar-studio` 스킬을 사용하라. 단순 질문은 직접 응답.
**실행 모드:** **Workflow** — 환경 감사(2026-09-01)에서 `Workflow` 도구 확인. 에이전트 팀은 꺼져 있고 이 작업엔 불필요(단계가 고정된 파이프라인이라 팀의 강점인 '발견이 방향을 바꾸는 탐색'이 없다).
**런타임 프로파일:** claude-code (v2.1.178+). 다른 런타임에서는 `Workflow`·`Artifact`가 없으므로 오케스트레이션을 서브에이전트 순차 호출로 바꿔야 한다.

**외부 의존:**
- `mlx_whisper` (`~/.local/bin`, uv tool) — 전사. Apple Silicon 전용. 없으면 전사 단계 전체가 죽는다
- `.venv/bin/python` + `python-pptx` — 덱 빌드
- `ffmpeg` (homebrew) — 오디오 정규화

**요구 스킬:** `dataviz`·`artifact-design` (내장), `superpowers:verification-before-completion` (플러그인, 설치됨).
선택: `eli5` 미설치 — 있으면 `seminar-composer`에 물려 청중 눈높이 보정을 붙일 수 있다.
`ponytail`은 의도적으로 물리지 않았다 (코드 최소주의 스킬이라 콘텐츠 생성 에이전트에는 역효과).

**모델 배정:** 전사=haiku/low (기계적), 팩트체크=sonnet/medium (대조), 분석·구성=inherit/high (판단).
`inherit`이므로 세션 모델을 올리면 하네스 품질도 같이 올라간다.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-09-01 | 초기 구성 | 전체 | - |

## 디렉토리

`input/` 녹음·전사본 · `_workspace/` 중간 산출물(감사 추적용, 지우지 않는다) · `output/` 최종 4종
