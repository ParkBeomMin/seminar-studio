---
name: seminar-transcribe
description: 세미나·강연·회의 녹음(m4a/mp3/wav/mp4)을 mlx_whisper로 전사하고 정제하는 절차. 오디오 전사, 자막 파일 정제, 긴 녹음 청킹, 타임코드 정리, 한국어 세미나 전사 품질 보정이 필요할 때 반드시 사용. "전사해줘", "받아쓰기", "녹음 텍스트로" 요청 및 재전사·구간 수정 요청 포함.
allowed-tools: Bash, Read, Write, Glob
---

# 세미나 전사

이 환경의 전사 백엔드는 **mlx_whisper**(Apple Silicon 로컬)다. API 호출이 아니라 로컬 실행이라
파일이 밖으로 나가지 않는다 — 비공개 세미나 녹음을 다루는 하네스라 이 선택이 기본값이다.

## 1. 입력 판별 — 먼저 이것부터

| 입력 | 행동 |
|------|------|
| `.txt` `.srt` `.vtt` `.json` | **전사하지 마라.** §4 정제부터 시작 |
| `.m4a` `.mp3` `.wav` `.flac` | §2로 |
| `.mp4` `.mov` `.mkv` | §2 (ffmpeg이 오디오만 뽑는다) |

## 2. 전처리 — 항상 wav로 정규화

whisper는 16kHz mono를 먹는다. 원본을 그대로 던지면 코덱에 따라 조용히 실패하거나
느려진다. 한 줄로 끝내라:

```bash
ffmpeg -y -i "input/seminar.m4a" -ar 16000 -ac 1 -c:a pcm_s16le "_workspace/audio.wav" 2>&1 | tail -3
ffprobe -v error -show_entries format=duration -of csv=p=0 "_workspace/audio.wav"   # 길이 확인
```

## 3. 전사 실행

```bash
mlx_whisper "_workspace/audio.wav" \
  --model mlx-community/whisper-large-v3-turbo \
  --language ko \
  --output-dir _workspace --output-name 01_transcript --output-format all \
  --initial-prompt "AI 에이전트, 하네스, 오케스트레이션, LLM, 파인튜닝"
```

- **`--initial-prompt`가 고유명사 정확도의 가장 큰 레버다.** 브리프에 발표자·주제·전문용어가
  있으면 전부 여기 넣어라. 없으면 세미나 제목만이라도 넣는다. 이걸 비우면 한국어 전문용어가
  일상어로 뭉개진다 (예: "에이전트" → "에이전시")
- 모델은 `whisper-large-v3-turbo`가 기본. 1시간 녹음에 수 분. 첫 실행은 모델 다운로드(~1.5GB)로 더 걸린다
- 속도가 급하면 `mlx-community/whisper-medium-mlx`, 정확도가 급하면 `whisper-large-v3-mlx`

### 60분 초과 — 청킹

메모리와 드리프트 때문에 긴 파일은 자른다. **오프셋 보정을 빼먹지 마라** — 청크 2의
타임코드는 0부터 시작하므로 그대로 붙이면 뒤쪽 전체가 어긋난다.

```bash
ffmpeg -y -i _workspace/audio.wav -f segment -segment_time 1800 -c copy _workspace/chunk_%03d.wav
# 각 청크 전사 후, chunk_00N의 모든 타임코드에 (N * 1800초)를 더해서 병합
```

## 4. 정제 — 무엇을 지우고 무엇을 남기나

전사는 **원문 보존이 기본값**이다. 정제는 기계적으로 판별 가능한 것만 건드린다.
요약·윤색은 여기서 하지 않는다 — 뒤 단계가 복구할 수 없는 손실이 된다.

| 지운다 | 남긴다 |
|--------|--------|
| 반복 필러 (`어…`, `음…`, `그…`가 연속) | 발표자의 강조·반복 (`정말 중요한 건, 정말 중요한 건`) |
| whisper 환각 반복 (같은 문장 3회 이상 연속) | 비문·구어체 문장 구조 |
| 무음 구간의 자막 조각 | 청중 질문·웃음 등 맥락 표시 |
| — | 불확실한 고유명사 → **`[?용어]`로 표시해 넘긴다** |

**whisper 환각 신호:** 무음이나 배경음 구간에서 같은 문장을 반복하거나, 갑자기 다른
언어가 나오거나, "시청해주셔서 감사합니다" 류의 유튜브 상투구가 나온다. 이건 오디오에
없는 말이므로 지운다.

## 5. 출력 형식 — `_workspace/01_transcript.md`

```markdown
# {세미나 제목}
- 원본: input/seminar.m4a · 길이: 01:47:23 · 모델: whisper-large-v3-turbo
- 불확실 표시: 12건

## [00:00:00] 여는 말
텍스트…

## [00:04:12] {구간 주제}
텍스트… 여기서 [?RAG] 파이프라인이…
```

- 구간은 **주제가 바뀌는 지점**에서 나눈다. 5분 고정 간격으로 자르면 분석 담당이 다시 붙여야 한다
- 화자가 여럿이면 `**발표자A:**` 접두사를 붙인다. whisper는 화자 분리를 못 하므로 문맥으로 판단하되, 확신 없으면 붙이지 않는다 — **틀린 귀속이 없는 것보다 나쁘다**
- 원본 json(`01_transcript.json`)은 지우지 않는다. 나중에 타임코드를 다시 볼 근거다

## 6. 자주 나는 실패

| 증상 | 원인 | 대응 |
|------|------|------|
| 전사가 비어 있음 | 코덱/샘플레이트 | §2 wav 정규화 재실행 |
| 전문용어가 전부 엉뚱함 | `--initial-prompt` 누락 | 용어 넣고 재실행 |
| 뒤쪽 타임코드가 어긋남 | 청크 오프셋 미보정 | §3 청킹 참조 |
| 같은 문장 반복 | 무음 구간 환각 | §4에서 제거 |
| 모델 다운로드 실패 | 네트워크 | 1회 재시도 후 에러 원문 보고. **빈 전사본을 만들지 마라** |
