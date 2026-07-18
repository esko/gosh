/**
 * Fixed Controlled Frame executeScript payloads for browser automation.
 * These helpers are internal implementation details — agents never receive a
 * generic `evaluate` capability.
 */

import {
  DEFAULT_SNAPSHOT_MAX_BYTES,
  DEFAULT_SNAPSHOT_MAX_NODES,
  type BrowserSnapshotNode,
} from './browserAutomationTypes';

export type SnapshotScriptOptions = {
  generation: number;
  maxNodes?: number;
  maxBytes?: number;
};

export type SnapshotScriptPayload = {
  generation: number;
  url: string;
  title: string;
  nodes: BrowserSnapshotNode[];
  truncated: boolean;
  byteLength: number;
};

export type InteractionScriptPayload = {
  generation: number;
  ref: string;
  action: 'click' | 'type' | 'press';
  text?: string;
  key?: string;
  clear?: boolean;
};

export type QueryScriptPayload = {
  generation: number;
  role?: string;
  name?: string;
  text?: string;
  selector?: string;
};

export type WaitScriptPayload = {
  generation: number;
  selector?: string;
  text?: string;
};

const SNAPSHOT_HELPER = String.raw`
(function __goshSnapshot(opts) {
  const MAX_NODES = opts.maxNodes;
  const MAX_BYTES = opts.maxBytes;
  const generation = opts.generation;
  const REDACTED = '[redacted]';

  function isSecretInput(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return true;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return ac.includes('password') || ac.includes('cc-') || ac.includes('one-time-code');
  }

  function trimText(value, max) {
    if (!value) return '';
    const t = value.replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : t.slice(0, max) + '…';
  }

  function accessibleName(el) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map((id) => {
        const node = document.getElementById(id);
        return node ? trimText(node.textContent || '', 120) : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return trimText(aria, 160);
    if (el.id) {
      const safeId = el.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const label = document.querySelector('label[for="' + safeId + '"]');
      if (label) return trimText(label.textContent || '', 160);
    }
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return trimText(placeholder, 160);
    const title = el.getAttribute('title');
    if (title) return trimText(title, 160);
    const alt = el.getAttribute('alt');
    if (alt) return trimText(alt, 160);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      return trimText(el.getAttribute('name') || '', 80) || undefined;
    }
    return trimText(el.textContent || '', 160) || undefined;
  }

  function implicitRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'image';
    if (tag === 'summary') return 'button';
    return tag;
  }

  function isInteresting(el) {
    if (!(el instanceof Element)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.hasAttribute('href')) return true;
    if (tag === 'button') return true;
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (tag === 'summary') return true;
    if (el.hasAttribute('role')) return true;
    if (/^h[1-6]$/.test(tag)) return true;
    return false;
  }

  function clearOldRefs() {
    for (const el of document.querySelectorAll('[data-gosh-agent-ref]')) {
      el.removeAttribute('data-gosh-agent-ref');
      el.removeAttribute('data-gosh-agent-gen');
    }
  }

  clearOldRefs();

  const nodes = [];
  let truncated = false;
  let counter = 0;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
  let current = walker.currentNode;
  while (current) {
    const el = current;
    if (isInteresting(el)) {
      counter += 1;
      const ref = 'e' + counter;
      el.setAttribute('data-gosh-agent-ref', ref);
      el.setAttribute('data-gosh-agent-gen', String(generation));
      const role = implicitRole(el);
      const node = { ref, role, tag: el.tagName.toLowerCase() };
      const name = accessibleName(el);
      if (name) node.name = name;
      const text = trimText(el.textContent || '', 200);
      if (text && text !== name) node.text = text;
      if (el.tagName === 'A') {
        const href = el.getAttribute('href');
        if (href) node.href = href;
      }
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const value = el.value;
        node.value = isSecretInput(el) ? REDACTED : trimText(value || '', 200);
      }
      if (el.tagName === 'INPUT') {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio') node.checked = el.checked;
      }
      if (el.hasAttribute('disabled') || el.disabled) node.disabled = true;
      if (el.hasAttribute('aria-selected')) node.selected = el.getAttribute('aria-selected') === 'true';
      if (el.hasAttribute('aria-expanded')) node.expanded = el.getAttribute('aria-expanded') === 'true';
      nodes.push(node);
      if (nodes.length >= MAX_NODES) {
        truncated = true;
        break;
      }
    }
    current = walker.nextNode();
  }

  let payload = {
    generation,
    url: location.href,
    title: document.title || '',
    nodes,
    truncated,
    byteLength: 0,
  };
  let serialized = JSON.stringify(payload);
  while (serialized.length > MAX_BYTES && nodes.length > 1) {
    truncated = true;
    nodes.pop();
    payload = { ...payload, nodes, truncated };
    serialized = JSON.stringify(payload);
  }
  payload.byteLength = serialized.length;
  return payload;
})
`;

