'use strict';
// 用 3 档「真实出厂配置」测 VCT：之前的 18:30 是拿 level-4 设定跑 1.5s 测的，
// 而 3 档实际是 vctDepth:5 / vctDefDepth:0 / rootFilter:false —— 配置不同，必须单独验。
const { build } = require('./load.js');
const { playGame } = require('./game.js');
build('orig'); build('orig2');
const A = require('./eng_orig.js'), B = require('./eng_orig2.js');

// 3 档出厂配置
const LV3 = { timeMs: 1500, maxDepth: 8, vcfDepth: 10, vcfBudget: 120000,
  vctBudget: 80000, vctDefDepth: 0, vctDefBudget: 0, rand: 0, rootFilter: false, forbid: false };
const OFF = Object.assign({}, LV3, { vctDepth: 0 });
const ON  = Object.assign({}, LV3, { vctDepth: 5 });

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

function match(name, cfgA, cfgB, openings) {
  let a = 0, b = 0, d = 0;
  for (const op of openings) for (let swap = 0; swap < 2; swap++) {
    const black = swap ? { mod: B, cfg: cfgB } : { mod: A, cfg: cfgA };
    const white = swap ? { mod: A, cfg: cfgA } : { mod: B, cfg: cfgB };
    const r = playGame({ 1: black, 2: white }, op);
    const aWon = r.winner === 0 ? null : (r.winner === 1 ? !swap : !!swap);
    if (aWon === null) d++; else if (aWon) a++; else b++;
  }
  console.log(`${name}:  ${a} : ${b}   和 ${d}   (共 ${a + b + d} 局)`);
}

const ops6 = genOpenings(6), ops24 = genOpenings(24);
console.log('=== 0. 对照（必须 6:6） ===');
match('相同引擎对照', OFF, OFF, ops6);
console.log('\n=== 1. 3 档出厂配置：VCT关 vs VCT开（48 局） ===');
match('3档 VCT关 vs VCT开', OFF, ON, ops24);
