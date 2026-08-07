'use strict';
const { build } = require('./load.js');
const { playGame } = require('./game.js');
build('orig'); build('orig2'); build('fix');
const A = require('./eng_orig.js'), B = require('./eng_orig2.js'), F = require('./eng_fix.js');

const BASE = { timeMs: 1500, maxDepth: 12, vcfDepth: 14, vcfBudget: 400000, vctDepth: 7,
  vctBudget: 400000, vctDefDepth: 5, vctDefBudget: 60000, rand: 0, rootFilter: true, forbid: false };
const cfgOf = o => Object.assign({}, BASE, o);

// 固定种子的随机开局：中心附近 3 子，保证不重复
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

function match(name, engA, cfgA, engB, cfgB, openings) {
  let a = 0, b = 0, d = 0;
  for (const op of openings) for (let swap = 0; swap < 2; swap++) {
    const black = swap ? { mod: engB, cfg: cfgB } : { mod: engA, cfg: cfgA };
    const white = swap ? { mod: engA, cfg: cfgA } : { mod: engB, cfg: cfgB };
    const r = playGame({ 1: black, 2: white }, op);
    const aWon = r.winner === 0 ? null : (r.winner === 1 ? !swap : !!swap);
    if (aWon === null) d++; else if (aWon) a++; else b++;
  }
  const line = `${name}:  ${a} : ${b}   和 ${d}   (共 ${a + b + d} 局)`;
  console.log(line);
  return line;
}

const res = [];
const ops12 = genOpenings(6), ops48 = genOpenings(24);

console.log('=== 1. 对照：完全相同的引擎（确定性下应为 6:6 或全和） ===');
res.push(match('相同引擎对照', A, cfgOf({}), B, cfgOf({}), ops12));

console.log('\n=== 2. 根过滤兜底缺陷：fix vs orig ===');
res.push(match('fix vs orig', F, cfgOf({}), A, cfgOf({}), ops12));

console.log('\n=== 3. VCT 全开 vs 全关（48 局） ===');
res.push(match('VCT全开 vs 全关', A, cfgOf({}), B, cfgOf({ vctDepth: 0, vctDefDepth: 0 }), ops48));

console.log('\n=== 4. 只进攻 VCT vs 全关 ===');
res.push(match('只进攻VCT vs 全关', A, cfgOf({ vctDefDepth: 0 }), B, cfgOf({ vctDepth: 0, vctDefDepth: 0 }), ops48));

console.log('\n=== 5. 只防守过滤 VCT vs 全关 ===');
res.push(match('只防守VCT vs 全关', A, cfgOf({ vctDepth: 0 }), B, cfgOf({ vctDepth: 0, vctDefDepth: 0 }), ops48));

console.log('\n\n======== 汇总 ========');
res.forEach(r => console.log(r));
