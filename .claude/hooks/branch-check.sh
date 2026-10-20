#!/usr/bin/env bash
# SessionStart hook: before a session builds anything, show whether this
# checkout is behind the trunk and which other branches exist on origin, so the
# session continues work that already exists instead of rebuilding it.
# See "Branching: one trunk" in CLAUDE.md. Prints nothing when all is clean.
set -u
trunk=main

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
git fetch -q origin "+refs/heads/$trunk:refs/remotes/origin/$trunk" 2>/dev/null || exit 0

behind=$(git rev-list --count "HEAD..origin/$trunk" 2>/dev/null || echo 0)
# ls-remote, not fetch: lists every branch without downloading its contents.
others=$(git ls-remote --heads origin 2>/dev/null | sed 's|.*refs/heads/||' | grep -vxF "$trunk")

[ "$behind" = 0 ] && [ -z "$others" ] && exit 0

echo "Branch check (CLAUDE.md: one trunk; land on $trunk before you stop):"
if [ "$behind" != 0 ]; then
  echo "- This checkout is $behind commit(s) behind origin/$trunk. Merge origin/$trunk before changing anything."
fi
if [ -n "$others" ]; then
  echo "- Branches on origin besides $trunk. If one holds work for your task, merge it into $trunk instead of rebuilding it:"
  echo "$others" | sed 's/^/    /'
fi
exit 0
