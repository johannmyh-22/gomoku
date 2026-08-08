'use strict';
// 并行 A/B 的子进程：常驻，接收一局的任务描述就跑一局，把结果发回父进程。
const { playGame } = require('./game.js');
const MODS = {};
function getMod(name) {
  if (!MODS[name]) MODS[name] = require('./eng_' + name + '.js');
  return MODS[name];
}

process.on('message', (job) => {
  if (job.type === 'exit') { process.exit(0); return; }
  if (job.type !== 'game') return;
  const A = getMod(job.modA), B = getMod(job.modB);
  const black = job.swap ? { mod: B, cfg: job.cfgB } : { mod: A, cfg: job.cfgA };
  const white = job.swap ? { mod: A, cfg: job.cfgA } : { mod: B, cfg: job.cfgB };
  const r = playGame({ 1: black, 2: white }, job.opening);
  const aWon = r.winner === 0 ? null : (r.winner === 1 ? !job.swap : !!job.swap);
  process.send({ type: 'result', id: job.id, matchName: job.matchName, aWon, len: r.moves.length, reason: r.reason });
});
