# seminar-studio

세미나 녹음 하나를 넣으면 **요약 · 카드뉴스 · 인포그래픽 · 발표덱** 4종이 나오는 Claude Code 에이전트 하네스.

세션이 여럿인 녹음(발표 + 패널 등)은 자동으로 나뉘어 **세션마다 4종씩** 만들어진다.

```
input/talk.m4a  →  전사  →  코어 분석  →  팩트체크  →  ┬ part1 { 요약 · 카드뉴스 · 인포그래픽 · 덱 }
                  (haiku)   (판단)      (게이트)      └ part2 { 요약 · 카드뉴스 · 인포그래픽 · 덱 }
```

## 결과물 보기

`output/`에 실제 산출물이 들어 있다 — 47분짜리 세미나 녹음 하나로 만든 8개 파일.

| | part1 | part2 |
|---|---|---|
| 요약 | [summary.md](output/part1/summary.md) | [summary.md](output/part2/summary.md) |
| 카드뉴스 | [cardnews.html](output/part1/cardnews.html) | [cardnews.html](output/part2/cardnews.html) |
| 인포그래픽 | [infographic.html](output/part1/infographic.html) | [infographic.html](output/part2/infographic.html) |
| 발표덱 | [deck.pptx](output/part1/deck.pptx) (17장) | [deck.pptx](output/part2/deck.pptx) (18장) |

## 설계에서 중요한 것 세 가지

**1. 단일 출처 — 4종이 각자 전사본을 읽지 않는다**

분석 단계가 `02_core.json` 하나를 만들고, 4종은 전부 그것만 본다. 각자 읽게 두면 요약과 덱이
서로 다른 사실을 말하게 되고, 그때 어느 쪽이 맞는지 알 방법이 없다.

**2. 팩트체크가 게이트다**

`seminar-factcheck`가 코어의 모든 주장·인용·수치를 전사본과 대조한다. 인용은 눈대중이 아니라
`grep` 문자열 대조다. 환각·오인용·화자 오귀속이 0건일 때만 통과하고, 걸리면 분석 단계로
되돌아간다 (재시도 상한 2회, 코드로 강제).

**3. 작업 성격별 모델 배정**

전부 최상위 모델을 쓰는 건 낭비다.

| 단계 | 모델 | 이유 |
|---|---|---|
| 전사 | `haiku` / low | CLI 실행과 정제. 판단 없음 |
| 팩트체크 | `sonnet` / medium | 대조. 판별은 필요하나 창작 아님 |
| 분석 · 구성 | `inherit` / high | 판단이 품질을 좌우 |

`inherit`이라 세션 모델을 올리면 하네스 품질도 같이 올라간다.

## 쓰는 법

```bash
# 의존성 (Apple Silicon)
uv tool install mlx-whisper          # 로컬 전사 — 파일이 밖으로 나가지 않는다
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python python-pptx
brew install ffmpeg

# 녹음을 넣고
cp ~/Downloads/talk.m4a input/

# Claude Code에서
"세미나 정리해줘"
```

`seminar-studio` 스킬이 브리프를 컴파일하고 워크플로우를 돌린다.
**브리프의 `terms`(전문용어 목록)를 비우지 마라** — 한국어 STT 정확도의 가장 큰 레버다.
비우면 "에이전트"가 "에이전시"로 나온다.

## 구조

```
.claude/agents/     transcriber · analyst · factcheck · composer
.claude/skills/     seminar-transcribe · seminar-core · seminar-deliverables · seminar-studio(진입)
workflows/          seminar.workflow.mjs   ← 순서·병렬·루프·스키마의 정본
```

흐름 제어를 산문으로 쓰면 모델이 매번 다르게 해석한다. **판단은 스킬에, 흐름은 코드에** 둔다.

### 번들 스크립트

- `build_pptx.py` — deck_spec.json → .pptx. `--demo`로 자체 검사
- `check_cards.mjs` — 카드뉴스 오버플로 + **렌더 클리핑** 검사. 의존성 없이 Chrome `--dump-dom`만 쓴다

두 번째 것이 실전에서 값을 했다. `transform:scale(calc(var(--cw)/1080))`에서 `--cw`가 `540px`이면
`scale()`에 길이가 들어가 **transform이 통째로 무시되고** 카드가 원본 크기로 렌더돼 잘린다.
에러도 경고도 안 나고, 내용량 점검으로는 절대 안 잡힌다. 이제 게이트가 잡는다.

## 산출물에 대한 원칙

산출물은 **녹음에서 나왔다는 티를 내지 않는다.** 코어는 타임코드와 근거를 전부 들고 있지만
그건 내부 검증용이고, 독자가 읽는 것은 내용이다. 타임코드·구간 표기·"발표자는 ~라고 말했다"
프레이밍은 산출물에 넣지 않는다.

근거가 약한 것은 **경고를 붙이는 게 아니라 뺀다.** 기준 없는 수치에 "확인 필요"를 다는 것
자체가 녹취록의 냄새다. 다만 아이디어의 **원 출처 귀속은 남긴다** — 남의 생각을 출처 없이
쓰는 게 더 나쁘다.

## 예시 산출물의 출처

`output/`의 내용은 2026년 한 세미나 세션에서 **김승권**(조슈아의컴퍼니), **배휘동**(코르카),
**황현태**(스페이스와우) 세 분이 발표·토론한 「AI 네이티브 컴퍼니」 주제의 내용을 정리한 것이다.
하네스의 동작을 보이기 위한 예시이며, 아이디어의 저작자는 위 세 분이다.
원본 녹음과 전사본은 저장소에 포함하지 않았다.

## 만든 방식

[mabu](https://github.com/ParkBeomMin/mabu) — 에이전트 하네스 아키텍트 스킬로 설계했다.
