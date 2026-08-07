'use strict';
// 更全面的 vcttt 确定性自检：LV3/LV4/LV5 出厂配置，各跑 2 个开局 x 2 遍。
const {build}=require('./load.js'); build('vcttt');
const {playGame}=require('./game.js');

const LV3 = { timeMs:1500, maxDepth:8,  vcfDepth:10, vcfBudget:120000, vctDepth:5, vctBudget:80000,
  vctDefDepth:0, vctDefBudget:0,      rand:0, rootFilter:false, forbid:false };
const LV4 = { timeMs:4000, maxDepth:12, vcfDepth:14, vcfBudget:400000, vctDepth:7, vctBudget:400000,
  vctDefDepth:5, vctDefBudget:60000,  rand:0, rootFilter:true,  forbid:false };
const LV5 = { timeMs:9000, maxDepth:18, vcfDepth:20, vcfBudget:1200000,vctDepth:9, vctBudget:1500000,
  vctDefDepth:7, vctDefBudget:150000, rand:0, rootFilter:true,  forbid:false };

const openings = [[[7,7],[7,8]], [[7,7],[8,8],[6,8]]];
let allOk = true;
for (const [name, cfg] of [['LV3',LV3], ['LV4',LV4], ['LV5',LV5]]) {
  for (const op of openings) {
    const A = require('./eng_vcttt.js'); // 复用同一模块实例，模拟真实 think() 连续调用
    const r1 = playGame({1:{mod:A,cfg}, 2:{mod:A,cfg}}, op);
    const r2 = playGame({1:{mod:A,cfg}, 2:{mod:A,cfg}}, op);
    const same = JSON.stringify(r1.moves) === JSON.stringify(r2.moves);
    if (!same) allOk = false;
    console.log(`${name} opening=${JSON.stringify(op)}: winner ${r1.winner},${r2.winner} len ${r1.moves.length},${r2.moves.length} identical=${same}`);
  }
}
console.log(allOk ? 'ALL DETERMINISTIC' : 'FAILED — 非确定性');
