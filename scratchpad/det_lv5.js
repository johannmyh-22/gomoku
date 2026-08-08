'use strict';
// LV5 候选变体的确定性自检（跑 A/B 之前的硬规矩）。
// 这几个改动都不引入随机源，但要确认没有意外的路径依赖——用 LV3/LV4 跑得快些，
// 改动本身与档位无关。
const { build } = require('./load.js');
const { playGame } = require('./game.js');

const LV3 = { timeMs: 1500, maxDepth: 8, vcfDepth: 10, vcfBudget: 120000, vctDepth: 5, vctBudget: 80000,
  vctDefDepth: 0, vctDefBudget: 0, rand: 0, rootFilter: false, forbid: false };
const LV4 = { timeMs: 4000, maxDepth: 12, vcfDepth: 14, vcfBudget: 400000, vctDepth: 7, vctBudget: 400000,
  vctDefDepth: 5, vctDefBudget: 60000, rand: 0, rootFilter: true, forbid: false };

const VARIANTS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const arms = VARIANTS.length ? VARIANTS : ['rootsort', 'deeppartial', 'lv5all'];
const openings = [[[7, 7], [7, 8]], [[7, 7], [8, 8], [6, 8]]];

let allOk = true;
for (const v of arms) {
  build(v);
  const E = require('./eng_' + v + '.js');
  for (const [name, cfg] of [['LV3', LV3], ['LV4', LV4]]) {
    for (const op of openings) {
      const r1 = playGame({ 1: { mod: E, cfg }, 2: { mod: E, cfg } }, op);
      const r2 = playGame({ 1: { mod: E, cfg }, 2: { mod: E, cfg } }, op);
      const same = JSON.stringify(r1.moves) === JSON.stringify(r2.moves);
      if (!same) allOk = false;
      console.log(`${v} ${name} ${JSON.stringify(op)}: len ${r1.moves.length},${r2.moves.length} identical=${same}`);
    }
  }
}
console.log(allOk ? '\nALL DETERMINISTIC' : '\nFAILED — 非确定性，A/B 结果不可信');
