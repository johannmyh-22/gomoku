'use strict';
// 前置检查：变体是否真的改变走法。
// PROGRESS「一之四」的教训——`partial` 变体跟出厂逐字节相同（空操作），
// 测它等于测了个寂寞。跑 A/B 之前必须先确认变体确实会走出不同的棋。
const { build } = require('./load.js');
const { playGame } = require('./game.js');

const LV3 = { timeMs:1500, maxDepth:8, vcfDepth:10, vcfBudget:120000, vctDepth:5,
  vctBudget:80000, vctDefDepth:0, vctDefBudget:0, rand:0, rootFilter:false, forbid:false };
const LV4 = { timeMs:4000, maxDepth:12, vcfDepth:14, vcfBudget:400000, vctDepth:7,
  vctBudget:400000, vctDefDepth:5, vctDefBudget:60000, rand:0, rootFilter:true, forbid:false };

const arms = ['orig', 'mateply', 'mateplykeep'];
const mods = {};
for (const a of arms) { build(a); mods[a] = require('./eng_' + a + '.js'); }

const openings = [[[7,7],[7,8]], [[7,7],[8,8],[6,8]], [[7,7],[6,6],[8,6]]];

for (const [lname, cfg] of [['LV3', LV3], ['LV4', LV4]]) {
  for (const op of openings) {
    const seq = {};
    for (const a of arms) {
      const r = playGame({ 1:{mod:mods[a],cfg}, 2:{mod:mods[a],cfg} }, op);
      seq[a] = JSON.stringify(r.moves);
    }
    const firstDiff = (x, y) => {
      const A = JSON.parse(x), B = JSON.parse(y);
      for (let i = 0; i < Math.max(A.length, B.length); i++)
        if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) return i + 1;
      return -1;
    };
    console.log(`${lname} ${JSON.stringify(op)}`);
    for (const a of arms.slice(1)) {
      const same = seq[a] === seq.orig;
      console.log(`   ${a.padEnd(12)} vs orig: ${same ? '★逐字节相同（空操作！）' :
        '不同，首次分歧在第 ' + firstDiff(seq.orig, seq[a]) + ' 手'}`);
    }
  }
}
