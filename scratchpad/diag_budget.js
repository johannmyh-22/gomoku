'use strict';
// 「预算翻倍」诊断 —— 一个实验回答两个问题。
//
// 【问题一：瓶颈在搜索还是评估？】
//   同一个引擎，一边用出厂预算、一边用双倍预算对打。
//     收益大  -> 搜索远未饱和，深度仍是杠杆，该继续找搜索侧的改动
//     收益小  -> 搜索已饱和，瓶颈在**评估函数**，该把力气投到那边
//
// 【问题二（更要紧）：这套测量台还能不能测出东西？】
//   本项目连续五次改动全部「无收益」（根过滤兜底、TT 跨步保留、VCT 置换表、
//   rootsort、杀棋分 ply 校正 + TT 跨步保留）。在下第六次结论之前，必须先确认
//   **A/B 本身有分辨力**。预算翻倍是已知该有明显收益的改动，是天然的**阳性对照**：
//   连它都测不出来，就说明问题在测量台，前面五个 null 全部要打问号。
//
// ⚠️ 关于「配置必须与 LEVELS 出厂值逐项一致」这条硬规矩：
//   本脚本的双倍预算臂**故意不是出厂配置**，这是诊断的定义决定的，不是配置错误。
//   它**不是**一个候选改动、**不会**被合入。硬规矩针对的是「拿不存在的引擎测出收益
//   然后当成真结论」（见 PROGRESS 里 +90 Elo 那次），与此处的用途不同。
//   对照臂与被测的基线臂都是**逐项照抄的出厂配置**。
//
// 用法：
//   node diag_budget.js                       # LV3、2 倍预算、200 局 + 对照 12 局
//   node diag_budget.js --level=3 --mul=2 --openings=100 --workers=4
const os = require('os');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { build } = require('./load.js');

function argVal(name, def) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  return p ? p.split('=')[1] : def;
}
const LEVEL = Number(argVal('level', 3));
const MUL = Number(argVal('mul', 2));
const WORKERS = Number(argVal('workers', os.cpus().length));
const CTRL_OPENINGS = Number(argVal('controlOpenings', 6));
const AB_OPENINGS = Number(argVal('openings', 100));
const OP_FROM = Number(argVal('openingFrom', 0));
const OP_TO = Number(argVal('openingTo', 0)) || null;
const RUN_CONTROL = argVal('runControl', '1') !== '0';
const OUTFILE = argVal('out', '');
const SEED0 = Number(argVal('seed', 20260813));

// 逐项照抄 index.html 的 LEVELS —— 基线臂与对照臂用的都是真出厂配置
const LEVELS = {
  3: { timeMs:1500, maxDepth:8,  vcfDepth:10, vcfBudget:120000, vctDepth:5, vctBudget:80000,
       vctDefDepth:0, vctDefBudget:0,     rand:0, rootFilter:false, forbid:false },
  4: { timeMs:4000, maxDepth:12, vcfDepth:14, vcfBudget:400000, vctDepth:7, vctBudget:400000,
       vctDefDepth:5, vctDefBudget:60000, rand:0, rootFilter:true,  forbid:false },
  5: { timeMs:9000, maxDepth:18, vcfDepth:20, vcfBudget:1200000,vctDepth:9, vctBudget:1500000,
       vctDefDepth:7, vctDefBudget:150000,rand:0, rootFilter:true,  forbid:false },
};
const BASE = LEVELS[LEVEL];
if (!BASE) throw new Error('level 必须是 3/4/5');
// 只放大时间预算。算杀的节点上限（vcfBudget/vctBudget）一并放大，否则时间给够了
// 算杀却先撞节点墙，测出来的就不是「预算翻倍」而是「预算翻倍但算杀不变」。
const BIG = Object.assign({}, BASE, {
  timeMs: BASE.timeMs * MUL,
  vcfBudget: BASE.vcfBudget * MUL,
  vctBudget: BASE.vctBudget * MUL,
  vctDefBudget: BASE.vctDefBudget * MUL,
});

build('orig'); build('orig2');

