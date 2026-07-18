# Gosh OSC 133 shell integration for Zsh.
# Source from ~/.zshrc on remote SSH hosts.
#
# Emits prompt/command boundary markers:
#   A — prompt start
#   B — input start (after prompt)
#   C — command output start
#   D;<exitcode> — command finished

[[ -n "${GOSH_OSC133_INTEGRATION:-}" ]] && return 0
GOSH_OSC133_INTEGRATION=1

case "${TERM:-}" in
  dumb | linux) return 0 ;;
esac

autoload -Uz add-zsh-hook

__gosh_osc133_wrap_prompt() {
  if [[ "${PS1}" != *']133;B'* ]]; then
    PS1=$'%{'$'\e]133;B\a'$'%}'"${PS1}"
  fi
  if [[ "${PS2}" != *']133;B'* ]]; then
    PS2=$'%{'$'\e]133;B\a'$'%}'"${PS2}"
  fi
}

__gosh_osc133_precmd() {
  local last_status=$?
  if [[ -n "${__gosh_osc133_have_prompted:-}" ]]; then
    print -Pn $'\e]133;D;'"${last_status}"$'\a'
  fi
  print -Pn $'\e]133;A\a'
  __gosh_osc133_wrap_prompt
  __gosh_osc133_have_prompted=1
}

__gosh_osc133_preexec() {
  print -Pn $'\e]133;C\a'
}

add-zsh-hook precmd __gosh_osc133_precmd
add-zsh-hook preexec __gosh_osc133_preexec
