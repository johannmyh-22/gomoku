'use strict';
// 4 秒预算下 VCT 的复核加大样本：run2 的 12 局打成 6:6，但 n=12 的误差棒极大，
// 与 1.5s 下的 18:30 并不矛盾。这里用 12 开局双色共 24 局重测。
const { build } = require('./load.js');
const { playGame } = require('./game.js');
build('orig'); build('orig2');
const A = require('./eng_orig.js'), B = require('./eng_orig2.js');

const BASE = { timeMs: 4000, maxDepth: 12, vcfDepth: 14, vcfBudget: 400000, vctDepth: 0,
  vctBudget: 400000, vctDefDepth: 0, vctDefBudget: 60000, rand: 0, rootFilter: true, forbid: false };
const cfgOf = o => Object.assign({}, BASE, o);

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

let a = 0, b = 0, d = 0, i = 0;
const cfgOff = cfgOf({}), cfgOn = cfgOf({ vctDepth: 7, vctDefDepth: 5 });
for (const op of genOpenings(12)) for (let swap = 0; swap < 2; swap++) {
  const black = swap ? { mod: B, cfg: cfgOn } : { mod: A, cfg: cfgOff };
  const white = swap ? { mod: A, cfg: cfgOff } : { mod: B, cfg: cfgOn };
  const r = playGame({ 1: black, 2: white }, op);
  const aWon = r.winner === 0 ? null : (r.winner === 1 ? !swap : !!swap);
  if (aWon === null) d++; else if (aWon) a++; else b++;
  console.log(`  [${++i}/24] VCT关 ${a} : ${b} VCT开  (和 ${d})`);
}
console.log(`\n======== VCT关 vs VCT开 @4s：  ${a} : ${b}   和 ${d}   (共 ${a + b + d} 局) ========`);
