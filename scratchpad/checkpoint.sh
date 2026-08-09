#!/bin/sh
# 长实验的定期存盘。后台任务会被清理杀掉（实测约 4.6 小时），容器闲置也会被回收。
# 每 20 分钟把 runs/ 下的对局结果提交推送，最坏只丢 20 分钟。
#
# 关键教训（上一轮 4.6 小时白跑）：**存盘必须存判定所需的字段**。
# 当时存的日志只有手数和耗时，胜负只活在主控进程内存里，进程一死数据全废。
# 现在存的是 ab_lv5.js 写的 .jsonl，每行含 aWon，可独立判定。
REPO=/home/user/gomoku
BRANCH=claude/vct-substitution-table-ab-zz5vci
while :; do
  sleep 1200
  cd "$REPO" || exit 1
  [ -n "$(git status --porcelain scratchpad/runs/)" ] || continue
  N=$(cat scratchpad/runs/*.jsonl 2>/dev/null | wc -l)
  git add scratchpad/runs/
  git commit -q -m "存盘：预登记 A/B 已完成 ${N} 局

自动存盘，只含原始对局结果（每行有 aWon，可独立判定），不含任何结论。
判定规则见 scratchpad/PREREG_mateplykeep.md，合并统计用 pool_prereg.js。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VNRmFz75VTRsXvo7x9FJPE" 2>/dev/null
  git push -q origin "$BRANCH" 2>/dev/null
done
