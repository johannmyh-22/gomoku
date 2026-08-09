#!/bin/sh
# 长实验的定期存盘。容器闲置会被回收，回收时正在跑的进程会被杀、未提交的文件会丢。
# 每 20 分钟把对局日志拷进仓库并推送，这样即使中断，已完成的局数也不用重跑。
# 用法：checkpoint.sh <日志路径> <目标文件名>
LOG="$1"
NAME="$2"
REPO=/home/user/gomoku
while :; do
  sleep 1200
  [ -f "$LOG" ] || continue
  cp "$LOG" "$REPO/scratchpad/runs/$NAME"
  cd "$REPO" || exit 1
  if ! git diff --quiet -- "scratchpad/runs/$NAME" 2>/dev/null || \
     [ -n "$(git status --porcelain "scratchpad/runs/$NAME")" ]; then
    N=$(grep -c '^\[' "$REPO/scratchpad/runs/$NAME" 2>/dev/null || echo 0)
    git add "scratchpad/runs/$NAME"
    git commit -q -m "存盘：预登记 A/B 进度 ${N} 局

容器闲置会被回收，中途存盘保证已完成的对局数据不丢。
这是自动存盘，不含任何结论——判定规则见 scratchpad/PREREG_mateplykeep.md。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VNRmFz75VTRsXvo7x9FJPE" 2>/dev/null
    git push -q origin claude/vct-substitution-table-ab-zz5vci 2>/dev/null
  fi
done
