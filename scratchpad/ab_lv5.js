'use strict';
// LV5（地狱级）多臂 A/B：一次并行跑完「对照 + 多个候选变体 vs 出厂引擎」。
//
// 背景：实测 LV5 单手只用掉 56~74% 的 9 秒预算，maxDepth 写 18 实际只搜到 12~13 层。
// 三个候选各自针对一处浪费（详见 load.js 里 ROOTSORT / DEEPER / PARTIAL 的注释）：
//   rootsort    —— 迭代加深每层结束后按上层分数重排根着法（sortRoot 原本只在弱难度随机里用过）
//   deeppartial —— 收尾阈值 45%->65% + 采纳超时那层已搜完的部分结果
//   lv5all      —— 上面两者都开
//
// 为什么 deeper / partial 不单独测：3 个 LV5 局面的插桩显示，partial 单独跑跟出厂
// 逐字节相同（45% 阈值下搜索是干净收工的，没有半层结果可捡）；deeper 单独把预算用到
// 100% 但深度不涨（多搜的那层超时后整层被丢）。两者必须配对才有意义。
//
// 用法：
//   node ab_lv5.js                          # 对照 + 3 个变体，每臂 24 局
//   node ab_lv5.js --openings=6             # 每臂 12 局，快速摸底
//   node ab_lv5.js --arms=rootsort          # 只测指定变体
const os = require('os');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { build } = require('./load.js');

function argVal(name, def) {
  const p = process.argv.find(a => a.startsWith('--' + name + '='));
  return p ? p.split('=')[1] : def;
}
const WORKERS = Number(argVal('workers', os.cpus().length));
const CTRL_OPENINGS = Number(argVal('controlOpenings', 6));
const AB_OPENINGS = Number(argVal('openings', 12));   // -> 2 * openings 局/臂
const ARMS = argVal('arms', 'rootsort,deeppartial,lv5all').split(',').filter(Boolean);
// 分块跑：长任务会被后台清理杀掉（实测撑约 4.6 小时就没了），整块 200 局跑不完。
// 把预登记的开局集按**事先定死的下标**切片，每块单独落盘，最坏只丢一块。
// 块边界与数据无关，所以合并各块统计不构成优化停止点——跟「看到偏正就追加」有本质区别。
const OP_FROM = Number(argVal('openingFrom', 0));
const OP_TO = Number(argVal('openingTo', 0)) || null;   // 不给则用满 AB_OPENINGS
// 对照赛只在第一块跑一次；但**对照开局必须照常生成**，否则随机流错位、
// 后面几块的 A/B 开局就不再是预登记的那一批了。
const RUN_CONTROL = argVal('runControl', '1') !== '0';
// 每局结果实时落盘。上一轮 4.6 小时的数据全废，就是因为胜负只存在主控内存里，
// 日志只记了手数和耗时，进程被杀就什么都不剩。
const OUTFILE = argVal('out', '');

// 逐项照抄 index.html 的 LEVELS[5]
const LV5 = { timeMs: 9000, maxDepth: 18, vcfDepth: 20, vcfBudget: 1200000, vctDepth: 9,
  vctBudget: 1500000, vctDefDepth: 7, vctDefBudget: 150000, rand: 0, rootFilter: true, forbid: false };
// 逐项照抄 index.html 的 LEVELS[3]（困难）——硬规矩之二：配置必须与出厂值一致
const LV3 = { timeMs: 1500, maxDepth: 8, vcfDepth: 10, vcfBudget: 120000, vctDepth: 5,
  vctBudget: 80000, vctDefDepth: 0, vctDefBudget: 0, rand: 0, rootFilter: false, forbid: false };

// --level / --baseline 都有保持原行为的默认值：不带这两个参数时，本脚本与
// 加它们之前逐字节等价（LV5、变体对打 orig），上一轮的实验仍可原样复现。
const LEVEL = String(argVal('level', '5'));
const CFG = LEVEL === '3' ? LV3 : LV5;
// 基准臂。默认 orig（候选 vs 出厂）；敏感度诊断这类实验要让两个变体直接对打，
// 例如 --arms=ev3hi --baseline=ev3lo。
const BASELINE = argVal('baseline', 'orig');

