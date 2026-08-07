'use strict';
// 第二轮：1) 根过滤（现在只剩 VCF 检查）值不值得留  2) VCT 的结论在 4 秒预算下是否仍成立
const { build } = require('./load.js');
const { playGame } = require('./game.js');
build('orig'); build('orig2');
const A = require('./eng_orig.js'), B = require('./eng_orig2.js');

// 基线 = 当前 index.html 出厂配置（VCT 已关）
const BASE = { timeMs: 1500, maxDepth: 12, vcfDepth: 14, vcfBudget: 400000, vctDepth: 0,
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

function match(name, cfgA, cfgB, openings) {
  let a = 0, b = 0, d = 0;
  for (const op of openings) for (let swap = 0; swap < 2; swap++) {
    const black = swap ? { mod: B, cfg: cfgB } : { mod: A, cfg: cfgA };
    const white = swap ? { mod: A, cfg: cfgA } : { mod: B, cfg: cfgB };
    const r = playGame({ 1: black, 2: white }, op);
    const aWon = r.winner === 0 ? null : (r.winner === 1 ? !swap : !!swap);
    if (aWon === null) d++; else if (aWon) a++; else b++;
  }
  const line = `${name}:  ${a} : ${b}   和 ${d}   (共 ${a + b + d} 局)`;
  console.log(line);
  return line;
}

const res = [];
const ops6 = genOpenings(6), ops24 = genOpenings(24);

console.log('=== 0. 对照（必须 6:6，否则后面结果不可信） ===');
res.push(match('相同引擎对照', cfgOf({}), cfgOf({}), ops6));

console.log('\n=== 1. 关掉根过滤 vs 保留（48 局，1.5s） ===');
res.push(match('无根过滤 vs 有根过滤', cfgOf({ rootFilter: false }), cfgOf({}), ops24));

console.log('\n=== 2. VCT 关 vs 开，改用 4 秒预算复核（12 局） ===');
res.push(match('VCT关 vs VCT开 @4s',
  cfgOf({ timeMs: 4000 }),
  cfgOf({ timeMs: 4000, vctDepth: 7, vctDefDepth: 5 }), ops6));

console.log('\n\n======== 汇总 ========');
res.forEach(r => console.log(r));
