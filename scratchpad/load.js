'use strict';
// 从 index.html 抽取引擎源码，按变体做字符串替换，生成可在 Node 里 require 的模块
const fs = require('fs');
const path = require('path');
const os = require('os');

const HTML = require('path').join(__dirname, '..', 'index.html');
const OUTDIR = __dirname;

function rawEngine() {
  const lines = fs.readFileSync(HTML, 'utf8').split('\n');
  const a = lines.findIndex(l => l.includes('<script id="engineSrc"'));
  const b = lines.findIndex((l, i) => i > a && l.trim() === '</script>');
  return lines.slice(a + 1, b).join('\n');
}

// 原始根过滤代码块（必须与 index.html 完全一致）
const ORIG_FILTER = `  if(cfg.rootFilter && cnt>1){
    var goodLeft=cnt, lim=cnt<14?cnt:14;
    for(i=0;i<lim && goodLeft>1;i++){
      if(nowMs()>start+cfg.timeMs*0.45) break;
      make(rootMv[i],side);
      vcfNodes=0; vcfLimit=30000; vcfDeadline=start+cfg.timeMs*0.45;
      var lose=vcf(opp,10);
      if(!lose && cfg.vctDefDepth>0 && i<8){
        vctNodes=0; vctLimit=cfg.vctDefBudget; vctDeadline=start+cfg.timeMs*0.45;
        lose=vct(opp,cfg.vctDefDepth,0);
      }
      unmake(rootMv[i],side);
      if(lose){ rootBad[i]=1; goodLeft--; }
    }
    if(goodLeft<=0) for(i=0;i<cnt;i++) rootBad[i]=0;
  }`;

// 变体：'orig' | 'off' | 'fix'
// fix：只在「已检查且干净」的着法存在时才排除坏着；否则全部放行
const FILTERS = {
  orig: ORIG_FILTER,
  orig2: ORIG_FILTER,   // 与 orig 完全相同，用来测这套 12 局赛制的噪声底
  ttkeep: ORIG_FILTER,  // 置换表跨步保留（见 EXTRA）
  off: `  if(false){}`,
  fix: `  if(cfg.rootFilter && cnt>1){
    var cleanChecked=0, lim=cnt<14?cnt:14;
    for(i=0;i<lim;i++){
      if(nowMs()>start+cfg.timeMs*0.45) break;
      make(rootMv[i],side);
      vcfNodes=0; vcfLimit=30000; vcfDeadline=start+cfg.timeMs*0.45;
      var lose=vcf(opp,10);
      if(!lose && cfg.vctDefDepth>0 && i<8){
        vctNodes=0; vctLimit=cfg.vctDefBudget; vctDeadline=start+cfg.timeMs*0.45;
        lose=vct(opp,cfg.vctDefDepth,0);
      }
      unmake(rootMv[i],side);
      if(lose) rootBad[i]=1; else cleanChecked++;
    }
    if(cleanChecked===0) for(i=0;i<cnt;i++) rootBad[i]=0;
  }`,
};

// 统计版：不改变行为，只记录 orig 过滤的内部状态
const INSTR = ORIG_FILTER.replace(
  '    if(goodLeft<=0) for(i=0;i<cnt;i++) rootBad[i]=0;',
  `    if(goodLeft<=0) for(i=0;i<cnt;i++) rootBad[i]=0;
    var _chk=i, _bad=0, _cleanChk=0;
    for(var _t=0;_t<cnt;_t++) if(rootBad[_t]) _bad++;
    for(var _t=0;_t<_chk;_t++) if(!rootBad[_t]) _cleanChk++;
    ENG.stat.push({checked:_chk, cnt:cnt, bad:_bad, cleanChecked:_cleanChk,
                   timedOut: nowMs()>start+cfg.timeMs*0.45,
                   mvs:Array.prototype.slice.call(rootMv,0,cnt),
                   badFlags:Array.prototype.slice.call(rootBad,0,cnt)});`
);

