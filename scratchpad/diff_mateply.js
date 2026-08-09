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

// 逐项照抄 index.html 的 LEVELS[5]——A/B 的实际目标档位，浅档结果不能外推：
// LV5 搜得更深、杀棋分更多、转置更频繁，空操作与否必须在这一档单独验。
const LV5 = { timeMs:9000, maxDepth:18, vcfDepth:20, vcfBudget:1200000, vctDepth:9,
  vctBudget:1500000, vctDefDepth:7, vctDefBudget:150000, rand:0, rootFilter:true, forbid:false };

const arms = ['orig', 'mateply', 'mateplykeep'];
const mods = {};
for (const a of arms) { build(a); mods[a] = require('./eng_' + a + '.js'); }

const ALL = [['LV3', LV3], ['LV4', LV4], ['LV5', LV5]];
// 用法：node diff_mateply.js            -> LV3+LV4（快）
//       node diff_mateply.js 5          -> 只跑 LV5（慢，每个开局 3 局 x 9 秒预算）
//       node diff_mateply.js 3 4 5      -> 全跑
const want = process.argv.slice(2).filter(a => /^[345]$/.test(a));
const levels = want.length ? ALL.filter(([n]) => want.includes(n.slice(2))) : ALL.slice(0, 2);
const openings = [[[7,7],[7,8]], [[7,7],[8,8],[6,8]], [[7,7],[6,6],[8,6]]];

for (const [lname, cfg] of levels) {
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
