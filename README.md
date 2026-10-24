# Context Rings

A Claude Code mod that shows how full each of your sessions' context windows
is, as a row of rings above the prompt. The session you were active in most
recently comes first. Point at a ring to see the session's name, folder,
tokens used and whether it is working, idle or closed.

- **One ring per session.** A session shows for an hour after its last
  message, matching the prompt cache, and fades once its process closes.
  Opening an old session without sending anything doesn't bring it back.
  This session, and any session that's working, always shows.
- **Fill and color.** A ring fills against your context window (1M by default)
  and turns yellow, then red, at the percentages you choose (50% and 80% by
  default). A working session's ring pulses; this session's has a dot.
- **After `/compact`.** The ring drops to the compacted size right away, before
  the next reply reports the real one.
- **Subagents.** A subagent appears as a small dot after its session's ring
  only once it reaches the yellow line of the subagent limit (75% of 500K by
  default), and only while it is active. When it reaches red (90%) you get a
  single toast, shared across all your open sessions.
- **Cache about to expire.** Each reply records whether its prompt cache lives
  1 hour or 5 minutes. When a session's cache is close to running out (10
  minutes before for 1 hour, 1 minute for 5 minutes), its ring pulses for 10
  seconds, then an orange arc around it counts down to expiry, and you get one
  toast with the session, its size and the time left. Only sessions of 500K or
  more are warned about, since smaller ones are cheap to cache again. Hovering
  shows the time left, or how long ago it expired.
- **Up to ten rings.** Past ten, the least recent sessions fold into a `+N`;
  point at it to see their names. This session's ring always shows.
- **This folder.** The chip at the start of the row reads **All**; click it to
  show only the sessions in this session's folder, and again to go back.

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
| Subagent limit | 500K | 100K to 1M |
| Subagent dot appears (yellow) at | 75% | 30% to 90% |
| Subagent dot turns red (and toasts) at | 90% | 50% to 95% |
| 1-hour cache: warn before it expires | 10m | Off, 5m to 30m |
| 5-minute cache: warn before it expires | 1m | Off, 30s to 2m |
| Cache warning only for sessions over | 500K | Any, 100K to 1M |

## What it runs and changes

It sends nothing: no network calls. It does not read the conversation of the
session it runs in through Claude Code's API. It reads Claude Code's own files
about your sessions, on your machine, to find each session's name and context
size.

What it reads, every 5 seconds and after each turn:

| What | Why |
| --- | --- |
| `~/.claude/sessions/*.json` | Which sessions are running, their names, folders and whether they are working |
| `~/.claude/projects/**/*.jsonl` (the last 1 MB of each changed in the last hour) | The context size the last reply or compaction reported, when the last message and reply came, and the prompt cache's lifetime |
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
subagents and cache warnings were already toasted. Its hooks pass every event through unchanged.

Uninstall with `/plugin uninstall context-rings`; nothing is left behind but
that store.

## License

MIT
