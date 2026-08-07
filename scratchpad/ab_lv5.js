'use strict';
// LV5（地狱级）多臂 A/B：一次并行跑完「对照 + 多个候选变体 vs 出厂引擎」。
//
// 背景：实测 LV5 单手只用掉 56~74% 的 9 秒预算，maxDepth 写 18 实际只搜到 12~13 层。
// 三个候选各自针对一处浪费（详见 load.js 里 ROOTSORT / DEEPER / PARTIAL 的注释）：
//   rootsort    —— 迭代加深每层结束后按上层分数重排根着法（sortRoot 原本只在弱难度随机里用过）
//   deeppartial —— 收尾阈值 45%->65% + 采纳超时那层已搜完的部分结果
//   lv5all      —— 上面两者都开
//
// 为什么 deeper / partial 不单独测：3 个 LV5 局面的插桩显示，partial 单独跑跟出厂
// 逐字节相同（45% 阈值下搜索是干净收工的，没有半层结果可捡）；deeper 单独把预算用到
// 100% 但深度不涨（多搜的那层超时后整层被丢）。两者必须配对才有意义。
//
// 用法：
//   node ab_lv5.js                          # 对照 + 3 个变体，每臂 24 局
//   node ab_lv5.js --openings=6             # 每臂 12 局，快速摸底
//   node ab_lv5.js --arms=rootsort          # 只测指定变体
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { build } = require('./load.js');

function argVal(name, def) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  return p ? p.split('=')[1] : def;
}
const WORKERS = Number(argVal('workers', os.cpus().length));
const CTRL_OPENINGS = Number(argVal('controlOpenings', 6));
const AB_OPENINGS = Number(argVal('openings', 12));   // -> 2 * openings 局/臂
const ARMS = argVal('arms', 'rootsort,deeppartial,lv5all').split(',').filter(Boolean);

// 逐项照抄 index.html 的 LEVELS[5]
const LV5 = { timeMs: 9000, maxDepth: 18, vcfDepth: 20, vcfBudget: 1200000, vctDepth: 9,
  vctBudget: 1500000, vctDefDepth: 7, vctDefBudget: 150000, rand: 0, rootFilter: true, forbid: false };

build('orig'); build('orig2');
for (const a of ARMS) build(a);

let seed = 20260811;
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

function buildJobs(matchName, modA, modB, openings) {
  const jobs = [];
  for (const op of openings) for (let swap = 0; swap < 2; swap++)
    jobs.push({ type: 'game', matchName, modA, modB, cfgA: LV5, cfgB: LV5, opening: op, swap });
  return jobs;
}

// 所有臂用同一批开局，可比性更好
const ctrlOps = genOpenings(CTRL_OPENINGS), abOps = genOpenings(AB_OPENINGS);
const jobs = [ ...buildJobs('对照 orig vs orig2（必须 6:6）', 'orig', 'orig2', ctrlOps) ];
for (const a of ARMS) jobs.push(...buildJobs(`${a} vs 出厂orig`, a, 'orig', abOps));
jobs.forEach((j, i) => { j.id = i; });

console.log(`LV5 出厂配置：共 ${jobs.length} 局，${WORKERS} 个并行进程`);
console.log(`对照 ${ctrlOps.length * 2} 局 + ${ARMS.length} 个变体 x ${abOps.length * 2} 局`);
console.log(`变体：${ARMS.join(', ')}\n`);

const results = {};
let done = 0;
const startMs = Date.now();
const workers = [];
let nextIdx = 0;
function assignNext(w) {
  if (nextIdx >= jobs.length) { w.send({ type: 'exit' }); return; }
  w.send(jobs[nextIdx++]);
}

for (let i = 0; i < WORKERS; i++) {
  const w = fork(path.join(__dirname, 'ab_worker.js'));
  w.on('message', (msg) => {
    if (msg.type !== 'result') return;
    done++;
    const r = results[msg.matchName] || (results[msg.matchName] = { a: 0, b: 0, d: 0 });
    if (msg.aWon === null) r.d++; else if (msg.aWon) r.a++; else r.b++;
    const el = ((Date.now() - startMs) / 1000).toFixed(0);
    console.log(`[${done}/${jobs.length}] ${msg.matchName}  (${msg.len}手 ${msg.reason})  ${el}s`);
    if (done === jobs.length) finish(); else assignNext(w);
  });
  workers.push(w);
}
workers.forEach(assignNext);

function finish() {
  console.log('\n=== 结果（左边是变体，右边是出厂 orig；左 > 右 才算有提升） ===');
  for (const [name, r] of Object.entries(results))
    console.log(`${name.padEnd(34)}  ${r.a} : ${r.b}   和 ${r.d}   (共 ${r.a + r.b + r.d} 局)`);
  workers.forEach(w => w.send({ type: 'exit' }));
  setTimeout(() => process.exit(0), 200);
}
