const {build}=require('./load.js'); build('orig'); build('orig2');
const {playGame}=require('./game.js');
const A=require('./eng_orig.js'), B=require('./eng_orig2.js');
const CFG={timeMs:1500,maxDepth:12,vcfDepth:14,vcfBudget:400000,vctDepth:7,vctBudget:400000,vctDefDepth:5,vctDefBudget:60000,rand:0,rootFilter:true,forbid:false};
const r1=playGame({1:{mod:A,cfg:CFG},2:{mod:B,cfg:CFG}},[[7,7],[7,8]]);
const r2=playGame({1:{mod:A,cfg:CFG},2:{mod:B,cfg:CFG}},[[7,7],[7,8]]);
console.log('winner',r1.winner,r2.winner,'len',r1.moves.length,r2.moves.length);
console.log('identical:', JSON.stringify(r1.moves)===JSON.stringify(r2.moves));
