'use strict';
// 单进程、串行的对局器（避免抢 CPU 影响时间制搜索）

function win5(moves, side) {
  // side: 1=黑(偶数手) 2=白
  const g = new Int8Array(15 * 15);
  moves.forEach(([x, y], i) => (g[y * 15 + x] = i % 2 === 0 ? 1 : 2));
  const last = moves[moves.length - 1];
  if (!last) return false;
  const c = g[last[1] * 15 + last[0]];
  if (c !== side) return false;
  const D = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of D) {
    let n = 1;
    for (let s = 1; s <= 4; s++) { const x = last[0] + dx * s, y = last[1] + dy * s; if (x < 0 || y < 0 || x > 14 || y > 14 || g[y * 15 + x] !== c) break; n++; }
    for (let s = 1; s <= 4; s++) { const x = last[0] - dx * s, y = last[1] - dy * s; if (x < 0 || y < 0 || x > 14 || y > 14 || g[y * 15 + x] !== c) break; n++; }
    if (n >= 5) return true;
  }
  return false;
}

// engines: {1: {mod, cfg}, 2: {mod, cfg}}, opening: 预置着法数组
function playGame(engines, opening, onMove) {
  if (engines[1].mod.clearHistory) engines[1].mod.clearHistory();
  if (engines[2].mod.clearHistory) engines[2].mod.clearHistory();
  const moves = opening.slice();
  const occupied = new Set(moves.map(([x, y]) => y * 15 + x));
  for (let ply = moves.length; ply < 225; ply++) {
    const side = ply % 2 === 0 ? 1 : 2;
    const E = engines[side];
    E.mod.setBoard(moves, false);
    const r = E.mod.think(side, E.cfg);
    const c = E.mod.xy(r.mv);
    if (onMove) onMove(side, r, E.mod, ply);
    if (c.x < 0 || c.y < 0 || c.x > 14 || c.y > 14 || occupied.has(c.y * 15 + c.x))
      return { winner: 3 - side, reason: 'illegal', moves };
    moves.push([c.x, c.y]);
    occupied.add(c.y * 15 + c.x);
    if (win5(moves, side)) return { winner: side, reason: 'five', moves };
  }
  return { winner: 0, reason: 'draw', moves };
}

module.exports = { playGame, win5 };