build('orig'); build('orig2'); build(BASELINE);
for (const a of ARMS) build(a);

// 开局种子。重跑同一个假设时**必须换种子**，否则用的是已经看过结果的那批开局，
// 新数据与旧数据不独立，合并统计会假性收窄置信区间。
const SEED0 = Number(argVal('seed', 20260811));   // 原始种子，用于实验记录
let seed = SEED0;                                 // rnd() 会把它改写，别拿它当记录
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

function buildJobs(matchName, modA, modB, openings) {
  const jobs = [];
  for (const op of openings) for (let swap = 0; swap < 2; swap++)
    jobs.push({ type: 'game', matchName, modA, modB, cfgA: CFG, cfgB: CFG, opening: op, swap });
  return jobs;
}

// 所有臂用同一批开局，可比性更好
const ctrlOps = genOpenings(CTRL_OPENINGS), abOpsAll = genOpenings(AB_OPENINGS);
// 切片必须发生在**生成之后**：随机流已经把 100 个开局定死了，切片只是选其中一段。
const abOps = abOpsAll.slice(OP_FROM, OP_TO === null ? AB_OPENINGS : OP_TO);
const jobs = RUN_CONTROL
  ? [ ...buildJobs('对照 orig vs orig2（必须 6:6）', 'orig', 'orig2', ctrlOps) ] : [];
for (const a of ARMS) jobs.push(...buildJobs(
  `${a} vs ${BASELINE === 'orig' ? '出厂orig' : BASELINE}`, a, BASELINE, abOps));
jobs.forEach((j, i) => { j.id = i; });

console.log(`LV${LEVEL} 出厂配置：共 ${jobs.length} 局，${WORKERS} 个并行进程`);
console.log(`对照 ${RUN_CONTROL ? ctrlOps.length * 2 : 0} 局 + ${ARMS.length} 个变体 x ${abOps.length * 2} 局` +
  `（开局下标 [${OP_FROM},${OP_TO === null ? AB_OPENINGS : OP_TO}) / 共 ${AB_OPENINGS}，种子 ${SEED0}）`);
console.log(`变体：${ARMS.join(', ')}\n`);

const results = {};
let done = 0;
const startMs = Date.now();

