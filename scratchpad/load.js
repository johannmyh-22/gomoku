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

// 原始 vct() 函数（必须与 index.html 完全一致）——加 TT 用
const ORIG_VCT = `function vct(side, depth, lvl){
  if(++vctNodes>vctLimit) return 0;
  if((vctNodes&255)===0 && nowMs()>vctDeadline) return 0;
  if(lvl>=30) return 0;
  var opp=3-side, i, k, q;
  if(fivePoints(side,1)>0) return fpBuf[0];
  if(depth<=0) return 0;
  var on=fivePoints(opp,2);
  if(on>=2) return 0;
  var forced = on===1 ? fpBuf[0] : 0;         // 对方有冲四：我只能走那一点

  var S=side===BLACK?SB:SW, base=lvl*64, n=0, kind;
  for(i=0;i<225;i++){
    q=CELLS[i];
    if(board[q]!==EMPTY||adj[q]===0) continue;
    if(forced && q!==forced) continue;
    kind=forcingKind(side,q);
    if(kind===0) continue;
    if(FORBID && side===BLACK && isForbidden(q)) continue;
    if(n<64){ atkBuf[base+n]=q; atkSc[base+n]=kind*4000000+S[q]; n++; }
  }
  for(i=1;i<n;i++){                            // 冲四优先，其次按威胁分
    var mq=atkBuf[base+i], ms=atkSc[base+i], j=i-1;
    while(j>=0&&atkSc[base+j]<ms){ atkBuf[base+j+1]=atkBuf[base+j]; atkSc[base+j+1]=atkSc[base+j]; j--; }
    atkBuf[base+j+1]=mq; atkSc[base+j+1]=ms;
  }
  for(i=0;i<n;i++){
    q=atkBuf[base+i];
    var PS4=side===BLACK?PB:PW, sb=q*4, s4=lvl*4;
    patSave[s4]=PS4[sb]; patSave[s4+1]=PS4[sb+1]; patSave[s4+2]=PS4[sb+2]; patSave[s4+3]=PS4[sb+3];
    make(q,side);
    var res=0, w=fivePoints(side,2);
    if(w>=2) res=q;                            // 做成活四，挡不住
    else{
      var nd=genDefense(side,q,w,lvl);
      if(nd===-1) res=q;                       // 对方因禁手无法防守
      else if(nd>0){
        var all=1, dbase=lvl*32;
        for(k=0;k<nd;k++){
          var dm=defBuf[dbase+k];
          make(dm,opp);
          var r=vct(side,depth-1,lvl+1);
          unmake(dm,opp);
          if(!r){ all=0; break; }
        }
        if(all) res=q;
      }
    }
    unmake(q,side);
    if(res) return res;
    if(vctNodes>vctLimit||nowMs()>vctDeadline) return 0;
  }
  return 0;
}`;

