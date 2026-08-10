'use strict';
// 合并预登记实验各分块的结果并按**预登记锁定的规则**判定。
// 规则出处：scratchpad/PREREG_mateplykeep.md，本脚本不重新发明判定标准。
//
//   z >= +2.0  -> 证实，合入
//   |z| < 2.0  -> 未能证明，不合入，且**不得追加局数**
//   z <= -2.0  -> 反向证实，记为有害
//
// 用法：node pool_prereg.js runs/prereg_c1.summary.json runs/prereg_c2.summary.json ...
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node pool_prereg.js <各块的 .summary.json>'); process.exit(1); }

const pooled = {};
let ctrl = null;
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [name, r] of Object.entries(j.results)) {
    if (name.startsWith('对照')) {
      ctrl = ctrl || { a: 0, b: 0, d: 0 };
      ctrl.a += r.a; ctrl.b += r.b; ctrl.d += r.d;
      continue;
    }
    const p = pooled[name] || (pooled[name] = { a: 0, b: 0, d: 0 });
    p.a += r.a; p.b += r.b; p.d += r.d;
  }
  console.log(`读入 ${f}  开局[${j.openingFrom},${j.openingTo}) seed=${j.seed}`);
}

const erf = x => {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=.3275911;
  const t = 1/(1+p*x);
  return s*(1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x));
};
const elo = r => -400*Math.log10(1/r-1);

console.log('\n=== 对照（预登记要求 6:6，否则本轮全部作废） ===');
if (!ctrl) console.log('  未包含对照数据（对照只在第一块跑）');
else {
  const ok = ctrl.a === ctrl.b;
  console.log(`  orig vs orig2: ${ctrl.a} : ${ctrl.b} 和 ${ctrl.d}   ${ok ? '✅ 干净' : '❌ 不相等 —— 按预登记，本轮数据全部作废'}`);
}

console.log('\n=== 主分析（只用本轮新数据，不与第一轮 48 局合并） ===');
for (const [name, r] of Object.entries(pooled)) {
  const n = r.a + r.b;
  const sd = Math.sqrt(n)/2, z = (r.a - n/2)/sd;
  const pTwo = 1 - erf(Math.abs(z)/Math.SQRT2);
  const rate = r.a/n, se = Math.sqrt(rate*(1-rate)/n);
  const lo = rate - 1.96*se, hi = rate + 1.96*se;
  const verdict = z >= 2 ? '证实 H1 -> 合入 index.html'
    : (z <= -2 ? '反向证实 -> 不合入，记为有害'
    : '未能证明 -> 不合入，记入「试过但无收益」，且不得追加局数');
  console.log(`\n${name}`);
  console.log(`  比分      : ${r.a} : ${r.b}   和 ${r.d}   (分胜负 ${n} 局)`);
  console.log(`  z         : ${z.toFixed(2)}σ    双侧 p = ${pTwo.toFixed(3)}`);
  console.log(`  胜率      : ${(rate*100).toFixed(1)}%  ≈ ${elo(rate).toFixed(0)} Elo`);
  console.log(`  95% CI    : ${(lo*100).toFixed(1)}% ~ ${(hi*100).toFixed(1)}%  ≈ ${elo(lo).toFixed(0)} ~ ${elo(hi).toFixed(0)} Elo`);
  console.log(`  预登记判定: ${verdict}`);
  // 样本量要按**总局数**算，不是分胜负局数——和棋也是跑完的局。
  // （初版拿 n=a+b 跟 200 比，3 局和棋就误报「样本不足」。）
  const total = r.a + r.b + r.d;
  if (total < 200) console.log(`  ⚠ 样本量 ${total} < 预登记的 200 局，功效不足；` +
    `按预登记，中断点不得当作有利的停止点来解释`);
  else console.log(`  样本量    : ${total} 局，达到预登记的 200 局（其中和棋 ${r.d}）`);
}
