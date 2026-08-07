'use strict';
// 诊断：统计根过滤在真实对局里的行为
const { build } = require('./load.js');
const { playGame } = require('./game.js');
build('instr');
const E = require('./eng_instr.js');

const CFG = { timeMs: 1500, maxDepth: 12, vcfDepth: 14, vcfBudget: 400000, vctDepth: 7,
  vctBudget: 400000, vctDefDepth: 5, vctDefBudget: 60000, rand: 0, rootFilter: true, forbid: false };

const OPENINGS = [
  [[7, 7], [7, 8]],
  [[7, 7], [8, 8]],
  [[7, 7], [6, 8], [8, 8]],
  [[7, 7], [7, 6], [8, 7]],
];

const rec = [];
for (let g = 0; g < OPENINGS.length; g++) {
  E.stat.length = 0;
  const seen = [];
  const res = playGame({ 1: { mod: E, cfg: CFG }, 2: { mod: E, cfg: CFG } }, OPENINGS[g],
    (side, r, mod, ply) => {
      // think 里若跑到了根过滤，会 push 一条统计
      if (mod.stat.length > seen.length) {
        const s = mod.stat[mod.stat.length - 1];
        s.side = side; s.ply = ply; s.game = g;
        seen.push(s);
      }
    });
  console.log(`game ${g}: winner=${res.winner} (${res.reason}) plies=${res.moves.length}`);
  rec.push({ game: g, res: { winner: res.winner, reason: res.reason, n: res.moves.length }, stats: seen });
}

// 汇总
let total = 0, anyBad = 0, allCheckedBad = 0, forcedUnchecked = 0, timedOut = 0;
const details = [];
for (const r of rec) for (const s of r.stats) {
  total++;
  if (s.bad > 0) anyBad++;
  if (s.timedOut) timedOut++;
  if (s.checked > 0 && s.cleanChecked === 0) {
    allCheckedBad++;
    // 被迫从未检查的着法里挑
    if (s.pickIdx >= s.checked) forcedUnchecked++;
    details.push(`  G${r.game} ply${s.ply} side${s.side}: cnt=${s.cnt} checked=${s.checked} bad=${s.bad} pickIdx=${s.pickIdx} timedOut=${s.timedOut}`);
  } else if (s.bad > 0 && s.pickIdx >= s.checked) {
    details.push(`  G${r.game} ply${s.ply} side${s.side}: cnt=${s.cnt} checked=${s.checked} bad=${s.bad} pickIdx=${s.pickIdx} (选了未检查着法)`);
  }
}
console.log('\n==== 根过滤统计 ====');
console.log(`调用总次数 ${total}；其中排除过着法 ${anyBad}；45%时限提前 break ${timedOut}`);
console.log(`「已检查的全被判坏」次数 ${allCheckedBad}，其中被迫选未检查着法 ${forcedUnchecked}`);
if (details.length) { console.log('明细：'); details.forEach(d => console.log(d)); }
require('fs').writeFileSync(__dirname + '/diag_out.json', JSON.stringify(rec, null, 1));
