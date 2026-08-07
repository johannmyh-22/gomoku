'use strict';
// VCT 置换表 A/B：orig（无 TT） vs vcttt（vct() 加 TT），其余引擎参数逐项照抄 LEVELS 出厂值。
// 先测同引擎对照噪声底（必须 6:6），再跑 LV3 48 局、LV4 24 局。
const { build } = require('./load.js');
const { playGame } = require('./game.js');
build('orig'); build('orig2'); build('vcttt');
const ORIG = require('./eng_orig.js'), ORIG2 = require('./eng_orig2.js'), TT = require('./eng_vcttt.js');

// 逐项照抄 index.html 的 LEVELS[3]/LEVELS[4]
const LV3 = { timeMs: 1500, maxDepth: 8, vcfDepth: 10, vcfBudget: 120000, vctDepth: 5, vctBudget: 80000,
  vctDefDepth: 0, vctDefBudget: 0, rand: 0, rootFilter: false, forbid: false };
const LV4 = { timeMs: 4000, maxDepth: 12, vcfDepth: 14, vcfBudget: 400000, vctDepth: 7, vctBudget: 400000,
  vctDefDepth: 5, vctDefBudget: 60000, rand: 0, rootFilter: true, forbid: false };

let seed = 20260807;
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

function match(name, cfgA, modA, cfgB, modB, openings) {
  let a = 0, b = 0, d = 0;
  for (const op of openings) for (let swap = 0; swap < 2; swap++) {
    const black = swap ? { mod: modB, cfg: cfgB } : { mod: modA, cfg: cfgA };
    const white = swap ? { mod: modA, cfg: cfgA } : { mod: modB, cfg: cfgB };
    const r = playGame({ 1: black, 2: white }, op);
    const aWon = r.winner === 0 ? null : (r.winner === 1 ? !swap : !!swap);
    if (aWon === null) d++; else if (aWon) a++; else b++;
  }
  console.log(`${name}:  ${a} : ${b}   和 ${d}   (共 ${a + b + d} 局)`);
}

console.log('=== 0. 对照（必须 6:6） ===');
match('LV3 对照', LV3, ORIG, LV3, ORIG2, genOpenings(6));
match('LV4 对照', LV4, ORIG, LV4, ORIG2, genOpenings(6));

console.log('\n=== 1. LV3 出厂配置：TT关(orig) vs TT开(vcttt)，48 局 ===');
match('LV3 TT关 vs TT开', LV3, ORIG, LV3, TT, genOpenings(24));

console.log('\n=== 2. LV4 出厂配置：TT关(orig) vs TT开(vcttt)，24 局 ===');
match('LV4 TT关 vs TT开', LV4, ORIG, LV4, TT, genOpenings(12));
