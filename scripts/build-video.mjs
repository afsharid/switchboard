import puppeteer from '/Users/mini/Projects/switchboard/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Records the demo video by driving the real deployed page through
 * document.modelContext — every tool call in the recording is genuine.
 *
 *   node scripts/build-video.mjs                    # macOS `say` narration
 *   node scripts/build-video.mjs --voice ./voice    # your own 01..15 audio
 *
 * With --voice, each line's on-screen action is timed to that line's actual
 * audio length, so swapping in a better voice needs no editing.
 */
const VOICE_DIR = (() => {
  const i = process.argv.indexOf('--voice');
  return i > -1 ? process.argv[i + 1] : null;
})();
const NARRATION = JSON.parse(readFileSync(new URL('../submission/narration.json', import.meta.url), 'utf8'));
const audioDuration = (f) => parseFloat(
  execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', f],
    { encoding: 'utf8' }).trim().replace(',', '.'));

const scenes = NARRATION.map((n) => {
  if (VOICE_DIR) {
    const hit = readdirSync(VOICE_DIR).find((f) => f.startsWith(n.id) && /\.(wav|mp3|aiff|m4a)$/i.test(f));
    if (!hit) throw new Error(`no audio for line ${n.id} in ${VOICE_DIR}`);
    return { ...n, dur: audioDuration(`${VOICE_DIR}/${hit}`), file: `${VOICE_DIR}/${hit}` };
  }
  const f = `/tmp/vo/${n.id}.aiff`;
  if (!existsSync(f)) execFileSync('say', ['-v','Samantha','-r','178','-o', f, n.text]);
  return { ...n, dur: audioDuration(f), file: f };
});
const dur = id => scenes.find(s=>s.id===id).dur * 1000;
const txt = id => scenes.find(s=>s.id===id).text;

const PROF='/tmp/ccprof-vid'; rmSync(PROF,{recursive:true,force:true}); mkdirSync(PROF,{recursive:true});
writeFileSync(`${PROF}/Local State`, JSON.stringify({browser:{enabled_labs_experiments:['enable-webmcp-testing@1']}}));
const b = await puppeteer.launch({
  executablePath:'/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  headless:'shell', userDataDir:PROF, defaultViewport:{width:1920,height:1080},
  args:['--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars','--force-device-scale-factor=1']});
const p = await b.newPage();
await p.setViewport({width:1920,height:1080,deviceScaleFactor:1});
await p.goto('http://localhost:4319/',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,2500));

// caption strip + a visible cursor, injected for the recording only
await p.evaluate(() => {
  const c = document.createElement('div');
  c.id='__cap';
  Object.assign(c.style,{position:'fixed',left:'0',right:'0',bottom:'0',zIndex:'9999',
    padding:'18px 40px',background:'linear-gradient(transparent,rgba(0,0,0,.92) 38%)',
    color:'#fff',font:'500 25px/1.4 system-ui,-apple-system,sans-serif',
    textAlign:'center',pointerEvents:'none',transition:'opacity .25s',minHeight:'92px'});
  document.body.appendChild(c);
  const k = document.createElement('div');
  k.id='__cur';
  Object.assign(k.style,{position:'fixed',width:'22px',height:'22px',zIndex:'10000',
    borderRadius:'50%',background:'rgba(255,255,255,.9)',boxShadow:'0 0 0 3px rgba(0,0,0,.5)',
    left:'-40px',top:'-40px',pointerEvents:'none',transition:'left .5s ease,top .5s ease,transform .12s'});
  document.body.appendChild(k);
});
const cap = t => p.evaluate(s=>{const e=document.getElementById('__cap'); e.style.opacity='1'; e.textContent=s;}, t);
const capOff = () => p.evaluate(()=>{document.getElementById('__cap').style.opacity='0';});
const wait = ms => new Promise(r=>setTimeout(r,ms));

