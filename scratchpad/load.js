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
  vcttt: ORIG_FILTER,   // VCT 置换表（已过期，见 EXTRA）
  noTT: ORIG_FILTER,    // 反向 patch：合入后的引擎去掉 VCT TT（见 EXTRA）
  rootsort: ORIG_FILTER, deeper: ORIG_FILTER, partial: ORIG_FILTER,
  deeppartial: ORIG_FILTER, lv5all: ORIG_FILTER,
  mateply: ORIG_FILTER, mateplykeep: ORIG_FILTER,  // 杀棋分 ply 校正（已合入，变体过期）/ 再叠 TT 跨步保留
  noMatePly: ORIG_FILTER,   // 反向：退回没有 ply 校正（见 EXTRA）
  ev3hi: ORIG_FILTER, ev3lo: ORIG_FILTER,   // 评估函数敏感度诊断：活三权重 ±30%（见 EXTRA）
  evflat: ORIG_FILTER,                      // 评估轴的阳性对照：压平整张棋型权重表（见 EXTRA）
  evmix25: ORIG_FILTER, evmix50: ORIG_FILTER, evmix75: ORIG_FILTER,  // 平台测绘（见 EXTRA）
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
  // vct() 有两种可能的开头：合入 TT 后的版本（中止要先给 vctAbortMark 计数），
  // 或者 noTT 变体反向 patch 回去的原版——两种都可能出现在 rawEngine() 里，都要能注入
  [
    ['function vct(side, depth, lvl){\n  if(++vctNodes>vctLimit){ vctAbortMark++; return 0; }',
     'function vct(side, depth, lvl){\n  TICKS++;\n  if(++vctNodes>vctLimit){ vctAbortMark++; return 0; }'],
    ['function vct(side, depth, lvl){\n  if(++vctNodes>vctLimit) return 0;',
     'function vct(side, depth, lvl){\n  TICKS++;\n  if(++vctNodes>vctLimit) return 0;'],
  ],
  ['  timeout=0; nodeCount=0;', '  timeout=0; nodeCount=0; TICKS=0;'],
];

