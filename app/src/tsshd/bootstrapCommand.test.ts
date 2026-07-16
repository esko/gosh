import { describe, expect, it } from 'vitest';
import { buildTsshdBootstrapCommand, parseTsshdOutput } from './bootstrapCommand';

describe('tsshd bootstrap command', () => {
  it('builds a safe shell command that launches tsshd', () => {
    const cmd = buildTsshdBootstrapCommand('KCP');
    expect(cmd).toContain('env PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin sh -c');
    expect(cmd).toContain('tsshd --kcp');
    expect(cmd).toContain("'tsshd --kcp 2>&1'");
  });

  it('omits --kcp when using QUIC', () => {
    const cmd = buildTsshdBootstrapCommand('QUIC');
    expect(cmd).toContain("'tsshd 2>&1'");
    expect(cmd).not.toContain('--kcp');
  });
});

describe('parseTsshdOutput', () => {
  it('parses real QUIC tsshd output', () => {
    const output = `\x07{"ServerVer":"0.1.8","Port":61941,"Mode":"QUIC","ServerCert":"abcd","ClientCert":"efgh","ClientKey":"ijkl","ProxyKey":"3b64d3cb95f960896e9b693c8c95bff210e58c7ab3e0a51225481c5c3467c781","ClientID":968063680437322885,"ServerID":5128674216168308705}`;
    const info = parseTsshdOutput(output);
    expect(info).not.toBeNull();
    expect(info!.Port).toBe(61941);
    expect(info!.Mode).toBe('QUIC');
    expect(info!.ProxyKey).toBe('3b64d3cb95f960896e9b693c8c95bff210e58c7ab3e0a51225481c5c3467c781');
    expect(info!.ClientID).toBe(968063680437322885);
    expect(info!.ServerID).toBe(5128674216168308705);
  });

  it('parses real KCP tsshd output', () => {
    const output = `\x07{"ServerVer":"0.1.8","Port":61382,"Mode":"KCP","Pass":"73685cf29e","Salt":"7cfd2ab29b","ProxyKey":"25f0a87d2b7732c4fae9b8dea3af071c","ClientID":13200128884507580995,"ServerID":14014290635229521621}`;
    const info = parseTsshdOutput(output);
    expect(info).not.toBeNull();
    expect(info!.Port).toBe(61382);
    expect(info!.Mode).toBe('KCP');
    expect(info!.Pass).toBe('73685cf29e');
    expect(info!.Salt).toBe('7cfd2ab29b');
    expect(info!.ProxyKey).toBe('25f0a87d2b7732c4fae9b8dea3af071c');
    expect(info!.ClientID).toBe(13200128884507580995);
    expect(info!.ServerID).toBe(14014290635229521621);
  });

  it('handles leading ANSI/bell/whitespace before JSON', () => {
    const output = '\x07\x1b[0m\n{"Port":12345,"ProxyKey":"abcd","Mode":"KCP","ClientID":1,"ServerID":2}';
    const info = parseTsshdOutput(output);
    expect(info).not.toBeNull();
    expect(info!.Port).toBe(12345);
  });

  it('returns null for garbage output', () => {
    expect(parseTsshdOutput('not tsshd output')).toBeNull();
    expect(parseTsshdOutput('')).toBeNull();
  });

  it('returns null when JSON is missing required fields', () => {
    expect(parseTsshdOutput('{"Mode":"KCP"}')).toBeNull();
    expect(parseTsshdOutput('{"Port":0,"ProxyKey":"a","Mode":"KCP","ClientID":0,"ServerID":0}')).toBeNull();
  });
});
