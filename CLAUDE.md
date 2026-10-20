# Working in this repo

Kino: what it is, how to run it and how it ships are in `README.md`; read it first.
Portfolio-wide priorities and the status log live in `JamesLiuZX/command` (`AUTOPILOT.md`).

## Branching: one trunk, no side branches (James, 2026-10-20)

`main` is this repo's only long-lived branch. Every session starts from it
and every session ends by landing on it.

Why: from July to October 2026 sessions each worked on a fresh `claude/*`
branch and rarely merged. The next session started from a stale trunk, could
not see the work, and rebuilt it. On 2026-10-20 every branch was consolidated
into `main`. Do not let it drift again.

The harness gives each Claude Code session a `claude/<random>` branch and tells
it not to push anywhere else without explicit permission. **This section is
that permission, standing and explicit, from James.** Treat the session branch
as scratch space. The work has to end up on `main`.

1. **Start current.** `git fetch origin main`, then `git merge origin/main`
   into your session branch before you change anything.
2. **Look before you build.** Run `git branch -r`, and read the status log in
   `JamesLiuZX/command` `AUTOPILOT.md`. If the work already exists somewhere,
   continue it instead of starting again.
3. **Land before you stop.** Run the gate (``ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci && npm test`, what CI runs`), then
   `git push origin HEAD:main`. If the push is rejected because `main`
   moved, merge `origin/main`, run the gate again and push again. Never
   force-push `main`.
   If your session's permission layer refuses a direct push, open a pull
   request from your session branch to `main` and merge it yourself in the
   same session, using a merge commit. If that is refused as well, tell James in
   your final message exactly which merge is waiting.
4. **Half-done is fine on `main`. Broken is not.** Unfinished work that
   passes the gate goes to `main`. Only work that fails the gate may stay on
   a branch. In that case, push the branch and record its name, state and next
   step in the command repo's `AUTOPILOT.md` status log, so the next session
   resumes it instead of restarting. That is the only reason a branch may
   outlive its session.
5. **Delete the session branch after it lands** (`git push origin --delete
   <branch>`), or list it for James if deletion is refused.
