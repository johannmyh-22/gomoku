'use strict';
// 用法: node ab.js <variantA> <variantB> [timeMs]
// 串行跑，双色互换，避免 CPU 抢占
const { build } = require('./load.js');
const { playGame } = require('./game.js');

const vA = process.argv[2] || 'fix';
const vB = process.argv[3] || 'orig';
const timeMs = +(process.argv[4] || 1500);
build(vA); build(vB);
const A = require('./eng_' + vA + '.js');
const B = require('./eng_' + vB + '.js');

const CFG = { timeMs, maxDepth: 12, vcfDepth: 14, vcfBudget: 400000, vctDepth: 7,
  vctBudget: 400000, vctDefDepth: 5, vctDefBudget: 60000, rand: 0, rootFilter: true, forbid: false };

const OPENINGS = [
  [[7, 7], [7, 8]],
  [[7, 7], [8, 8]],
  [[7, 7], [6, 8], [8, 8]],
  [[7, 7], [7, 6], [8, 7]],
  [[7, 7], [8, 7], [7, 8]],
  [[7, 7], [6, 6], [8, 6]],
];

let aWin = 0, bWin = 0, draw = 0;
const rows = [];
for (let o = 0; o < OPENINGS.length; o++) {
  for (let swap = 0; swap < 2; swap++) {
    const black = swap ? B : A, white = swap ? A : B;
    const t0 = Date.now();
    const res = playGame({ 1: { mod: black, cfg: CFG }, 2: { mod: white, cfg: CFG } }, OPENINGS[o]);
    const winnerIsA = res.winner === 0 ? null : (res.winner === 1 ? !swap : !!swap);
    if (winnerIsA === null) draw++; else if (winnerIsA) aWin++; else bWin++;
    const label = `op${o} ${swap ? vB + '执黑' : vA + '执黑'}: ` +
      (res.winner === 0 ? '和' : `${res.winner === 1 ? '黑' : '白'}胜 -> ${winnerIsA ? vA : vB}`) +
      ` (${res.reason}, ${res.moves.length}手, ${((Date.now() - t0) / 1000) | 0}s)`;
    rows.push(label);
    console.log(label);
    console.log(`   running: ${vA} ${aWin} : ${bWin} ${vB}  (draw ${draw})`);
  }
}
console.log(`\n==== 结果 ====\n${vA} ${aWin} : ${bWin} ${vB}   和 ${draw}   (timeMs=${timeMs})`);
