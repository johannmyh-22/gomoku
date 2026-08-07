'use strict';
// 标定：一局要跑多久 + VCF/VCT 占了多少节点（用来估算实验时长和 TT 的收益上限）
// 2026-08-06 在 M2 上的结果：LV3 单局 9.4s / LV4 单局 87.6s。
// 注意：虚拟时钟让引擎行为与真实耗时无关，所以换机器只影响这里的秒数，不影响对局结果。
const fs = require('fs');
const path = require('path');
const { build } = require('./load.js');
const { playGame } = require('./game.js');

const f = build('orig');
let src = fs.readFileSync(f, 'utf8');
// 累计计数器（vcfNodes/vctNodes 每次调用都会清零，拿不到总量）
src = src.replace("var ENG = { stat: [] };", "var ENG = { stat: [] };\nvar VCFTOT=0, VCTTOT=0;");
src = src.replace("function vcf(side, depth){\n  TICKS++;", "function vcf(side, depth){\n  TICKS++; VCFTOT++;");
src = src.replace("function vct(side, depth, lvl){\n  TICKS++;", "function vct(side, depth, lvl){\n  TICKS++; VCTTOT++;");
src = src.replace("module.exports = ENG;",
  "ENG.probe=function(){return {vcf:VCFTOT,vct:VCTTOT,main:nodeCount,ticks:TICKS};};\n" +
  "ENG.probeReset=function(){VCFTOT=0;VCTTOT=0;};\nmodule.exports = ENG;");
const out = path.join(__dirname, 'eng_probe.js');
fs.writeFileSync(out, src);
const E = require(out);

const LV3 = { timeMs:1500, maxDepth:8, vcfDepth:10, vcfBudget:120000, vctDepth:5,
  vctBudget:80000, vctDefDepth:0, vctDefBudget:0, rand:0, rootFilter:false, forbid:false };
const LV4 = { timeMs:4000, maxDepth:12, vcfDepth:14, vcfBudget:400000, vctDepth:7,
  vctBudget:400000, vctDefDepth:5, vctDefBudget:60000, rand:0, rootFilter:true, forbid:false };

function run(name, cfg) {
  E.probeReset();
  let plies = 0, vcfN = 0, vctN = 0, mainN = 0;
  const t0 = Date.now();
  const r = playGame({ 1:{mod:E,cfg}, 2:{mod:E,cfg} }, [[7,7],[8,8],[6,8]], () => {
    const p = E.probe();
    vcfN += p.vcf; vctN += p.vct; mainN += p.main; E.probeReset();
    plies++;
  });
  const dt = (Date.now() - t0) / 1000;
  const tot = vcfN + vctN + mainN;
  console.log(`${name}: ${dt.toFixed(1)}s  ${plies}手  ${(dt/plies).toFixed(2)}s/手  胜方=${r.winner}`);
  console.log(`   节点: 主搜索 ${(mainN/1e6).toFixed(1)}M (${(100*mainN/tot).toFixed(0)}%)  ` +
              `VCF ${(vcfN/1e6).toFixed(1)}M (${(100*vcfN/tot).toFixed(0)}%)  ` +
              `VCT ${(vctN/1e6).toFixed(1)}M (${(100*vctN/tot).toFixed(0)}%)`);
  return dt;
}

const t3 = run('LV3(1.5s) 单局', LV3);
const t4 = run('LV4(4s)  单局', LV4);
console.log(`\n推算：LV3 48局 ≈ ${(t3*48/60).toFixed(0)} 分钟；LV4 24局 ≈ ${(t4*24/60).toFixed(0)} 分钟（单进程串行）`);
