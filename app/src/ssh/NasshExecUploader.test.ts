import { describe, expect, it } from 'vitest';
import { buildPortableExecUploadCommand, pasteDirectoryShellExpr } from './NasshExecUploader';

describe('buildPortableExecUploadCommand', () => {
  it('probes GNU and macOS decoders and protects partial files', () => {
    const command = buildPortableExecUploadCommand('gosh-paste-token.png', '__END__');
    expect(command).toContain('umask 077');
    expect(command).toContain("d='/tmp'");
    expect(command).toContain(" -name 'gosh-paste-*' ");
    expect(command).toContain(" -name 'iwa-paste-*' ");
    expect(command).toContain('base64 --decode');
    expect(command).toContain('base64 -D');
    expect(command).toContain("trap 'rm -f \"$p\"'");
    expect(command).toContain('chmod 600 "$p"');
    expect(command).toContain('mv -f "$p" "$f"');
    expect(command).toContain("[ \"$line\" = '__END__' ]");
    expect(command).toContain('IWA_UPLOAD_OK:');
  });

  it('quotes absolute directories and expands relative ones under $HOME', () => {
    expect(pasteDirectoryShellExpr('/var/tmp/gosh')).toBe("'/var/tmp/gosh'");
    expect(pasteDirectoryShellExpr('.cache/gosh/pastes')).toBe('"$HOME/.cache/gosh/pastes"');
    expect(buildPortableExecUploadCommand('x.png', 'EOF', '.cache/gosh/pastes')).toContain(
      'd="$HOME/.cache/gosh/pastes"',
    );
  });
});