let seed = SEED0;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function genOpenings(n) {
  const out = [];
  while (out.length < n) {
    const s = new Set(), mv = [];
    while (mv.length < 3) {
      const x = 5 + ((rnd() * 5) | 0), y = 5 + ((rnd() * 5) | 0);
      if (s.has(y * 15 + x)) continue;
      s.add(y * 15 + x); mv.push([x, y]);
    }
    out.push(mv);
  }
  return out;
}
function buildJobs(matchName, modA, modB, cfgA, cfgB, openings) {
  const jobs = [];
  for (const op of openings) for (let swap = 0; swap < 2; swap++)
    jobs.push({ type: 'game', matchName, modA, modB, cfgA, cfgB, opening: op, swap });
  return jobs;
}

const ctrlOps = genOpenings(CTRL_OPENINGS), abOpsAll = genOpenings(AB_OPENINGS);
const abOps = abOpsAll.slice(OP_FROM, OP_TO === null ? AB_OPENINGS : OP_TO);
const jobs = RUN_CONTROL
  ? buildJobs('对照 出厂 vs 出厂（必须 6:6）', 'orig', 'orig2', BASE, BASE, ctrlOps) : [];
jobs.push(...buildJobs(`${MUL}倍预算 vs 出厂`, 'orig', 'orig2', BIG, BASE, abOps));
jobs.forEach((j, i) => { j.id = i; });

console.log(`阳性对照诊断：LV${LEVEL} 出厂 ${BASE.timeMs}ms  vs  ${MUL} 倍预算 ${BIG.timeMs}ms`);
console.log(`共 ${jobs.length} 局，${WORKERS} 个并行进程，种子 ${SEED0}`);
console.log(`对照 ${RUN_CONTROL ? ctrlOps.length * 2 : 0} 局 + 诊断 ${abOps.length * 2} 局` +
  `（开局下标 [${OP_FROM},${OP_TO === null ? AB_OPENINGS : OP_TO}) / 共 ${AB_OPENINGS}）\n`);

const results = {};
let done = 0;
const startMs = Date.now();

