export const meta = {
  name: 'seminar-studio',
  description: '세미나 녹음 → 전사 → 코어 분석 → 팩트체크 → 산출물 4종(요약·카드뉴스·인포그래픽·PPT) 병렬 생성',
  phases: [
    { title: '전사', detail: 'mlx_whisper 로컬 전사 + 정제 (haiku)' },
    { title: '분석', detail: '전사본 → 02_core.json 단일 출처 추출' },
    { title: '팩트체크', detail: '코어를 전사본과 대조 — 환각·오인용·오귀속 게이트' },
    { title: '분할', detail: '세션(발표/패널) 단위로 파트 분할' },
    { title: '산출', detail: '파트 × 4종 병렬 생성' },
  ],
}

// ---- 스키마: 산출물 형식을 도구 계층이 강제한다 ----
const TRANSCRIPT = {
  type: 'object', required: ['path', 'durationSec', 'sectionCount'],
  properties: {
    path: { type: 'string' }, durationSec: { type: 'number' },
    sectionCount: { type: 'integer' }, uncertainCount: { type: 'integer' },
    speakers: { type: 'array', items: { type: 'string' } },
  },
}

const CORE = {
  type: 'object', required: ['path', 'thesis', 'claimCount', 'confidence'],
  properties: {
    path: { type: 'string' }, thesis: { type: 'string' },
    claimCount: { type: 'integer' }, quoteCount: { type: 'integer' },
    numberCount: { type: 'integer' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT = {
  type: 'object', required: ['pass', 'issues'],
  properties: {
    pass: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object', required: ['path', 'kind', 'detail'],
        properties: {
          path: { type: 'string' },
          kind: { type: 'string', enum: ['hallucination', 'misquote', 'misattribution', 'number', 'note'] },
          detail: { type: 'string' },
        },
      },
    },
  },
}

const ARTIFACT = {
  type: 'object', required: ['part', 'format', 'path'],
  properties: {
    part: { type: 'string' }, format: { type: 'string' }, path: { type: 'string' },
    artifactUrl: { type: 'string' }, notes: { type: 'string' },
  },
}

const PARTS = {
  type: 'object', required: ['parts'],
  properties: {
    parts: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', required: ['id', 'title', 'range', 'thesis', 'sectionIds'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' },
          kind: { type: 'string' }, range: { type: 'string' },
          thesis: { type: 'string' },
          speakers: { type: 'array', items: { type: 'string' } },
          sectionIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const DEF = (n) => `이 프로젝트의 .claude/agents/${n}.md를 읽고 그 역할·원칙·출력 규약대로 작업하라.`
const BRIEF = JSON.stringify(args.brief ?? {}, null, 1)

// ---- 전사 ----
phase('전사')
const transcript = args.transcriptPath
  ? { path: args.transcriptPath, durationSec: 0, sectionCount: 0 }
  : await agent(
      `${DEF('seminar-transcriber')}\n\n` +
      `입력 파일: ${args.input}\n브리프: ${BRIEF}\n\n` +
      `브리프의 주제·발표자·전문용어를 mlx_whisper의 --initial-prompt에 반드시 넣어라. ` +
      `결과는 _workspace/01_transcript.md 에 쓰고 경로와 통계만 반환하라.`,
      { label: 'transcribe', phase: '전사', schema: TRANSCRIPT, model: 'haiku', effort: 'low' })

if (!transcript) return { error: '전사 실패 — 오디오 입력을 확인하라', stage: '전사' }

// ---- 분석 → 팩트체크 게이트 (수정 루프 상한 2회, 코드로 강제) ----
phase('분석')
let core = await agent(
  `${DEF('seminar-analyst')}\n\n` +
  `전사본: ${transcript.path}\n브리프: ${BRIEF}\n\n` +
  `_workspace/02_core.json 을 쓰고 요약 통계를 반환하라.`,
  { label: 'analyze', phase: '분석', schema: CORE, effort: 'high' })

if (!core) return { error: '코어 분석 실패', stage: '분석', transcript }

let verdict = null
for (let attempt = 0; attempt < 2; attempt++) {
  phase('팩트체크')
  verdict = await agent(
    `${DEF('seminar-factcheck')}\n\n` +
    `대조 대상: ${core.path}\n원본: ${transcript.path}\n\n` +
    `환각·오인용·화자 오귀속·수치 오류만 판정하라. 문체는 issue가 아니다.`,
    { label: `factcheck:${attempt + 1}`, phase: '팩트체크', schema: VERDICT, model: 'sonnet', effort: 'medium' })

  if (!verdict || verdict.pass) break

  const blocking = verdict.issues.filter(i => i.kind !== 'note')
  if (blocking.length === 0) { verdict.pass = true; break }

  phase('분석')
  const revised = await agent(
    `${DEF('seminar-analyst')}\n\n` +
    `이전 코어(${core.path})의 아래 지적사항만 수정하라. 통과한 항목의 문구는 손대지 마라 ` +
    `— 다른 산출물이 이미 그 문구를 참조한다.\n` +
    `전사본: ${transcript.path}\n지적사항:\n${blocking.map(i => `- [${i.kind}] ${i.path}: ${i.detail}`).join('\n')}`,
    { label: `revise:${attempt + 1}`, phase: '분석', schema: CORE, effort: 'high' })
  if (!revised) break
  core = revised
}

// ---- 세션 분할: 한 녹음에 발표·패널이 섞여 있으면 파트마다 따로 만든다 ----
phase('분할')
const split = await agent(
  `${DEF('seminar-analyst')}\n\n` +
  `코어: ${core.path}\n전사본: ${transcript.path}\n\n` +
  `.claude/skills/seminar-core/SKILL.md 의 §1-1을 읽고 parts를 산출하라. ` +
  `발표자 교체 또는 형식 전환(발표→패널→Q&A)이 기준이며, 주제 변화만으로는 나누지 않는다. ` +
  `사회자 오프닝·세션 전환·부스 안내처럼 내용 없는 구간은 어느 파트에도 넣지 마라. ` +
  `각 파트는 전체 thesis를 복사하지 말고 자기만의 thesis를 갖는다. ` +
  `parts를 ${core.path} 에도 반영해 저장하라.`,
  { label: 'split', phase: '분할', schema: PARTS, effort: 'high' })

const parts = split?.parts?.length
  ? split.parts
  : [{ id: 'part1', title: core.thesis, range: '전체', thesis: core.thesis, sectionIds: [] }]

// ---- 산출: 파트 × 4종 병렬 ----
// parallel(바리어) 사용 근거: 같은 파트의 4종이 용어·톤을 맞춰야 하므로 전부 끝난 뒤 일괄 보고한다.
phase('산출')
const FORMATS = ['summary', 'cardnews', 'infographic', 'deck']
const jobs = []
for (const part of parts) {
  for (const format of FORMATS) {
    jobs.push(() => agent(
      `${DEF('seminar-composer')}\n\n` +
      `format: ${format}\npart: ${JSON.stringify(part)}\n코어: ${core.path}\n브리프: ${BRIEF}\n\n` +
      `.claude/skills/seminar-deliverables/SKILL.md 에서 '${format}' 절의 규격만 읽고 따르라. ` +
      `이 파트의 sectionIds에 속한 항목만 써라 — 다른 파트의 내용을 끌어오지 마라. ` +
      `산출물은 output/${part.id}/ 아래에 쓴다. ` +
      `공통 비주얼 시스템(§0)은 임의로 바꾸지 마라. ` +
      `코어에 없는 사실을 추가하지 마라 — 허전한 곳은 채우지 말고 줄여라. ` +
      `§0-1을 반드시 지켜라: 이 산출물이 녹음에서 나왔다는 티를 내지 마라. ` +
      `타임코드·구간 표기·녹음 길이·"발표자가 말했다" 프레이밍·"1부/2부" 세션 구조·전사 결손 고지를 넣지 마라. ` +
      `part의 range는 내부 식별용이니 산출물에 쓰지 마라. part의 title을 그 글의 제목으로 써라. ` +
      `근거가 약한 수치·고유명사는 경고를 달지 말고 빼라. 아이디어의 원 출처 귀속(누가 한 말인지)은 남겨라.` +
      (format === 'deck'
        ? `\n먼저 _workspace/${part.id}_deck_spec.json 을 쓰고, .venv/bin/python 으로 번들 스크립트를 실행해 output/${part.id}/deck.pptx 를 만들어라.`
        : '') +
      (format === 'cardnews'
        ? `\n완성 전에 반드시 게이트를 통과시켜라: node .claude/skills/seminar-deliverables/scripts/check_cards.mjs output/${part.id}/cardnews.html --sel .card` +
          `\nexit 0이 아니면 완성이 아니다. '렌더 클리핑'은 CSS 문제(§2의 scale() 함정), '+Npx 넘침'은 글을 줄이라는 뜻이다.`
        : ''),
      { label: `compose:${part.id}:${format}`, phase: '산출', schema: ARTIFACT, effort: 'high' }))
  }
}
const outputs = (await parallel(jobs)).filter(Boolean)

const missing = []
for (const part of parts) {
  for (const format of FORMATS) {
    if (!outputs.some(o => o.part === part.id && o.format === format)) missing.push(`${part.id}/${format}`)
  }
}

return {
  transcript,
  core: { path: core.path, thesis: core.thesis, confidence: core.confidence, assumptions: core.assumptions ?? [] },
  factcheck: verdict ?? { pass: false, issues: [{ path: '-', kind: 'note', detail: '팩트체크 미실행' }] },
  parts: parts.map(p => ({ id: p.id, title: p.title, range: p.range, speakers: p.speakers ?? [] })),
  outputs,
  missing,                              // 누락은 숨기지 않는다
  notes: verdict && !verdict.pass
    ? '팩트체크 미통과 상태로 산출됨 — issues를 확인하라'
    : undefined,
}