// ---------- 断点续跑 ----------
// 后台长任务会被清理杀掉（第一块 62 局跑完，第二块 37/50 时被杀）。有了每局的 job.id
// （在参数固定时是确定的）就能只补跑缺的那些，把「丢两小时」变成「丢几分钟」。
// 校验 seed/openingFrom/openingTo 一致才认，否则拿别的块的结果续跑会静默算错。
const doneIds = new Set();
if (OUTFILE && fs.existsSync(OUTFILE)) {
  let bad = 0;
  for (const line of fs.readFileSync(OUTFILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (e) { continue; }
    if (o.id === undefined) { bad++; continue; }          // 旧格式没记 id，无法续跑
    if (o.seed !== SEED0 || o.from !== OP_FROM ||
        o.to !== (OP_TO === null ? AB_OPENINGS : OP_TO)) { bad++; continue; }
    // 档位/基准臂也进指纹：换了档还接着续跑，会把两个引擎的战绩静默拌在一起。
    // 旧文件没有这两个字段，按它们当时的固定行为（LV5 / orig）补默认值，不影响复现。
    if (String(o.lvl ?? '5') !== LEVEL || (o.base ?? 'orig') !== BASELINE) { bad++; continue; }
    if (doneIds.has(o.id)) continue;
    doneIds.add(o.id);
    const r = results[o.match] || (results[o.match] = { a: 0, b: 0, d: 0 });
    if (o.aWon === null) r.d++; else if (o.aWon) r.a++; else r.b++;
  }
  if (bad) {
    console.log(`⚠ ${OUTFILE} 里有 ${bad} 行无法用于续跑（旧格式或参数不符），已忽略。`);
    console.log('  若这是上一次运行留下的旧格式文件，请先删掉它再跑，避免结果混入。');
  }
  if (doneIds.size) {
    done = doneIds.size;
    console.log(`断点续跑：已完成 ${done} 局，本次只补跑缺的 ${jobs.length - done} 局\n`);
  }
}
const pending = jobs.filter(j => !doneIds.has(j.id));
const workers = [];
let nextIdx = 0;
function sendExit(w) {
  if (w.exitRequested || !w.connected) return;
  w.exitRequested = true;
  try { w.send({ type: 'exit' }); } catch (e) { /* 子进程已退出，忽略 */ }
}
function assignNext(w) {
  // 已经打发走的子进程不能再发消息：重复 send 会触发 'error' 事件把主进程带崩
  // （结果已打印完才崩，不影响数据，但看起来像跑挂了）
  if (nextIdx >= pending.length) { sendExit(w); return; }
  w.send(pending[nextIdx++]);
}

for (let i = 0; i < WORKERS; i++) {
  const w = fork(path.join(__dirname, 'ab_worker.js'));
  w.on('error', () => { /* IPC 关闭等，结果已收齐，不必中断 */ });
  w.on('message', (msg) => {
    if (msg.type !== 'result') return;
    done++;
    const r = results[msg.matchName] || (results[msg.matchName] = { a: 0, b: 0, d: 0 });
    if (msg.aWon === null) r.d++; else if (msg.aWon) r.a++; else r.b++;
    const el = ((Date.now() - startMs) / 1000).toFixed(0);
    // 胜负必须进日志。上一轮就是因为只记手数，进程被杀后 4.6 小时的数据全部无法判定。
    const who = msg.aWon === null ? '和' : (msg.aWon ? '胜=左' : '胜=右');
    console.log(`[${done}/${jobs.length}] ${msg.matchName}  ${who}  ` +
      `累计 ${r.a}:${r.b}和${r.d}  (${msg.len}手 ${msg.reason})  ${el}s`);
    // 再落一份机器可读的，避免解析中文日志
    if (OUTFILE) {
      try {
        fs.appendFileSync(OUTFILE, JSON.stringify({
          id: msg.id, match: msg.matchName, aWon: msg.aWon, len: msg.len, reason: msg.reason,
          seed: SEED0, from: OP_FROM, to: OP_TO === null ? AB_OPENINGS : OP_TO,
          lvl: LEVEL, base: BASELINE,
          a: r.a, b: r.b, d: r.d, elapsed: Number(el),
        }) + '\n');
      } catch (e) { /* 落盘失败不该把实验带崩 */ }
    }
    if (done >= jobs.length) finish(); else assignNext(w);
  });
  workers.push(w);
}
if (!pending.length) { console.log('本块已全部完成，直接汇总。'); finish(); }
else workers.forEach(assignNext);

function finish() {
  console.log('\n=== 结果（左边是变体，右边是出厂 orig；左 > 右 才算有提升） ===');
  for (const [name, r] of Object.entries(results))
    console.log(`${name.padEnd(34)}  ${r.a} : ${r.b}   和 ${r.d}   (共 ${r.a + r.b + r.d} 局)`);
  if (OUTFILE) {
    try {
      fs.writeFileSync(OUTFILE.replace(/\.jsonl?$/, '') + '.summary.json',
        JSON.stringify({ seed: SEED0, openingFrom: OP_FROM, openingTo: OP_TO, arms: ARMS,
          level: LEVEL, baseline: BASELINE, runControl: RUN_CONTROL, results }, null, 2));
    } catch (e) { /* 同上 */ }
  }
  workers.forEach(sendExit);
  setTimeout(() => process.exit(0), 200);
}