// VCT TT 已经合入 index.html（见 PROGRESS「一之三」），vct() 的真实文本变了。
// 这里存一份「合入后的原文」，用于 noTT 变体反向 patch 回不带 TT 的版本——
// 需要继续测「有 TT vs 没 TT」时（比如 5 档），不用再手改 index.html。
const CURRENT_VCT = `function vct(side, depth, lvl){
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

// 变体专属的额外改写
/* ---------- LV5（地狱级）专项：迭代加深的三处浪费 ----------
   实测 LV5 单手只用掉 56~74% 的 9 秒预算，maxDepth 写 18 实际只到 12~13 层。
   三个独立的候选改动，各自都很小： */

// A. 根节点着法从不重排：sortRoot() 只在「弱难度随机」里被调用过，
//    迭代加深循环里没有。上一层搜出来的分数没有用于给下一层排序，
//    等于每层都从 genMoves 的初始启发顺序重新搜，alpha-beta 剪枝效率白扔。
const ROOTSORT = [
  `    if(nowMs()-searchStart > remain*0.45) break;
  }`,
  `    if(nowMs()-searchStart > remain*0.45) break;
    sortRoot();
  }`,
];

// B. 收尾过早：完成一层后若已用掉「剩余预算的 45%」就不再往下搜。
//    这个阈值偏保守，是 26~44% 预算空转的直接原因。放宽到 65%。
const DEEPER = [
  '    if(nowMs()-searchStart > remain*0.45) break;',
  '    if(nowMs()-searchStart > remain*0.65) break;',
];

// C. 半层结果全扔：某层搜到一半超时，这层已经搜完的根着法结果被整个丢弃
//    （`!timeout` 那个条件）。但 rootIteration 在 timeout 时是先 break 再记分的，
//    已记录的分数都来自搜完的着法，是可用的——标准做法是采纳这个部分结果。
const PARTIAL = [
  '    if(bi>=0 && (!timeout || d<=2)){',
  '    if(bi>=0){',
];

// D. 杀棋分没做 ply 校正（正确性 bug，不是优化）。
//    pvs() 里杀棋分是 `WIN-ply`，ply 从**根**算起；存进 TT 时直接 `ttVal[ti]=best`，
//    存的是「从根数第几层将杀」而不是「距这个节点还有几步将杀」。同一局面在不同 ply
//    被置换命中时，取回的杀棋距离就偏了 (存时ply - 取时ply) 步。
//    标准修法：写表时 +ply 转成节点相对，读表时 -ply 转回根相对。
//    MATE_BAND=WIN-1000 能干净地把真杀棋分（WIN-48 ~ WIN，MAXPLY=48）
//    和 NEARWIN 启发分（80 万量级）分开，不会误伤后者。
// 【已过期】ply 校正已于 2026-08-10 合入 index.html，这组改写点再也匹配不上，
//    build('mateply') 会直接报错——跟当年 vcttt 合入后的下场一样，是设计内行为。
//    要重测「有没有 ply 校正」，用下面的反向变体 noMatePly。
const MATEPLY = [
  ['var TT_BITS=20, TT_SIZE=1<<TT_BITS, TT_MASK=TT_SIZE-1;',
   'var TT_BITS=20, TT_SIZE=1<<TT_BITS, TT_MASK=TT_SIZE-1;\nvar MATE_BAND=WIN-1000;'],
  ['      var tv=ttVal[ti], tf=ttFlag[ti];',
   '      var tv=ttVal[ti], tf=ttFlag[ti];\n' +
   '      if(tv>=MATE_BAND) tv-=ply; else if(tv<=-MATE_BAND) tv+=ply;'],
  ['  ttKey[ti]=hash2; ttSide[ti]=side; ttVal[ti]=best; ttDepth[ti]=depth>127?127:depth;',
   '  var _sv=best;\n' +
   '  if(_sv>=MATE_BAND) _sv+=ply; else if(_sv<=-MATE_BAND) _sv-=ply;\n' +
   '  ttKey[ti]=hash2; ttSide[ti]=side; ttVal[ti]=_sv; ttDepth[ti]=depth>127?127:depth;'],
];

// 反向 patch：把合入后的引擎退回**没有 ply 校正**的状态。
// 用途：继续测「有校正 vs 没校正」，或给 TT 跨步保留那条线做对照。
// 注意合入版用的是 `var sv=`（无下划线），跟上面 MATEPLY 生成的 `_sv` 不是一回事。
const NO_MATEPLY = [
  ['      if(tv>=MATE_BAND) tv-=ply; else if(tv<=-MATE_BAND) tv+=ply;\n', ''],
  ['  var sv=best;\n' +
   '  if(sv>=MATE_BAND) sv+=ply; else if(sv<=-MATE_BAND) sv-=ply;\n' +
   '  ttKey[ti]=hash2; ttSide[ti]=side; ttVal[ti]=sv; ttDepth[ti]=depth>127?127:depth;',
   '  ttKey[ti]=hash2; ttSide[ti]=side; ttVal[ti]=best; ttDepth[ti]=depth>127?127:depth;'],
];

/* ---------- E. 评估函数敏感度诊断：活三权重 ±30% ----------
   PROGRESS「一之七」把搜索侧整类方向划掉后，评估函数是唯一没被证伪的方向。
   但在直接调权重之前，得先回答「权重到底是不是杠杆」——所以先做敏感度诊断。

   权重表就一行：PSCORE=[0, 2, 14, 20, 220, 240, 3000, 20000]
                        无 活二 眠三? 眠三 活三 冲四 活四   五

   为什么挑活三（220）而不是别的：
   1. **整体缩放全表是纯空操作**（分数只用于比大小），必须动相对权重，即某个单项。
   2. 活三在中局几乎每手都出现，是安静局面里评估分的主要来源。
   3. 邻居是 冲四=240。±30% 后 286 / 154 分别**跨过**这条线：
      +30% 活三压过冲四、−30% 活三低于冲四。这是质变不是微调，
      基本保证不会是空操作（仍会按规矩实测验证，教训见 PROGRESS「接手最容易犯的错」第 4 条）。

   实验设计是 **ev3hi 直接对打 ev3lo**（60% 跨度），不是各自 vs 出厂：
   单次实验拿到最大对比度。连这个都测不出差异 → 权重不是杠杆，结论够硬。 */
const PSCORE_ORIG = 'var PSCORE=new Int32Array([0,2,14,20,220,240,3000,20000]);';
const EV3HI = [[PSCORE_ORIG, 'var PSCORE=new Int32Array([0,2,14,20,286,240,3000,20000]);']];
const EV3LO = [[PSCORE_ORIG, 'var PSCORE=new Int32Array([0,2,14,20,154,240,3000,20000]);']];

/* ---------- F. 评估轴的阳性对照：压平整张棋型权重表 ----------
   LV3 实测活三 ±30%（60% 跨度）= 94:106，未能证明敏感。这个 null 有两种
   完全不同的解释，分不清就往下投算力是浪费：
     (1) 权重表是杠杆，只是 ±30% 太小；
     (2) 权重表根本不是杠杆——棋力几乎全来自 VCF/VCT 算杀那层，评估只是摆设。

   区分办法照搬「一之七」的招：**做阳性对照**。那次用「预算翻倍/减半」去验测量台，
   这次用「大幅破坏评估」去验评估轴本身。破坏比改进便宜，跟「减预算比加预算便宜」同理。

   evflat：把所有非空棋型设成同一个分（10）。于是
     - evaluate() 退化成「我方有棋型的方向数 − 对方的」，**棋型好坏的知识全没了**
     - SB/SW 里 `s` 那条回退路径同样退化成纯连接性计数（走法排序也一起变差）
     - 但 SC_FIVE/SC_OFOUR/SC_44/SC_43/SC_33 这些**战术复合判定不受影响**，
       VCF/VCT 算杀能力完整保留
   这正好把「棋型知识」与「算杀能力」分离开。

   判读：
     - 明显掉棋力 → 解释 (1)，轴是活的，值得去 LV5 精调
     - **连这个都测不出** → 解释 (2) 坐实，调权重整条路封死，转开局库 / 新特征 */
const EVFLAT = [[PSCORE_ORIG, 'var PSCORE=new Int32Array([0,10,10,10,10,10,10,10]);']];

/* ---------- G. 平台测绘：出厂 ↔ 压平 之间的插值 ----------
   到此为止评估轴上只有两个点：×1 附近 ±30% 是平的（94:106），整表压平 = −168 Elo。
   中间一大段空白。「平台假说」（出厂值已在平台上，微调无用）与「幅度假说」
   （±30% 太小，更大范围仍有戏）都还站得住，本轮数据区分不了。

   区分办法：在这两个已知点之间连一条线量过去。
     w_i(t) = round(w_i(出厂) * (1−t) + 10 * t)
   t=0 是出厂，t=1 就是已测的 evflat（−168 Elo）。

   这条线的性质：**t<1 时棋型之间的大小顺序完全保留，变的只是比例（差距被压缩）**。
   所以它量的正是「比例要多准才够用」——而不是「顺序对不对」。

   判读：
     - t=0.5 仍测不出差异 → 这张表容错极大，任何现实幅度的重新配比都换不来棋力，
       平台假说坐实，调权重整条路封死
     - 某个 t 开始掉 → 平台有边界，幅度假说有戏，再谈往哪调

   跟「减预算比加预算便宜」同一条方法论：不猜哪个方向更好，只量离出厂值多远才开始有影响。 */
const PSCORE_FACTORY = [0, 2, 14, 20, 220, 240, 3000, 20000];
function pscoreMix(t) {
  const w = PSCORE_FACTORY.map((v, i) => i === 0 ? 0 : Math.round(v * (1 - t) + 10 * t));
  return 'var PSCORE=new Int32Array([' + w.join(',') + ']);';
}

const EXTRA = {
  // 【已过期】ply 校正已合入 index.html，改写点不再匹配，build 会报错。留作历史记录。
  mateply: MATEPLY,
  // 评估函数敏感度诊断（见上面 EV3HI / EV3LO 注释）
  ev3hi: [EV3HI[0]],
  ev3lo: [EV3LO[0]],
  // 评估轴的阳性对照（见上面 EVFLAT 注释）
  evflat: [EVFLAT[0]],
  // 平台测绘：出厂 ↔ 压平 之间的插值（见上面 pscoreMix 注释）
  evmix25: [[PSCORE_ORIG, pscoreMix(0.25)]],
  evmix50: [[PSCORE_ORIG, pscoreMix(0.50)]],
  evmix75: [[PSCORE_ORIG, pscoreMix(0.75)]],
  // 反向变体：把合入后的引擎退回没有 ply 校正的状态（见 NO_MATEPLY 注释）
  noMatePly: NO_MATEPLY,
  // 杀棋分 ply 校正 + 置换表跨步保留。
  // 这才是这条线真正的实验：单独修 ply 校正时 bug 只在「同一手棋内、同一局面出现在
  // 不同 ply」时触发，实测 267/330万次命中 = 0.008%，小到不可能在 48 局里显形。
  // 但一旦 TT 跨步保留，上一手存的条目在这一手会**系统性地**差 2 个 ply，bug 从
  // 「偶发」变成「每条跨步复用的杀棋分都错」——PROGRESS「一之二」猜测 ttkeep 当年
  // 打出 22:26 正是栽在这里，这个变体就是去验那条猜测。
  // 注意只保留主搜索 TT，VCT TT 仍每步清空（`vctTtClear()`）：当年测 ttkeep 时
  // VCT TT 还没合入，保持口径一致才可比，也避免一次动两个变量。
  // ply 校正已合入引擎，所以这个变体现在只需叠「TT 跨步保留」这一件事。
  // 预登记 200 局实测 98:99（−2 Elo），中性——保留变体供将来复现，不再是候选改动。
  mateplykeep: [['  ttClear(); killers.fill(0);', '  vctTtClear(); killers.fill(0);']],
  // think() 每步都清空整个置换表，上一手搜出来的结果全扔了。改成跨步保留。
  ttkeep: [['  ttClear(); killers.fill(0);', '  killers.fill(0);']],
  // 【已过期】VCT 置换表实验变体——TT 已经合入 index.html（见 PROGRESS「一之三」），
  // ORIG_VCT 匹配不到当前源码了，build('vcttt') 会直接报错。留着做历史记录，
  // 真要继续测「有 TT vs 没 TT」，用下面的 noTT 反向变体。
  vcttt: [
    ['function ttClear(){ ttSide.fill(0); }', 'function ttClear(){ ttSide.fill(0); vctTtClear(); }'],
    [ORIG_VCT, NEW_VCT],
  ],
  // noTT：反向 patch——把合入后的 vct() 换回不带 TT 的版本，用于继续做「有 TT vs 没 TT」
  // 的 A/B（比如 5 档没测过）。跟 orig 的区别只有这一个函数。
  noTT: [
    ['function ttClear(){ ttSide.fill(0); vctTtClear(); }', 'function ttClear(){ ttSide.fill(0); }'],
    [CURRENT_VCT, ORIG_VCT],
  ],
  // LV5 专项（见上面 ROOTSORT / DEEPER / PARTIAL 注释）
  rootsort: [ROOTSORT],
  deeper: [DEEPER],
  partial: [PARTIAL],
  // 组合。实测（3 个 LV5 局面）：partial 单独是空操作——45% 阈值下搜索基本不会
  // 「搜到一半超时」，没有半层结果可捡；deeper 单独也不涨深度——多搜的那层超时后整层被丢。
  // 两者必须配对：放宽阈值去够更深的一层，再把超时那层搜完的部分捡回来。
  deeppartial: [DEEPER, PARTIAL],
  lv5all: [ROOTSORT, DEEPER, PARTIAL],
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
  for (const entry of VCLOCK) {
    const candidates = Array.isArray(entry[0]) ? entry : [entry];
    let matched = false;
    for (const [from, to] of candidates) {
      if (src.includes(from)) { src = src.replace(from, to); matched = true; break; }
      // 变体的 EXTRA 改写可能已经把 TICKS++ 手动焊进函数头（如 vcttt 的新 vct()）
      const marker = to.split('\n').slice(0, 2).join('\n');
      if (src.includes(marker)) { matched = true; break; }
    }
    if (!matched) throw new Error('虚拟时钟注入点未匹配: ' + candidates[0][0].slice(0, 40));
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
