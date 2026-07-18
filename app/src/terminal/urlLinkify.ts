/**
 * Wrap plain-text URLs in OSC 8 hyperlinks so Restty/Ghostty-vt can hover and
 * open them. Restty already clicks OSC 8 cells; it does not regex-match bare
 * `https://…` the way xterm's WebLinksAddon does.
 *
 * Runs on the display path only (server → renderer). Escape sequences, existing
 * OSC 8 spans, and incomplete trailing URL prefixes are left alone / carried.
 */

/** Prefer https/http/mailto; also promote bare www. to https. */
const URL_RE =
  /(?:https?:\/\/|mailto:)[^\s<>'"()\[\]{}]+|www\.[^\s<>'"()\[\]{}]+/gi;
/** Trailing punctuation that is usually prose, not part of the URL. */
const TRAILING_PUNCT = /[),.;:!?]+$/;

const SCHEME_PREFIXES = ['https://', 'http://', 'mailto:', 'www.'] as const;
/** Partial prefixes we must hold across chunk boundaries. */
const PARTIAL_SCHEMES =
  /^(?:h|ht|htt|http|https|https?:|https?:\/|https?:\/\/|m|ma|mai|mail|mailt|mailto|mailto:|w|ww|www|www\.)$/i;

function osc8Wrap(href: string, text: string): string {
  return `\x1b]8;;${href}\x07${text}\x1b]8;;\x07`;
}

function trimUrlMatch(raw: string): { href: string; text: string; punct: string } | null {
  const punct = raw.match(TRAILING_PUNCT)?.[0] ?? '';
  const text = punct ? raw.slice(0, -punct.length) : raw;
  if (!text) return null;

  let href = text;
  if (/^www\./i.test(text)) href = `https://${text}`;
  if (!/^(https?:\/\/|mailto:)/i.test(href)) return null;
  if (href.length > 2048) return null;
  return { href, text, punct };
}

function linkifyGround(text: string): string {
  if (!text) return text;
  URL_RE.lastIndex = 0;
  return text.replace(URL_RE, (raw) => {
    const trimmed = trimUrlMatch(raw);
    if (!trimmed) return raw;
    return osc8Wrap(trimmed.href, trimmed.text) + trimmed.punct;
  });
}

/** True when `text` could still grow into a URL match if more bytes arrive. */
function isUrlPrefix(text: string): boolean {
  if (!text) return false;
  if (PARTIAL_SCHEMES.test(text)) return true;
  const lower = text.toLowerCase();
  for (const scheme of SCHEME_PREFIXES) {
    if (!lower.startsWith(scheme)) continue;
    // Scheme present — hold while still on URL charset (no whitespace/delims).
    return !/[\s<>'"()\[\]{}]/.test(text.slice(scheme.length));
  }
  return false;
}

/**
 * Find the longest suffix of `text` that might be an incomplete URL prefix.
 * Used as stream carry so `https://exa` + `mple.com` still linkifies.
 */
function urlPrefixCarry(text: string): string {
  const max = Math.min(text.length, 256);
  for (let start = text.length - max; start < text.length; start += 1) {
    if (start < 0) continue;
    const suffix = text.slice(start);
    if (isUrlPrefix(suffix)) return suffix;
  }
  return '';
}

type EscKind = 'none' | 'csi' | 'osc' | 'string';

/**
 * Streaming linkifier: feed PTY output chunks, get display bytes with OSC 8
 * wraps around plain URLs.
 */
export class UrlLinkifier {
  private carry = '';
  /** After OSC 8 open with a non-empty URI until the matching close. */
  private insideOsc8 = false;

  reset(): void {
    this.carry = '';
    this.insideOsc8 = false;
  }

  ingest(chunk: string): string {
    if (!chunk && !this.carry) return '';
    const input = this.carry + chunk;
    this.carry = '';
    let out = '';
    let ground = '';
    let esc = '';
    let i = 0;
    let kind: EscKind = 'none';

    /**
     * @param mode `end` may hold a trailing URL prefix for the next chunk;
     * `esc` must not — URLs cannot contain ESC, so finalize before the sequence.
     */
    const flushGround = (mode: 'end' | 'esc' | 'final') => {
      if (!ground) return;
      if (this.insideOsc8) {
        out += ground;
        ground = '';
        return;
      }
      if (mode === 'end') {
        const hold = urlPrefixCarry(ground);
        if (hold) {
          out += linkifyGround(ground.slice(0, ground.length - hold.length));
          this.carry = hold;
          ground = '';
          return;
        }
      }
      out += linkifyGround(ground);
      ground = '';
    };

    const closeOsc = () => {
      // OSC body is ESC ] … BEL/ST, stored in `esc`.
      if (esc.startsWith('\x1b]8;')) {
        // \x1b]8;params;uri BEL
        const body = esc.slice(3); // drop ESC ]
        const firstSemi = body.indexOf(';');
        const secondSemi = firstSemi >= 0 ? body.indexOf(';', firstSemi + 1) : -1;
        if (secondSemi >= 0) {
          let uri = body.slice(secondSemi + 1);
          if (uri.endsWith('\x07')) uri = uri.slice(0, -1);
          else if (uri.endsWith('\x1b\\')) uri = uri.slice(0, -2);
          this.insideOsc8 = uri.length > 0;
        }
      }
      out += esc;
      esc = '';
      kind = 'none';
    };

    while (i < input.length) {
      const ch = input[i];

      if (kind === 'none') {
        if (ch === '\x1b') {
          flushGround('esc');
          if (i + 1 >= input.length) {
            this.carry = (this.carry || '') + input.slice(i);
            return out;
          }
          const next = input[i + 1];
          esc = ch + next;
          i += 2;
          if (next === '[') {
            kind = 'csi';
            continue;
          }
          if (next === ']') {
            kind = 'osc';
            continue;
          }
          if (next === 'P' || next === 'X' || next === '^' || next === '_') {
            kind = 'string';
            continue;
          }
          // Two-byte ESC sequence — emit and stay in ground.
          out += esc;
          esc = '';
          continue;
        }
        ground += ch;
        i += 1;
        continue;
      }

      // Escape body — copy verbatim; never linkify inside.
      esc += ch;
      i += 1;

      if (kind === 'csi') {
        if (ch >= '@' && ch <= '~') {
          out += esc;
          esc = '';
          kind = 'none';
        }
        continue;
      }

      if (kind === 'osc') {
        if (ch === '\x07') {
          closeOsc();
          continue;
        }
        if (ch === '\\' && esc.endsWith('\x1b\\')) {
          closeOsc();
        }
        continue;
      }

      if (kind === 'string') {
        if (ch === '\x07' || (ch === '\\' && esc.endsWith('\x1b\\'))) {
          out += esc;
          esc = '';
          kind = 'none';
        }
      }
    }

    // Incomplete escape → carry it.
    if (kind !== 'none') {
      this.carry = (this.carry || '') + esc;
      return out;
    }

    flushGround('end');
    return out;
  }

  /** Finish stream: flush any held URL prefix (linkify if complete). */
  flush(): string {
    if (!this.carry) return '';
    const left = this.carry;
    this.carry = '';
    if (this.insideOsc8 || left.startsWith('\x1b')) return left;
    return linkifyGround(left);
  }
}

/** Stateless helper for tests / one-shot strings. */
export function linkifyUrls(text: string): string {
  const linkifier = new UrlLinkifier();
  return linkifier.ingest(text) + linkifier.flush();
}
