'use strict';
// VCT 置换表 A/B 的并行版：多进程分摊对局。虚拟时钟让结果与真实耗时无关，
// 所以并行不影响正确性（见 PROGRESS「四、实验台」），只影响墙钟耗时。
// 用法：
//   node ab_vcttt_parallel.js --level=5                    # 默认：出厂配置控制6局对照 + 12开局(24局)A/B
//   node ab_vcttt_parallel.js --level=5 --workers=8 --openings=24 --controlOpenings=6
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { build } = require('./load.js');

function argNum(name, def) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  return p ? Number(p.split('=')[1]) : def;
}
const LEVEL = argNum('level', 5);
const WORKERS = argNum('workers', os.cpus().length);
const CTRL_OPENINGS = argNum('controlOpenings', 6);
const AB_OPENINGS = argNum('openings', 12); // -> 2 * openings 局

// 逐项照抄 index.html 的 LEVELS（forbid 固定 false，跟其余脚本一致）
const LEVELS = {
  3: { timeMs: 1500, maxDepth: 8, vcfDepth: 10, vcfBudget: 120000, vctDepth: 5, vctBudget: 80000,
       vctDefDepth: 0, vctDefBudget: 0, rand: 0, rootFilter: false, forbid: false },
  4: { timeMs: 4000, maxDepth: 12, vcfDepth: 14, vcfBudget: 400000, vctDepth: 7, vctBudget: 400000,
       vctDefDepth: 5, vctDefBudget: 60000, rand: 0, rootFilter: true, forbid: false },
  5: { timeMs: 9000, maxDepth: 18, vcfDepth: 20, vcfBudget: 1200000, vctDepth: 9, vctBudget: 1500000,
       vctDefDepth: 7, vctDefBudget: 150000, rand: 0, rootFilter: true, forbid: false },
};
const CFG = LEVELS[LEVEL];
if (!CFG) throw new Error('未知档位 --level=' + LEVEL);

build('orig'); build('orig2'); build('noTT');

let seed = 20260810 + LEVEL;
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
  for (const op of openings) for (let swap = 0; swap < 2; swap++) {
    jobs.push({ type: 'game', matchName, modA, modB, cfgA: CFG, cfgB: CFG, opening: op, swap });
  }
  return jobs;
}

// 注意：TT 已经合入 index.html，所以 orig 现在是「TT 开」，noTT 是反向 patch 出来的「TT 关」。
const jobs = [
  ...buildJobs(`LV${LEVEL} 对照（必须 6:6）`, 'orig', 'orig2', genOpenings(CTRL_OPENINGS)),
  ...buildJobs(`LV${LEVEL} TT开(orig) vs TT关(noTT)`, 'orig', 'noTT', genOpenings(AB_OPENINGS)),
];
jobs.forEach((j, i) => { j.id = i; });

console.log(`LV${LEVEL} 出厂配置：共 ${jobs.length} 局，${WORKERS} 个并行进程`);
console.log(`（对照 ${CTRL_OPENINGS * 2} 局 + A/B ${AB_OPENINGS * 2} 局）\n`);

const results = {};
let done = 0;
const startMs = Date.now();

const workers = [];
let nextIdx = 0;
function assignNext(w) {
  if (w.exitRequested || !w.connected) return;
  if (nextIdx >= jobs.length) { w.exitRequested = true; w.send({ type: 'exit' }); return; }
  w.send(jobs[nextIdx++]);
}

for (let i = 0; i < WORKERS; i++) {
  const w = fork(path.join(__dirname, 'ab_worker.js'));
  w.on('message', (msg) => {
    if (msg.type !== 'result') return;
    done++;
    const r = results[msg.matchName] || (results[msg.matchName] = { a: 0, b: 0, d: 0 });
    if (msg.aWon === null) r.d++; else if (msg.aWon) r.a++; else r.b++;
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0);
    console.log(`[${done}/${jobs.length}] ${msg.matchName}：一局完成（${msg.len} 手，${msg.reason}）  累计 ${elapsed}s`);
    if (done === jobs.length) finish();
    else assignNext(w);
  });
  workers.push(w);
}
workers.forEach(assignNext);

function finish() {
  console.log('\n=== 结果 ===');
  for (const [name, r] of Object.entries(results)) {
    console.log(`${name}:  ${r.a} : ${r.b}   和 ${r.d}   (共 ${r.a + r.b + r.d} 局)`);
  }
  workers.forEach(w => { if (!w.exitRequested && w.connected) { w.exitRequested = true; w.send({ type: 'exit' }); } });
  setTimeout(() => process.exit(0), 200);
}