// move the fake cursor to an element's centre, then optionally click it
const point = async (sel, textMatch) => {
  const box = await p.evaluate((sel,tm)=>{
    let el;
    if (tm) el=[...document.querySelectorAll(sel)].find(x=>(x.textContent??'').includes(tm));
    else el=document.querySelector(sel);
    if(!el) return null;
    el.scrollIntoView({block:'center',behavior:'smooth'});
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  }, sel, textMatch ?? null);
  if(!box) return null;
  await wait(1100);   // let the smooth scroll finish before measuring again
  const b2 = await p.evaluate((sel,tm)=>{
    let el; if (tm) el=[...document.querySelectorAll(sel)].find(x=>(x.textContent??'').includes(tm));
    else el=document.querySelector(sel);
    const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};
  }, sel, textMatch ?? null);
  await p.evaluate(({x,y})=>{const k=document.getElementById('__cur');k.style.left=(x-11)+'px';k.style.top=(y-11)+'px';}, b2);
  await wait(650);
  return b2;
};
const press = async () => { await p.evaluate(()=>{const k=document.getElementById('__cur');k.style.transform='scale(.6)';}); await wait(140);
  await p.evaluate(()=>{document.getElementById('__cur').style.transform='scale(1)';}); };
const clickText = async (sel, tm) => { await point(sel,tm); await press();
  await p.evaluate((sel,tm)=>{const el=[...document.querySelectorAll(sel)].find(x=>(x.textContent??'').includes(tm)); el?.click();}, sel, tm); };
const scrollTo = async (sel, tm) => { await p.evaluate((sel,tm)=>{
    const el = tm ? [...document.querySelectorAll(sel)].find(x=>(x.textContent??'').includes(tm)) : document.querySelector(sel);
    el?.scrollIntoView({block:'center',behavior:'smooth'});}, sel, tm??null); await wait(800); };
const T = (n,a={}) => p.evaluate(async(n,a)=>{
  const t=(await document.modelContext.getTools()).find(x=>x.name===n);
  return await document.modelContext.executeTool(t, JSON.stringify(a));}, n, a);

const rec = await p.screencast({path:'/tmp/vo/raw.webm'});
const t0=Date.now();
const offsets=[];
const scene = async (id, fn) => {
  const target = dur(id);
  const start = Date.now();
  offsets.push({ id, at: +((start - t0) / 1000).toFixed(2) });
  await cap(txt(id));
  if (fn) await fn();
  const left = target - (Date.now()-start);
  if (left > 0) await wait(left);
  await wait(600); // beat between lines
  console.log(`  ${id}  ${((Date.now()-t0)/1000).toFixed(1)}s`);
};

await scene('01', async()=>{ await p.evaluate(()=>window.scrollTo({top:0})); await wait(1200);
  await p.evaluate(()=>window.scrollTo({top:420,behavior:'smooth'})); });
