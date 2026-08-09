'use strict';
// 测「杀棋分未做 ply 校正」这个 bug 到底触发多少次。
//
// 背景：pvs() 里杀棋分是 `WIN-ply`（index.html:733-735），ply 是从**根**算起的层数。
// 存进 TT 时（index.html:778）直接 `ttVal[ti]=best`，没转成「距当前节点还有几步」。
// 于是同一个局面若在**不同 ply** 上被置换命中，取回来的杀棋分就偏了 (存时ply - 取时ply)。
//
// 这个脚本给 TT 加一条影子数组 ttPly 记录写入时的 ply，命中时比对，统计：
//   hit      —— TT 命中且深度够、真的用了表里的值
//   mateHit  —— 其中取回的是杀棋分（|v| >= WIN-1000）
//   mateBad  —— 其中 存时ply !== 取时ply，即取回了一个**错的**杀棋距离
//   maxErr   —— 偏差的最大绝对值（相当于杀棋距离算错了几步）
//   usedBad  —— mateBad 里真正影响了返回值/剪枝的那部分（tf===0 直接 return，
//               或 alpha/beta 收敛后 return），不只是改了窗口边界
//
// 用法：node probe_mate.js [局数]
const fs = require('fs');
const path = require('path');
const { build } = require('./load.js');
const { playGame } = require('./game.js');

const f = build('orig');
let src = fs.readFileSync(f, 'utf8');

// 1) 影子数组 + 计数器
src = src.replace(
  'var ttSide=new Int8Array(TT_SIZE), ttMove=new Int32Array(TT_SIZE);',
  'var ttSide=new Int8Array(TT_SIZE), ttMove=new Int32Array(TT_SIZE);\n' +
  'var ttPly=new Int8Array(TT_SIZE);\n' +
  'var M_hit=0, M_mateHit=0, M_mateBad=0, M_maxErr=0, M_usedBad=0, M_store=0, M_mateStore=0;\n' +
  'var MATE_BAND=WIN-1000;');
if (!src.includes('var ttPly=new Int8Array')) throw new Error('TT 数组声明未匹配');

// 2) 写表时记录 ply
const STORE_FROM =
  '  ttKey[ti]=hash2; ttSide[ti]=side; ttVal[ti]=best; ttDepth[ti]=depth>127?127:depth;';
const STORE_TO =
  '  M_store++; if(best>=MATE_BAND||best<=-MATE_BAND) M_mateStore++;\n' +
  '  ttPly[ti]=ply>127?127:ply;\n' + STORE_FROM;
if (!src.includes(STORE_FROM)) throw new Error('TT 写入点未匹配');
src = src.replace(STORE_FROM, STORE_TO);

// 3) 读表时比对。原文：
//      var tv=ttVal[ti], tf=ttFlag[ti];
//      if(tf===0) return tv;
//      else if(tf===1){ if(tv>alpha) alpha=tv; }
//      else { if(tv<beta) beta=tv; }
//      if(alpha>=beta) return tv;
const PROBE_FROM =
  '      var tv=ttVal[ti], tf=ttFlag[ti];\n' +
  '      if(tf===0) return tv;\n' +
  '      else if(tf===1){ if(tv>alpha) alpha=tv; }\n' +
  '      else { if(tv<beta) beta=tv; }\n' +
  '      if(alpha>=beta) return tv;';
const PROBE_TO =
  '      var tv=ttVal[ti], tf=ttFlag[ti];\n' +
  '      M_hit++;\n' +
  '      var _isMate = (tv>=MATE_BAND||tv<=-MATE_BAND), _bad=0;\n' +
  '      if(_isMate){\n' +
  '        M_mateHit++;\n' +
  '        var _err = ttPly[ti]-ply;\n' +
  '        if(_err!==0){ _bad=1; M_mateBad++; var _a=_err<0?-_err:_err; if(_a>M_maxErr) M_maxErr=_a; }\n' +
  '      }\n' +
  '      if(tf===0){ if(_bad) M_usedBad++; return tv; }\n' +
  '      else if(tf===1){ if(tv>alpha) alpha=tv; }\n' +
  '      else { if(tv<beta) beta=tv; }\n' +
  '      if(alpha>=beta){ if(_bad) M_usedBad++; return tv; }';
if (!src.includes(PROBE_FROM)) throw new Error('TT 读取点未匹配');
src = src.replace(PROBE_FROM, PROBE_TO);

src = src.replace('module.exports = ENG;',
  `ENG.mateProbe=function(){ return {hit:M_hit, mateHit:M_mateHit, mateBad:M_mateBad,
       maxErr:M_maxErr, usedBad:M_usedBad, store:M_store, mateStore:M_mateStore}; };
   ENG.mateReset=function(){ M_hit=0;M_mateHit=0;M_mateBad=0;M_maxErr=0;M_usedBad=0;M_store=0;M_mateStore=0; };
   module.exports = ENG;`);

const out = path.join(__dirname, 'eng_mateprobe.js');
fs.writeFileSync(out, src);
const E = require(out);

// LV5 出厂配置（必须与 index.html 的 LEVELS 逐项一致——这是本项目的硬规矩）
const LV5 = { timeMs:9000, maxDepth:18, vcfDepth:20, vcfBudget:1200000, vctDepth:9,
  vctBudget:1500000, vctDefDepth:7, vctDefBudget:150000, rand:0, rootFilter:true };

const OPENINGS = [
  [[7,7],[8,8],[6,8]],
  [[7,7],[6,6],[8,6]],
  [[7,7],[8,7],[6,7]],
];
const nGames = parseInt(process.argv[2] || '2', 10);

const agg = { hit:0, mateHit:0, mateBad:0, usedBad:0, store:0, mateStore:0, maxErr:0 };
let plies = 0;

for (let g = 0; g < nGames; g++) {
  const op = OPENINGS[g % OPENINGS.length];
  E.clearHistory();
  E.mateReset();
  playGame({ 1:{mod:E,cfg:LV5}, 2:{mod:E,cfg:LV5} }, op, () => { plies++; });
  const p = E.mateProbe();
  agg.hit += p.hit; agg.mateHit += p.mateHit; agg.mateBad += p.mateBad;
  agg.usedBad += p.usedBad; agg.store += p.store; agg.mateStore += p.mateStore;
  if (p.maxErr > agg.maxErr) agg.maxErr = p.maxErr;
  console.log(`局 ${g+1} 开局 ${JSON.stringify(op)}:`, JSON.stringify(p));
}

const pct = (a, b) => b ? (a / b * 100).toFixed(3) + '%' : '—';
console.log('\n===== 汇总（' + nGames + ' 局，' + plies + ' 手）=====');
console.log('TT 写入            :', agg.store, '  其中杀棋分:', agg.mateStore, pct(agg.mateStore, agg.store));
console.log('TT 命中且用了表值  :', agg.hit);
console.log('  取回的是杀棋分   :', agg.mateHit, pct(agg.mateHit, agg.hit));
console.log('  且 ply 不一致(错) :', agg.mateBad, pct(agg.mateBad, agg.hit), '  占杀棋分命中的', pct(agg.mateBad, agg.mateHit));
console.log('  错值真的被返回   :', agg.usedBad, pct(agg.usedBad, agg.hit));
console.log('杀棋距离最大偏差   :', agg.maxErr, '步');
