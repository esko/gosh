# Gosh OSC 133 shell integration for Fish.
# Source from ~/.config/fish/config.fish on remote SSH hosts.
#
# Emits prompt/command boundary markers:
#   A — prompt start
#   B — input start (after prompt)
#   C — command output start
#   D;<exitcode> — command finished

if set -q GOSH_OSC133_INTEGRATION
    return
end
set -g GOSH_OSC133_INTEGRATION 1

switch "$TERM"
    case dumb linux
        return
end

if functions -q fish_prompt
    functions -c fish_prompt __gosh_osc133_original_prompt
else
    function __gosh_osc133_original_prompt
    end
end

function fish_prompt --description 'Gosh OSC 133 wrapped prompt'
    set -l last_status $status
    if set -q __gosh_osc133_have_prompted
        printf '\e]133;D;%s\a' $last_status
    end
    printf '\e]133;A\a'
    set -g __gosh_osc133_have_prompted 1
    __gosh_osc133_original_prompt
    printf '\e]133;B\a'
end

function __gosh_osc133_preexec --on-event fish_preexec --description 'Gosh OSC 133 command start'
    printf '\e]133;C\a'
end
