# Gosh OSC 133 shell integration for Bash.
# Source from ~/.bashrc (or ~/.bash_profile) on remote SSH hosts.
#
# Emits prompt/command boundary markers:
#   A — prompt start
#   B — input start (after prompt)
#   C — command output start
#   D;<exitcode> — command finished

# shellcheck shell=bash

[[ -n "${GOSH_OSC133_INTEGRATION:-}" ]] && return 0
GOSH_OSC133_INTEGRATION=1

case "${TERM:-}" in
  dumb | linux) return 0 ;;
esac

__gosh_osc133_emit() {
  printf '%b' "$1"
}

__gosh_osc133_ps1_marker=$'\[\e]133;B\a\]'
__gosh_osc133_ps2_marker=$'\[\e]133;B\a\]'

__gosh_osc133_wrap_prompt() {
  if [[ "${PS1}" != *']133;B'* ]]; then
    PS1="${PS1}${__gosh_osc133_ps1_marker}"
  fi
  if [[ "${PS2}" != *']133;B'* ]]; then
    PS2="${PS2}${__gosh_osc133_ps2_marker}"
  fi
}

__gosh_osc133_precmd() {
  local rc=$?
  if [[ -n "${__gosh_osc133_have_prompted:-}" ]]; then
    __gosh_osc133_emit $'\033]133;D;'"${rc}"$'\007'
  fi
  __gosh_osc133_emit $'\033]133;A\007'
  __gosh_osc133_wrap_prompt
  __gosh_osc133_have_prompted=1
}

__gosh_osc133_preexec() {
  __gosh_osc133_emit $'\033]133;C\007'
}

__gosh_osc133_interactive=
__gosh_osc133_dbg() {
  [[ "${BASH_COMMAND:-}" == __gosh_osc133_* ]] && return 0
  [[ "${BASH_COMMAND:-}" == *PROMPT_COMMAND* ]] && return 0
  [[ -z "${__gosh_osc133_interactive:-}" ]] && return 0
  __gosh_osc133_interactive=
  local cmd
  cmd=$(HISTTIMEFORMAT= builtin history 1 | sed '1 s/^ *[0-9][0-9]*[* ] //')
  [[ -n "$cmd" ]] && __gosh_osc133_preexec
}

__gosh_osc133_prompt_command() {
  __gosh_osc133_precmd
  __gosh_osc133_interactive=1
}

if [[ "${PROMPT_COMMAND:-}" != *__gosh_osc133_prompt_command* ]]; then
  PROMPT_COMMAND="__gosh_osc133_prompt_command${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
fi

trap '__gosh_osc133_dbg' DEBUG
