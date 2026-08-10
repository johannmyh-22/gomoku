'use strict';
// 非空操作验证 + 成本实测。
//
// PROGRESS「接手时最容易犯的错」第 4 条：不验「变体是否空操作」就跑 A/B。
// 上一轮栽过两次——`partial` 变体与出厂逐字节相同、LV3 的预算翻倍诊断是纯空操作
// （212 局全废）。所以任何变体进 A/B 之前必须先在**目标档位**上确认它真的改走法。
//
// 本脚本比 diff_mateply.js 多做两件事：
//   1. 除了「变体 vs 出厂」，还比「ev3hi vs ev3lo」——因为 A/B 实际是这两臂对打，
//      它俩必须互不相同才有得测（理论上 hi/lo 都异于 orig 就够，但直接验最省心）。
//   2. 记录每局耗时，用于给预登记文件定局数（4 核容器，成本必须先量再承诺）。
//
// 用法：node diff_ev3.js 3          只跑 LV3
//       node diff_ev3.js 3 5        LV3 + LV5
//       node diff_ev3.js            默认 LV3
const { build } = require('./load.js');
const { playGame } = require('./game.js');

// 逐项照抄 index.html 的 LEVELS——硬规矩之二：被测配置必须与出厂值一致
const LV3 = { timeMs:1500, maxDepth:8, vcfDepth:10, vcfBudget:120000, vctDepth:5,
  vctBudget:80000, vctDefDepth:0, vctDefBudget:0, rand:0, rootFilter:false, forbid:false };
const LV5 = { timeMs:9000, maxDepth:18, vcfDepth:20, vcfBudget:1200000, vctDepth:9,
  vctBudget:1500000, vctDefDepth:7, vctDefBudget:150000, rand:0, rootFilter:true, forbid:false };

const arms = ['orig', 'ev3hi', 'ev3lo'];
const mods = {};
for (const a of arms) { build(a); mods[a] = require('./eng_' + a + '.js'); }

const ALL = { 3: ['LV3', LV3], 5: ['LV5', LV5] };
const want = process.argv.slice(2).filter(a => /^[35]$/.test(a));
const levels = (want.length ? want : ['3']).map(k => ALL[k]);

const openings = [[[7,7],[7,8]], [[7,7],[8,8],[6,8]], [[7,7],[6,6],[8,6]]];

const firstDiff = (A, B) => {
  for (let i = 0; i < Math.max(A.length, B.length); i++)
    if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) return i + 1;
  return -1;
};

for (const [lname, cfg] of levels) {
  const times = [];
  let allDiff = true;
  for (const op of openings) {
    const seq = {};
    for (const a of arms) {
      const t0 = Date.now();
      const r = playGame({ 1:{mod:mods[a],cfg}, 2:{mod:mods[a],cfg} }, op);
      times.push({ arm: a, ms: Date.now() - t0, plies: r.moves.length });
      seq[a] = r.moves;
    }
    console.log(`${lname} 开局 ${JSON.stringify(op)}`);
    for (const [x, y] of [['ev3hi','orig'], ['ev3lo','orig'], ['ev3hi','ev3lo']]) {
      const d = firstDiff(seq[x], seq[y]);
      if (d < 0 && x !== 'orig') allDiff = false;
      console.log(`   ${(x + ' vs ' + y).padEnd(16)}: ` +
        (d < 0 ? '★逐字节相同（空操作！）' : `不同，首次分歧在第 ${d} 手`));
    }
  }
  const tot = times.reduce((s, t) => s + t.ms, 0);
  const avg = tot / times.length;
  const avgPly = times.reduce((s, t) => s + t.plies, 0) / times.length;
  console.log(`\n${lname} 成本：${times.length} 局共 ${(tot/1000).toFixed(1)}s，` +
    `平均 ${(avg/1000).toFixed(1)}s/局（平均 ${avgPly.toFixed(0)} 手）`);
  console.log(`${lname} 判定：${allDiff ? '✅ 非空操作，可以进 A/B' : '❌ 存在空操作臂，不得进 A/B'}\n`);
}