// VCT 置换表：只加在 vct() 上（VCF 只占算杀节点 0.3%，加了白写，见 PROGRESS）。
// 深度字段照旧比对——剩余深度是局面的函数，不会丢命中，但能防止「进攻搜索」和
// 「rootFilter 防守搜索」两条起始预算不同的搜索线在同一局面上互相污染。
// 中止污染：vctLimit/vctDeadline/lvl 上限撞到时的 0 不是证伪，用全局计数器
// vctAbortMark 标记——进节点前记 mark，子树搜完后计数器没变才允许写证伪条目；
// 证明（找到杀点）不受影响，随时可写。证明条目用前必须校验 board[m]===EMPTY
// 且确实是威胁点，防哈希碰撞出假杀。
const NEW_VCT = `var VCT_TT_BITS=21, VCT_TT_SIZE=1<<VCT_TT_BITS, VCT_TT_MASK=VCT_TT_SIZE-1;
var vctTtKey=new Int32Array(VCT_TT_SIZE), vctTtSide=new Int8Array(VCT_TT_SIZE);
var vctTtDepth=new Int8Array(VCT_TT_SIZE), vctTtFlag=new Int8Array(VCT_TT_SIZE);
var vctTtMove=new Int32Array(VCT_TT_SIZE);
var vctAbortMark=0;
function vctTtClear(){ vctTtSide.fill(0); }
function vctTtIndex(side){ return (hash1^(side===BLACK?0x2f6e2b1d:0x7c9e6a3f))&VCT_TT_MASK; }

function vct(side, depth, lvl){
  TICKS++;
  if(++vctNodes>vctLimit){ vctAbortMark++; return 0; }
  if((vctNodes&255)===0 && nowMs()>vctDeadline){ vctAbortMark++; return 0; }
  if(lvl>=30){ vctAbortMark++; return 0; }
  var opp=3-side, i, k, q;
  if(fivePoints(side,1)>0) return fpBuf[0];
  if(depth<=0) return 0;
  var on=fivePoints(opp,2);
  if(on>=2) return 0;

  var d2=depth>127?127:depth, ti=vctTtIndex(side);
  if(vctTtSide[ti]===side && vctTtKey[ti]===hash2 && vctTtDepth[ti]===d2){
    var tf=vctTtFlag[ti];
    if(tf===1) return 0;
    if(tf===2){
      var hm=vctTtMove[ti];
      if(board[hm]===EMPTY && forcingKind(side,hm)!==0) return hm;
    }
  }
  var mark=vctAbortMark;
  var forced = on===1 ? fpBuf[0] : 0;         // 对方有冲四：我只能走那一点

  var S=side===BLACK?SB:SW, base=lvl*64, n=0, kind;
  for(i=0;i<225;i++){
    q=CELLS[i];
    if(board[q]!==EMPTY||adj[q]===0) continue;
    if(forced && q!==forced) continue;
    kind=forcingKind(side,q);
    if(kind===0) continue;
    if(FORBID && side===BLACK && isForbidden(q)) continue;
    if(n<64){ atkBuf[base+n]=q; atkSc[base+n]=kind*4000000+S[q]; n++; }
  }
  for(i=1;i<n;i++){                            // 冲四优先，其次按威胁分
    var mq=atkBuf[base+i], ms=atkSc[base+i], j=i-1;
    while(j>=0&&atkSc[base+j]<ms){ atkBuf[base+j+1]=atkBuf[base+j]; atkSc[base+j+1]=atkSc[base+j]; j--; }
    atkBuf[base+j+1]=mq; atkSc[base+j+1]=ms;
  }
  for(i=0;i<n;i++){
    q=atkBuf[base+i];
    var PS4=side===BLACK?PB:PW, sb=q*4, s4=lvl*4;
    patSave[s4]=PS4[sb]; patSave[s4+1]=PS4[sb+1]; patSave[s4+2]=PS4[sb+2]; patSave[s4+3]=PS4[sb+3];
    make(q,side);
    var res=0, w=fivePoints(side,2);
    if(w>=2) res=q;                            // 做成活四，挡不住
    else{
      var nd=genDefense(side,q,w,lvl);
      if(nd===-1) res=q;                       // 对方因禁手无法防守
      else if(nd>0){
        var all=1, dbase=lvl*32;
        for(k=0;k<nd;k++){
          var dm=defBuf[dbase+k];
          make(dm,opp);
          var r=vct(side,depth-1,lvl+1);
          unmake(dm,opp);
          if(!r){ all=0; break; }
        }
        if(all) res=q;
      }
    }
    unmake(q,side);
    if(res){
      vctTtKey[ti]=hash2; vctTtSide[ti]=side; vctTtDepth[ti]=d2;
      vctTtFlag[ti]=2; vctTtMove[ti]=res;
      return res;
    }
    if(vctNodes>vctLimit||nowMs()>vctDeadline){ vctAbortMark++; return 0; }
  }
  if(vctAbortMark===mark){
    vctTtKey[ti]=hash2; vctTtSide[ti]=side; vctTtDepth[ti]=d2;
    vctTtFlag[ti]=1; vctTtMove[ti]=0;
  }
  return 0;
}`;

// 变体：'orig' | 'off' | 'fix'
// fix：只在「已检查且干净」的着法存在时才排除坏着；否则全部放行
const FILTERS = {
  orig: ORIG_FILTER,
  orig2: ORIG_FILTER,   // 与 orig 完全相同，用来测这套 12 局赛制的噪声底
  ttkeep: ORIG_FILTER,  // 置换表跨步保留（见 EXTRA）
  vcttt: ORIG_FILTER,   // VCT 置换表（见 EXTRA）
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
  // VCT 置换表：vct() 换成带 TT 的版本；ttClear() 顺带清 VCT 表——
  // think() 每步调用一次 ttClear()，且 ENG.clearHistory() 也走 ttClear()，
  // 两处覆盖到位后 VCT 表天然是「每步清空」的生命周期，跟置换率测量口径一致，
  // 且跨局不会残留（det.js 的确定性台子依赖这一点，见 PROGRESS）。
  vcttt: [
    ['function ttClear(){ ttSide.fill(0); }', 'function ttClear(){ ttSide.fill(0); vctTtClear(); }'],
    [ORIG_VCT, NEW_VCT],
  ],
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
    if (src.includes(from)) { src = src.replace(from, to); continue; }
    // 变体的 EXTRA 改写可能已经把 TICKS++ 手动焊进函数头（如 vcttt 的新 vct()）
    const marker = to.split('\n').slice(0, 2).join('\n');
    if (src.includes(marker)) continue;
    throw new Error('虚拟时钟注入点未匹配: ' + from.slice(0, 40));
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
