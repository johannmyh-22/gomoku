'use strict';
// 测「置换率」——PROGRESS 曾断言「置换率极高」但从没测过。这个脚本是那条断言的证据来源。
// 2026-08-06 结果（LV4 单局 45 手）：VCT 置换率 86.0%，VCF 仅占算杀节点 0.3%。
// 结论：TT 只该加在 VCT 上；给 VCF 加是白写。
const fs = require('fs');
const path = require('path');
const { build } = require('./load.js');
const { playGame } = require('./game.js');

const f = build('orig');
let src = fs.readFileSync(f, 'utf8');
src = src.replace("var ENG = { stat: [] };",
  "var ENG = { stat: [] };\nvar VCFTOT=0, VCTTOT=0;\nvar SEEN=new Map(), SEEN2=new Map(), REC=0;");
// 在 vcf/vct 入口记录 (hash2, side, depth)。exact=带深度；loose=不带深度（证明可向更深复用）
src = src.replace("function vcf(side, depth){\n  TICKS++;",
  "function vcf(side, depth){\n  TICKS++; VCFTOT++;\n  if(REC){var _k=hash2+':'+side+':F'+depth;SEEN.set(_k,(SEEN.get(_k)||0)+1);var _k2=hash2+':'+side+':F';SEEN2.set(_k2,(SEEN2.get(_k2)||0)+1);}");
src = src.replace("function vct(side, depth, lvl){\n  TICKS++;",
  "function vct(side, depth, lvl){\n  TICKS++; VCTTOT++;\n  if(REC){var _k=hash2+':'+side+':T'+depth;SEEN.set(_k,(SEEN.get(_k)||0)+1);var _k2=hash2+':'+side+':T';SEEN2.set(_k2,(SEEN2.get(_k2)||0)+1);}");
src = src.replace("module.exports = ENG;",
  `ENG.probe=function(){
     var tot=0; SEEN.forEach(function(v){tot+=v;});
     var tot2=0; SEEN2.forEach(function(v){tot2+=v;});
     return {vcf:VCFTOT, vct:VCTTOT, main:nodeCount,
             total:tot, uniqExact:SEEN.size, uniqLoose:SEEN2.size};
   };
   ENG.probeReset=function(on){VCFTOT=0;VCTTOT=0;SEEN=new Map();SEEN2=new Map();REC=on?1:0;};
   module.exports = ENG;`);
const out = path.join(__dirname, 'eng_probe2.js');
fs.writeFileSync(out, src);
const E = require(out);

const LV4 = { timeMs:4000, maxDepth:12, vcfDepth:14, vcfBudget:400000, vctDepth:7,
  vctBudget:400000, vctDefDepth:5, vctDefBudget:60000, rand:0, rootFilter:true, forbid:false };

let plies = 0, agg = {tot:0, ue:0, ul:0, vcf:0, vct:0, main:0};
const rows = [];
E.probeReset(true);
playGame({1:{mod:E,cfg:LV4}, 2:{mod:E,cfg:LV4}}, [[7,7],[8,8],[6,8]], () => {
  const p = E.probe();
  if (p.total > 2000) rows.push(p);
  agg.tot += p.total; agg.ue += p.uniqExact; agg.ul += p.uniqLoose;
  agg.vcf += p.vcf; agg.vct += p.vct; agg.main += p.main;
  plies++;
  E.probeReset(plies < 40);   // 只录前 40 手，后面关掉省内存
});

console.log(`== LV4 单局，${plies} 手 ==`);
console.log(`精确节点数: 主搜索 ${agg.main}   VCF ${agg.vcf}   VCT ${agg.vct}`);
console.log(`  VCF 占算杀总节点 ${(100*agg.vcf/(agg.vcf+agg.vct)).toFixed(1)}%\n`);
console.log(`算杀节点合计 ${agg.tot}  唯一局面(含深度) ${agg.ue}  唯一局面(忽略深度) ${agg.ul}`);
console.log(`>> 置换率(含深度) ${(100*(1-agg.ue/agg.tot)).toFixed(1)}%   (忽略深度) ${(100*(1-agg.ul/agg.tot)).toFixed(1)}%`);
console.log(`\n耗算杀最多的 8 手（单步内）:`);
rows.sort((a,b)=>b.total-a.total).slice(0,8).forEach(p=>{
  console.log(`   节点 ${String(p.total).padStart(7)}  唯一 ${String(p.uniqExact).padStart(7)}  ` +
              `置换率 ${(100*(1-p.uniqExact/p.total)).toFixed(1)}%  (忽略深度 ${(100*(1-p.uniqLoose/p.total)).toFixed(1)}%)`);
});
