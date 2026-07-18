import { describe, expect, it } from 'vitest';
import { UrlLinkifier, linkifyUrls } from './urlLinkify';

function wrap(href: string, text = href): string {
  return `\x1b]8;;${href}\x07${text}\x1b]8;;\x07`;
}

describe('linkifyUrls', () => {
  it('wraps https URLs in OSC 8', () => {
    expect(linkifyUrls('see https://example.com/path now')).toBe(
      `see ${wrap('https://example.com/path')} now`,
    );
  });

  it('wraps http and mailto', () => {
    expect(linkifyUrls('http://a.test mailto:a@b.c')).toBe(
      `${wrap('http://a.test')} ${wrap('mailto:a@b.c')}`,
    );
  });

  it('promotes bare www. to https href while keeping visible text', () => {
    expect(linkifyUrls('www.example.com')).toBe(wrap('https://www.example.com', 'www.example.com'));
  });

  it('strips trailing prose punctuation from the link target', () => {
    expect(linkifyUrls('go https://example.com.')).toBe(`go ${wrap('https://example.com')}.`);
    expect(linkifyUrls('go https://example.com,')).toBe(`go ${wrap('https://example.com')},`);
  });

  it('leaves non-URL text alone', () => {
    expect(linkifyUrls('no links here')).toBe('no links here');
  });

  it('does not re-wrap text already inside an OSC 8 span', () => {
    const already = wrap('https://example.com');
    expect(linkifyUrls(`x ${already} y`)).toBe(`x ${already} y`);
  });

  it('passes CSI/SGR through without corrupting it', () => {
    const colored = '\x1b[31mhttps://example.com\x1b[0m';
    expect(linkifyUrls(colored)).toBe(`\x1b[31m${wrap('https://example.com')}\x1b[0m`);
  });

  it('does not linkify URL-looking bytes inside OSC payloads', () => {
    const osc = '\x1b]0;https://title.example\x07';
    expect(linkifyUrls(osc + 'ok')).toBe(osc + 'ok');
  });
});

describe('UrlLinkifier streaming', () => {
  it('reassembles a URL split across chunks', () => {
    const linkifier = new UrlLinkifier();
    const a = linkifier.ingest('see https://exa');
    const b = linkifier.ingest('mple.com/x!');
    const c = linkifier.flush();
    expect(a + b + c).toBe(`see ${wrap('https://example.com/x')}!`);
  });

  it('reassembles a scheme split across chunks', () => {
    const linkifier = new UrlLinkifier();
    expect(linkifier.ingest('htt')).toBe('');
    // Complete URLs are held until a delimiter (or flush) so `/path` can still append.
    expect(linkifier.ingest('ps://example.com\n')).toBe(`${wrap('https://example.com')}\n`);
    expect(linkifier.flush()).toBe('');
  });

  it('holds an incomplete escape sequence across chunks', () => {
    const linkifier = new UrlLinkifier();
    expect(linkifier.ingest('hi\x1b[3')).toBe('hi');
    expect(linkifier.ingest('1mhttps://a.test\x1b[0m')).toBe(
      `\x1b[31m${wrap('https://a.test')}\x1b[0m`,
    );
  });
});