await scene('02', async()=>{ await p.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'})); });
await scene('03', async()=>{ await scrollTo('section','Agent console');
  await clickText('summary','tools the browser reports'); });
await scene('04', async()=>{ await scrollTo('section','Traffic classes'); });
await scene('05', async()=>{ await T('find_waste'); await T('compare_models',{classId:'batch',optimiseFor:'cost'});
  await T('compare_models',{classId:'realtime',optimiseFor:'latency'});
  await scrollTo('section','Agent activity'); });
await scene('06', async()=>{ await T('simulate_policy',{label:'Under $25/mo, realtime p95 under 4s',rules:[
    {classId:'realtime',primaryModelId:'opencode-go/gpt-5.6-luna',fallbackModelIds:[]},
    {classId:'batch',primaryModelId:'opencode-go/deepseek-v4-flash',fallbackModelIds:[]}]});
  await wait(400); await scrollTo('section','Simulation'); });
await scene('07', async()=>{ await T('propose_policy_change',{rationale:'Realtime uses the only eligible model, GPT 5.6 Luna. Batch uses the lowest-cost eligible model, DeepSeek V4 Flash. Total projected $22.84/mo, under the requested $25.',
    rules:[{classId:'realtime',primaryModelId:'opencode-go/gpt-5.6-luna',fallbackModelIds:[]},
           {classId:'batch',primaryModelId:'opencode-go/deepseek-v4-flash',fallbackModelIds:[]}]});
  await wait(500); await scrollTo('section','Approval queue'); });
await scene('08', async()=>{ await point('input[placeholder*="Optional note"]'); await press();
  await p.focus('input[placeholder*="Optional note"]');
  await p.type('input[placeholder*="Optional note"]','realtime has no fallback — if GPT 5.6 Luna goes down the whole class is dead',{delay:26});
  await clickText('button','Reject'); });
await scene('09', async()=>{ await T('get_proposal_status',{proposalId:'P-1'}); await T('get_model',{modelId:'opencode-go/minimax-m3'});
  await T('propose_policy_change',{rationale:'Addresses the rejection by adding MiniMax M3 as a degraded fallback behind GPT 5.6 Luna. No second model is fully eligible under the 4000ms ceiling; MiniMax M3 is the closest at 4187ms. Its 187ms overage is retained as an explicit warning, not hidden.',
    rules:[{classId:'realtime',primaryModelId:'opencode-go/gpt-5.6-luna',fallbackModelIds:['opencode-go/minimax-m3']},
           {classId:'batch',primaryModelId:'opencode-go/deepseek-v4-flash',fallbackModelIds:[]}]});
  await wait(500); await scrollTo('section','Approval queue'); });
await scene('10', async()=>{ await clickText('button','Approve'); await wait(900);
  await p.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'})); });
await scene('11', async()=>{ await scrollTo('article','Customer-data explanations'); });
await scene('12', async()=>{ await T('compare_models',{classId:'sensitive',optimiseFor:'balanced'}); });
await scene('13', async()=>{
  await clickText('summary','relax constraints (0 models eligible)');
  await wait(500);
  // aim at the retention control inside the customer-data card specifically
  await p.evaluate(()=>{
    const card=[...document.querySelectorAll('article')].find(c=>/Customer-data explanations/.test(c.textContent??''));
    card.querySelector('select')?.setAttribute('data-shot','retention');
  });
  await point('select[data-shot="retention"]');
  await press();
  await p.evaluate(()=>{const s=document.querySelector('select[data-shot="retention"]');
    s.value='30'; s.dispatchEvent(new Event('change',{bubbles:true}));}); });
await scene('14', async()=>{ await T('compare_models',{classId:'sensitive',optimiseFor:'balanced'});
  await T('pin_insight',{title:'Customer-data retention trade-off',
    body:'Operator accepted 30-day retention. GPT 5.6 Luna is the only eligible model at $2.43/mo, with no compliant fallback depth.'});
  await wait(600); await scrollTo('article','Customer-data explanations'); });
await scene('15', async()=>{ await p.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'})); });
await capOff(); await wait(900);
await rec.stop();
writeFileSync('/tmp/vo/offsets.json', JSON.stringify(offsets, null, 1));
console.log('recorded', ((Date.now()-t0)/1000).toFixed(1)+'s');
await b.close();

// mux: lay each line at the offset it was actually recorded at, not a computed
// one — a line whose on-screen action runs long would otherwise shift the rest
const inputs = [], filters = [], mixes = [];
scenes.forEach((s, n) => {
  const ms = Math.round(offsets.find(o => o.id === s.id).at * 1000);
  inputs.push('-i', s.file);
  filters.push(`[${n}:a]adelay=${ms}|${ms},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${n}]`);
  mixes.push(`[a${n}]`);
});
const fc = filters.join(';') + ';' + mixes.join('')
  + `amix=inputs=${scenes.length}:dropout_transition=0:normalize=0[m];[m]loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', fc, '-map', '[out]', '-c:a', 'pcm_s16le', '/tmp/vo/voice.wav'],
  { stdio: 'ignore' });
const OUT = new URL('../submission/switchboard-demo.mp4', import.meta.url).pathname;
execFileSync('ffmpeg', ['-y','-i','/tmp/vo/raw.webm','-i','/tmp/vo/voice.wav',
  '-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p',
  '-r','30','-movflags','+faststart','-c:a','aac','-b:a','192k','-ar','48000','-af','apad=pad_dur=3', OUT],
  { stdio: 'ignore' });
console.log('wrote', OUT, '·', audioDuration(OUT).toFixed(1) + 's');
