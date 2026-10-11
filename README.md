# Context Rings

A Claude Code mod that shows how full each of your sessions' context windows
is, as a row of rings above the prompt. The session you were active in most
recently comes first. Point at a ring to see the session's name, folder,
tokens used and whether it is working, idle or closed.

- **One ring per session.** A session shows while its process is running, and
  stays (faded) for an hour after it closes, matching the prompt cache.
- **Fill and color.** A ring fills against your context window (1M by default)
  and turns yellow, then red, at the percentages you choose (50% and 80% by
  default). A working session's ring pulses; this session's has a dot.
- **After `/compact`.** The ring drops to the compacted size right away, before
  the next reply reports the real one.
- **Subagents.** A subagent appears as a small dot after its session's ring
  only once it reaches the yellow line of the subagent limit (75% of 200K by
  default), and only while it is active. When it reaches red (90%) you get a
  single toast, shared across all your open sessions.
- **Folders.** The chip at the start of the row reads **All**; click it to step
  through each folder's sessions and back.

On the terminal the rings are drawn as `○ ◔ ◑ ◕ ●`.

## Install

At the prompt of a terminal session:

```
/plugin install context-rings --marketplace nvsravank/context-rings
```

## Settings

Each is a row in the mod's settings in `/config`.

| Setting | Default | Choices |
| --- | --- | --- |
| Session context window | 1M | 100K to 1M |
| Session ring turns yellow at | 50% | 30% to 90% |
| Session ring turns red at | 80% | 50% to 95% |
| Subagent limit | 200K | 100K to 1M |
| Subagent dot appears (yellow) at | 75% | 30% to 90% |
| Subagent dot turns red (and toasts) at | 90% | 50% to 95% |

## What it runs and changes

It sends nothing: no network calls. It does not read the conversation of the
session it runs in through Claude Code's API. It reads Claude Code's own files
about your sessions, on your machine, to find each session's name and context
size.

What it reads, every 5 seconds and after each turn:

| What | Why |
| --- | --- |
| `~/.claude/sessions/*.json` | Which sessions are running, their names, folders and whether they are working |
| `~/.claude/projects/**/*.jsonl` (the last 1 MB of each changed in the last hour) | The context size the last reply or compaction reported |
| `~/.claude/projects/**/custom-title.json`, `subagents/*.meta.json` | Session titles and subagent descriptions |

What it runs (read-only, no shell except the first):

| Command | Why |
| --- | --- |
| `sh -c 'printf %s "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"'` | Once, to find Claude Code's folder |
| `ps -o pid= -p <pids>` | Which session processes are still running |
| `find ~/.claude/projects … -exec stat -f '%m %N'` | Which transcripts changed, and when |
| `tail -c 1000000 <transcripts>` | The end of each changed transcript |

What it writes: only its own store in Claude Code's plugin data, holding
recent session names (so a closed session keeps its title) and which
subagents were already toasted. Its hooks pass every event through unchanged.

Uninstall with `/plugin uninstall context-rings`; nothing is left behind but
that store.

## License

MIT