// 断点续跑（后台长任务会被清理杀掉，见 PROGRESS「一之六」）
const doneIds = new Set();
if (OUTFILE && fs.existsSync(OUTFILE)) {
  let bad = 0;
  for (const line of fs.readFileSync(OUTFILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    if (o.id === undefined || o.seed !== SEED0 || o.level !== LEVEL || o.mul !== MUL ||
        o.from !== OP_FROM || o.to !== (OP_TO === null ? AB_OPENINGS : OP_TO)) { bad++; continue; }
    if (doneIds.has(o.id)) continue;
    doneIds.add(o.id);
    const r = results[o.match] || (results[o.match] = { a: 0, b: 0, d: 0 });
    if (o.aWon === null) r.d++; else if (o.aWon) r.a++; else r.b++;
  }
  if (bad) console.log(`⚠ ${OUTFILE} 有 ${bad} 行参数不符或旧格式，已忽略`);
  if (doneIds.size) { done = doneIds.size;
    console.log(`断点续跑：已完成 ${done} 局，补跑 ${jobs.length - done} 局\n`); }
}
const pending = jobs.filter(j => !doneIds.has(j.id));

const workers = [];
let nextIdx = 0;
function sendExit(w) {
  if (w.exitRequested || !w.connected) return;
  w.exitRequested = true;
  try { w.send({ type: 'exit' }); } catch (e) {}
}
function assignNext(w) {
  if (nextIdx >= pending.length) { sendExit(w); return; }
  w.send(pending[nextIdx++]);
}

for (let i = 0; i < WORKERS; i++) {
  const w = fork(path.join(__dirname, 'ab_worker.js'));
  w.on('error', () => {});
  w.on('message', (msg) => {
    if (msg.type !== 'result') return;
    done++;
    const r = results[msg.matchName] || (results[msg.matchName] = { a: 0, b: 0, d: 0 });
    if (msg.aWon === null) r.d++; else if (msg.aWon) r.a++; else r.b++;
    const el = ((Date.now() - startMs) / 1000).toFixed(0);
    const who = msg.aWon === null ? '和' : (msg.aWon ? '胜=左' : '胜=右');
    console.log(`[${done}/${jobs.length}] ${msg.matchName}  ${who}  ` +
      `累计 ${r.a}:${r.b}和${r.d}  (${msg.len}手 ${msg.reason})  ${el}s`);
    if (OUTFILE) {
      try {
        fs.appendFileSync(OUTFILE, JSON.stringify({
          id: msg.id, match: msg.matchName, aWon: msg.aWon, len: msg.len, reason: msg.reason,
          seed: SEED0, level: LEVEL, mul: MUL, from: OP_FROM,
          to: OP_TO === null ? AB_OPENINGS : OP_TO,
          a: r.a, b: r.b, d: r.d, elapsed: Number(el),
        }) + '\n');
      } catch (e) {}
    }
    if (done >= jobs.length) finish(); else assignNext(w);
  });
  workers.push(w);
}
if (!pending.length) { console.log('已全部完成，直接汇总。'); finish(); }
else workers.forEach(assignNext);

function finish() {
  const erf = x => { const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911;
    const t = 1/(1+p*x);
    return s*(1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x)); };
  const elo = r => -400*Math.log10(1/r-1);
  console.log('\n=== 结果 ===');
  for (const [name, r] of Object.entries(results)) {
    const n = r.a + r.b, sd = Math.sqrt(n)/2, z = n ? (r.a - n/2)/sd : 0;
    const rate = n ? r.a/n : 0.5;
    console.log(`\n${name}`);
    console.log(`  ${r.a} : ${r.b}   和 ${r.d}   (共 ${r.a+r.b+r.d} 局)`);
    if (name.startsWith('对照')) {
      console.log(`  ${r.a === r.b ? '✅ 干净' : '❌ 不是 6:6 —— 还有别的随机源，本轮数据不可信'}`);
    } else {
      const se = Math.sqrt(rate*(1-rate)/n);
      console.log(`  z = ${z.toFixed(2)}σ   双侧 p = ${(1-erf(Math.abs(z)/Math.SQRT2)).toFixed(3)}`);
      console.log(`  胜率 ${(rate*100).toFixed(1)}%  ≈ ${elo(rate).toFixed(0)} Elo`);
      console.log(`  95% CI ${((rate-1.96*se)*100).toFixed(1)}% ~ ${((rate+1.96*se)*100).toFixed(1)}%` +
        `  ≈ ${elo(rate-1.96*se).toFixed(0)} ~ ${elo(rate+1.96*se).toFixed(0)} Elo`);
      console.log('\n  判读：');
      if (z >= 2) {
        console.log('   ✅ 测量台有分辨力 —— 阳性对照通过，之前五个 null 是可信的');
        console.log('   → 搜索**未饱和**，深度仍是杠杆；搜索侧值得继续找方向');
      } else if (z > -2) {
        console.log('   ⚠ 预算翻倍都测不出差异。两种可能，必须分清：');
        console.log('     (a) 搜索已饱和 —— 瓶颈在评估函数，该投那边');
        console.log('     (b) 测量台没有分辨力 —— 那么之前五个「无收益」全部要打问号');
        console.log('     区分办法：加大倍数（--mul=4 甚至 8）。若 4 倍、8 倍仍无差异，');
        console.log('     几乎可以断定是 (b)，因为不可能有引擎对 8 倍算力完全无动于衷。');
      } else {
        console.log('   ❌ 预算翻倍反而更差 —— 这不该发生，先查测量台是否有 bug');
      }
    }
  }
  if (OUTFILE) {
    try {
      fs.writeFileSync(OUTFILE.replace(/\.jsonl?$/, '') + '.summary.json',
        JSON.stringify({ seed: SEED0, level: LEVEL, mul: MUL, base: BASE, big: BIG,
          openingFrom: OP_FROM, openingTo: OP_TO, results }, null, 2));
    } catch (e) {}
  }
  workers.forEach(sendExit);
  setTimeout(() => process.exit(0), 200);
}
