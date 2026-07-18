# Shell integration (OSC 133)

Gosh parses [OSC 133](https://iterm2.com/documentation-escape-codes.html) markers from PTY output to detect prompt and command boundaries. Remote shells must emit these sequences; Gosh does not inject them locally.

Markers use BEL (`\007`) terminators:

| Marker | Meaning |
|--------|---------|
| `OSC 133 ; A` | Prompt start |
| `OSC 133 ; B` | Input start (after prompt) |
| `OSC 133 ; C` | Command output start |
| `OSC 133 ; D ; <exitcode>` | Command finished |

Snippets in this directory are idempotent (`GOSH_OSC133_INTEGRATION` guard) and preserve your existing prompt where possible.

## Install on a remote host (SSH)

No Gosh binary, Unix socket, or local env vars are required. Copy or fetch the snippet into the remote home directory and source it from the shell startup file.

### Bash

```bash
mkdir -p ~/.gosh
curl -fsSL https://raw.githubusercontent.com/esko/gosh/main/docs/agent/shell-integration/bash.sh \
  -o ~/.gosh/bash.sh
grep -q 'gosh/bash.sh' ~/.bashrc 2>/dev/null || \
  echo '[ -f ~/.gosh/bash.sh ] && . ~/.gosh/bash.sh' >> ~/.bashrc
```

Or paste manually:

```bash
echo '[ -f ~/.gosh/bash.sh ] && . ~/.gosh/bash.sh' >> ~/.bashrc
# copy docs/agent/shell-integration/bash.sh to ~/.gosh/bash.sh
```

### Zsh

```bash
mkdir -p ~/.gosh
curl -fsSL https://raw.githubusercontent.com/esko/gosh/main/docs/agent/shell-integration/zsh.zsh \
  -o ~/.gosh/zsh.zsh
grep -q 'gosh/zsh.zsh' ~/.zshrc 2>/dev/null || \
  echo '[ -f ~/.gosh/zsh.zsh ] && . ~/.gosh/zsh.zsh' >> ~/.zshrc
```

### Fish

```fish
mkdir -p ~/.config/gosh
curl -fsSL https://raw.githubusercontent.com/esko/gosh/main/docs/agent/shell-integration/fish.fish \
  -o ~/.config/gosh/fish.fish
grep -q 'gosh/fish.fish' ~/.config/fish/config.fish 2>/dev/null; or \
  echo 'test -f ~/.config/gosh/fish.fish; and source ~/.config/gosh/fish.fish' >> ~/.config/fish/config.fish
```

Open a new SSH session (or `source` the startup file), run a command, and confirm integration via the agent API or terminal debug HUD (see below).

## Verify in Gosh

### Agent control plane

When the pane host is wired, call `paneDiagnostics`:

```js
await window.__goshAgent.paneDiagnostics({ paneId: 'pane_…' })
// → { ok: true, value: { osc133: { detected: true, phase: 'B', … } } }
```

`osc133.detected` is `true` after any OSC 133 marker has been seen on that pane.

### Terminal debug HUD

Enable **Settings → Diagnostics → Debug pill**, open a terminal tab, click **dbg**, and look for the `osc133:` line on the active pane.

## Files

| File | Shell |
|------|-------|
| `bash.sh` | Bash |
| `zsh.zsh` | Zsh |
| `fish.fish` | Fish |
