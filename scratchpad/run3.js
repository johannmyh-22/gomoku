'use strict';
// 置换表跨步保留 vs 每步清空。虚拟时钟下引擎与真实耗时无关，可与别的实验并行跑。
const { build } = require('./load.js');
const { playGame } = require('./game.js');
build('ttkeep'); build('orig2');
const K = require('./eng_ttkeep.js'), O = require('./eng_orig2.js');

const BASE = { timeMs: 1500, maxDepth: 12, vcfDepth: 14, vcfBudget: 400000, vctDepth: 0,
  vctBudget: 400000, vctDefDepth: 0, vctDefBudget: 60000, rand: 0, rootFilter: true, forbid: false };

let seed = 20260806;
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

function match(name, mA, mB, openings) {
  let a = 0, b = 0, d = 0;
  for (const op of openings) for (let swap = 0; swap < 2; swap++) {
    const black = swap ? { mod: mB, cfg: BASE } : { mod: mA, cfg: BASE };
    const white = swap ? { mod: mA, cfg: BASE } : { mod: mB, cfg: BASE };
    const r = playGame({ 1: black, 2: white }, op);
    const aWon = r.winner === 0 ? null : (r.winner === 1 ? !swap : !!swap);
    if (aWon === null) d++; else if (aWon) a++; else b++;
  }
  const line = `${name}:  ${a} : ${b}   和 ${d}   (共 ${a + b + d} 局)`;
  console.log(line);
  return line;
}

const ops6 = genOpenings(6), ops24 = genOpenings(24);
console.log('=== 0. 对照（必须 6:6） ===');
match('相同引擎对照', O, O, ops6);
console.log('\n=== 1. TT 跨步保留 vs 每步清空（48 局） ===');
const r = match('ttkeep vs 每步清空', K, O, ops24);
console.log('\n======== 汇总 ========\n' + r);
