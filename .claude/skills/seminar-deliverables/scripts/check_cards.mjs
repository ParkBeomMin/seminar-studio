#!/usr/bin/env node
// 아트보드 오버플로 검사. 의존성 없음 — Chrome --headless --dump-dom 만 쓴다.
//   node check_cards.mjs output/cardnews.html            (기본: .art 셀렉터, 1350px 한도)
//   node check_cards.mjs output/x.html --sel .slide --h 1080
// 고정 높이 아트보드의 실제 콘텐츠 높이를 한도와 대조한다.
// 넘치면 exit 1 — 폰트를 줄이라는 신호가 아니라 글을 줄이라는 신호다.
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [file, ...rest] = process.argv.slice(2)
if (!file) { console.error('usage: check_cards.mjs <html> [--sel .art] [--h 1350]'); process.exit(2) }
const arg = (n, d) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1] }
const sel = arg('--sel', '.art')
const limit = Number(arg('--h', 1350))

// rAF는 headless --dump-dom에서 프레임이 없어 안 돈다. fonts.ready + DOMContentLoaded만 쓴다.
// scrollHeight를 읽는 순간 강제 리플로가 걸리므로 레이아웃은 확정된다.
const probe = `<script>(function(){function go(){
  var els=document.querySelectorAll(${JSON.stringify(sel)}),out=[];
  // 고정 height + display:flex면 자식이 압축되거나 스페이서(flex:1)가 남은 공간을 흡수해서
  // scrollHeight도 자식 높이 합도 항상 한도와 같아진다. 둘 다 오버플로를 못 잡는다.
  // 그래서 클론을 height:auto로 띄워 '이 내용이 실제로 필요로 하는 높이'를 잰다.
  for(var i=0;i<els.length;i++){var el=els[i];
    var c=el.cloneNode(true);
    c.style.cssText+=';position:absolute;left:-99999px;top:0;transform:none;'+
      'height:auto;max-height:none;min-height:0;overflow:visible;visibility:hidden;'+
      'aspect-ratio:auto;';  // aspect-ratio가 살아있으면 height:auto가 무력화된다
    document.body.appendChild(c);
    var need=c.offsetHeight;
    document.body.removeChild(c);
    // 렌더 클리핑 검사: 축소 transform이 깨지면(예: scale(calc(540px/1080)) → 무단위가 아니라
    // 길이라서 무효) 카드가 원본 크기로 렌더돼 overflow:hidden 조상에 잘린다.
    // 내용량 검사만으로는 절대 못 잡는 실패라서 따로 잰다.
    var r=el.getBoundingClientRect(),clip=0,anc=el.parentElement;
    while(anc&&anc!==document.body){var as=getComputedStyle(anc);
      if(as.overflow!=='visible'||as.overflowX!=='visible'||as.overflowY!=='visible'){
        var ar=anc.getBoundingClientRect();
        if(r.width-ar.width>1||r.height-ar.height>1)clip=1;
        break;}
      anc=anc.parentElement;}
    out.push({i:i,content:need,box:el.clientHeight,clip:clip,
      rw:Math.round(r.width),rh:Math.round(r.height),
      label:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,38)});}
  var d=document.createElement('div');d.id='__probe';d.textContent=JSON.stringify(out);
  document.body.appendChild(d);}
function ready(){ (document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(go,go); }
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',ready):ready();})()<\/script>`

// Artifact용 HTML에는 <body>가 없다(발행 시 감싸짐) — 없으면 그냥 뒤에 붙인다.
const dir = mkdtempSync(join(tmpdir(), 'cardchk-'))
const tmp = join(dir, 'p.html')
const src = readFileSync(file, 'utf8')
writeFileSync(tmp, /<\/body>/i.test(src) ? src.replace(/<\/body>/i, probe + '</body>') : src + probe)

const dom = execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox',
  '--virtual-time-budget=8000', '--window-size=1400,2000', '--dump-dom', 'file://' + tmp],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })

const m = dom.match(/<div id="__probe">([\s\S]*?)<\/div>/)
if (!m) { console.error('측정 실패 — 페이지가 로드되지 않았거나 셀렉터가 틀렸다:', sel); process.exit(2) }
const un = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const cards = JSON.parse(un(m[1]))
if (!cards.length) { console.error('아트보드 0개 —', sel, '가 맞는지 확인하라'); process.exit(2) }

let bad = 0
for (const c of cards) {
  const over = c.content - limit
  if (over > 0 || c.clip) bad++
  console.log(`${over > 0 ? 'OVER' : 'ok  '} #${String(c.i).padStart(2)} ${String(c.content).padStart(5)}px/${limit}px` +
    `${over > 0 ? `  +${over}px 넘침 → 글을 줄여라` : ''}${c.clip ? `  [렌더 클리핑! ${c.rw}×${c.rh}px가 프레임 밖으로 — transform:scale() 확인]` : ''}   ${c.label}`)
}
console.log(`\n${cards.length}장 중 ${bad}장 오버플로`)
process.exit(bad ? 1 : 0)