const INTERACTION_HELPER = String.raw`
(function __goshInteract(payload) {
  const el = document.querySelector('[data-gosh-agent-ref="' + payload.ref + '"]');
  if (!el) return { ok: false, error: 'stale-ref', message: 'Element ref not found' };
  if (el.getAttribute('data-gosh-agent-gen') !== String(payload.generation)) {
    return { ok: false, error: 'stale-ref', message: 'Element ref was invalidated' };
  }
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
    return { ok: false, error: 'disabled', message: 'Element is disabled' };
  }
  if (payload.action === 'click') {
    el.focus();
    el.click();
    return { ok: true };
  }
  if (payload.action === 'type') {
    const text = payload.text ?? '';
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
      return { ok: false, error: 'invalid-target', message: 'type requires an input or textarea' };
    }
    el.focus();
    if (payload.clear) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.value = payload.clear ? text : (el.value + text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }
  if (payload.action === 'press') {
    const key = payload.key || 'Enter';
    const lower = key.length === 1 ? key : key[0].toUpperCase() + key.slice(1).toLowerCase();
    const codeMap = {
      Enter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace',
      ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
      ' ': 'Space',
    };
    const code = codeMap[key] || codeMap[lower] || key;
    const eventInit = { key, code, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    if (key === 'Enter' && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      el.form?.requestSubmit?.();
    }
    return { ok: true };
  }
  return { ok: false, error: 'unsupported', message: 'Unknown action' };
})
`;

const QUERY_HELPER = String.raw`
(function __goshQuery(payload) {
  const matches = [];
  const selector = payload.selector;
  const role = payload.role ? payload.role.toLowerCase() : undefined;
  const nameNeedle = payload.name ? payload.name.toLowerCase() : undefined;
  const textNeedle = payload.text ? payload.text.toLowerCase() : undefined;
  const candidates = selector
    ? Array.from(document.querySelectorAll(selector))
    : Array.from(document.querySelectorAll('[data-gosh-agent-ref]'));
  for (const el of candidates) {
    if (!(el instanceof Element)) continue;
    const ref = el.getAttribute('data-gosh-agent-ref');
    if (!ref) continue;
    if (el.getAttribute('data-gosh-agent-gen') !== String(payload.generation)) continue;
    const tag = el.tagName.toLowerCase();
    let elRole = (el.getAttribute('role') || '').toLowerCase();
    if (!elRole) {
      if (tag === 'a') elRole = 'link';
      else if (tag === 'button') elRole = 'button';
      else if (tag === 'input' || tag === 'textarea') elRole = 'textbox';
      else elRole = tag;
    }
    if (role && elRole !== role) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
    if (nameNeedle && !label.includes(nameNeedle)) continue;
    if (textNeedle && !(el.textContent || '').toLowerCase().includes(textNeedle)) continue;
    matches.push({
      ref,
      role: elRole,
      name: el.getAttribute('aria-label') || undefined,
      text: (el.textContent || '').trim().slice(0, 200) || undefined,
    });
    if (matches.length >= 50) break;
  }
  return { generation: payload.generation, matches };
})
`;

const WAIT_HELPER = String.raw`
(function __goshWait(payload) {
  if (payload.selector) {
    const el = document.querySelector(payload.selector);
    return { found: Boolean(el) };
  }
  if (payload.text) {
    const body = document.body ? document.body.innerText : '';
    return { found: body.includes(payload.text) };
  }
  return { found: document.readyState === 'complete' };
})
`;

function embedPayload(helper: string, payload: unknown): string {
  return `(${helper})(${JSON.stringify(payload)})`;
}

export function buildSnapshotScript(options: SnapshotScriptOptions): string {
  return embedPayload(SNAPSHOT_HELPER, {
    generation: options.generation,
    maxNodes: options.maxNodes ?? DEFAULT_SNAPSHOT_MAX_NODES,
    maxBytes: options.maxBytes ?? DEFAULT_SNAPSHOT_MAX_BYTES,
  });
}

export function buildInteractionScript(payload: InteractionScriptPayload): string {
  return embedPayload(INTERACTION_HELPER, payload);
}

export function buildQueryScript(payload: QueryScriptPayload): string {
  return embedPayload(QUERY_HELPER, payload);
}

export function buildWaitScript(payload: WaitScriptPayload): string {
  return embedPayload(WAIT_HELPER, payload);
}

export function parseSnapshotPayload(raw: unknown): SnapshotScriptPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Snapshot script returned invalid payload');
  }
  const payload = raw as SnapshotScriptPayload;
  if (!Array.isArray(payload.nodes)) {
    throw new Error('Snapshot script returned invalid nodes');
  }
  return payload;
}

export type InteractionScriptResult =
  | { ok: true }
  | { ok: false; error: string; message?: string };

export function parseInteractionResult(raw: unknown): InteractionScriptResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'invalid-result', message: 'Interaction script returned invalid payload' };
  }
  const result = raw as InteractionScriptResult;
  if (result.ok) return { ok: true };
  return {
    ok: false,
    error: result.error || 'failed',
    message: result.message,
  };
}

export function parseQueryPayload(raw: unknown): { generation: number; matches: BrowserSnapshotNode[] } {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Query script returned invalid payload');
  }
  const payload = raw as { generation?: number; matches?: unknown };
  return {
    generation: payload.generation ?? 0,
    matches: Array.isArray(payload.matches) ? (payload.matches as BrowserSnapshotNode[]) : [],
  };
}

export function parseWaitPayload(raw: unknown): { found: boolean } {
  if (!raw || typeof raw !== 'object') return { found: false };
  return { found: Boolean((raw as { found?: boolean }).found) };
}