const PICK_PATCH = [
  `  return {mv:bestMv, score:bestSc, depth:doneDepth, nodes:nodeCount,
          ms:Math.round(nowMs()-start), pv:pv, note:''};`,
  `  if(ENG.stat.length){ var _s=ENG.stat[ENG.stat.length-1];
    if(_s.mvs && _s.pickIdx===undefined) _s.pickIdx=_s.mvs.indexOf(bestMv); }
  return {mv:bestMv, score:bestSc, depth:doneDepth, nodes:nodeCount,
          ms:Math.round(nowMs()-start), pv:pv, note:''};`,
];

// 虚拟时钟：所有超时判断都走 nowMs()，把它换成节点计数驱动，
// 引擎即变成确定性的，而 12%/28%/45% 那套配额逻辑一行都不用动。
const VCLOCK = [
  ['function nowMs(){ return performance.now(); }',
   'var TICKS=0, TRATE=368;\nfunction nowMs(){ return TICKS/TRATE; }'],
  ['function pvs(side, depth, alpha, beta, ply){\n  nodeCount++;',
   'function pvs(side, depth, alpha, beta, ply){\n  nodeCount++; TICKS++;'],
  ['function vcf(side, depth){\n  if(++vcfNodes>vcfLimit) return 0;',
   'function vcf(side, depth){\n  TICKS++;\n  if(++vcfNodes>vcfLimit) return 0;'],
  ['function vct(side, depth, lvl){\n  if(++vctNodes>vctLimit) return 0;',
   'function vct(side, depth, lvl){\n  TICKS++;\n  if(++vctNodes>vctLimit) return 0;'],
  ['  timeout=0; nodeCount=0;', '  timeout=0; nodeCount=0; TICKS=0;'],
];

// 变体专属的额外改写
const EXTRA = {
  // think() 每步都清空整个置换表，上一手搜出来的结果全扔了。改成跨步保留。
  ttkeep: [['  ttClear(); killers.fill(0);', '  killers.fill(0);']],
};

function build(variant) {
  let src = rawEngine();
  const body = variant === 'instr' ? INSTR : FILTERS[variant];
  if (body === undefined) throw new Error('unknown variant ' + variant);
  if (!src.includes(ORIG_FILTER)) throw new Error('根过滤代码块未匹配，index.html 可能已改动');
  src = src.replace(ORIG_FILTER, body);
  for (const [from, to] of (EXTRA[variant] || [])) {
    if (!src.includes(from)) throw new Error('变体改写点未匹配: ' + from.slice(0, 40));
    src = src.replace(from, to);
  }
  for (const [from, to] of VCLOCK) {
    if (!src.includes(from)) throw new Error('虚拟时钟注入点未匹配: ' + from.slice(0, 40));
    src = src.replace(from, to);
  }
  if (variant === 'instr') {
    if (!src.includes(PICK_PATCH[0])) throw new Error('think 末尾 return 未匹配');
    src = src.replace(PICK_PATCH[0], PICK_PATCH[1]);
  }
  // 去掉 worker 消息接口
  src = src.replace(/\/\* -+ 消息接口 -+ \*\/[\s\S]*$/, '');
  const shim = `'use strict';
var ENG = { stat: [] };
var self = { postMessage: function(){} };
`;
  const tail = `
ENG.think = think;
ENG.reset = reset;
ENG.make = make;
ENG.unmake = unmake;
ENG.xy = xy;
ENG.W = W; ENG.PAD = PAD;
ENG.pos = function(x,y){ return (y+PAD)*W + (x+PAD); };
// reset() 不清历史启发/杀手表，跨局会留残留 -> 路径依赖。开局前必须清干净。
ENG.clearHistory = function(){ history.fill(0); killers.fill(0); ttClear(); };
ENG.setBoard = function(moves, forbid){
  reset(); FORBID = !!forbid;
  for (var i=0;i<moves.length;i++) make(ENG.pos(moves[i][0],moves[i][1]), (i%2===0)?1:2);
};
module.exports = ENG;
`;
  const file = path.join(OUTDIR, 'eng_' + variant + '.js');
  fs.writeFileSync(file, shim + src.replace(/^'use strict';/, '') + tail);
  return file;
}

module.exports = { build };
if (require.main === module) {
  for (const v of ['orig', 'off', 'fix', 'instr']) console.log(build(v));
}
