import { afterEach, describe, expect, it, vi } from 'vitest';

const addMessages = vi.fn();
const findAndLoadMessages = vi.fn();

vi.mock('./upstreamUrls', () => ({
  upstreamImport: vi.fn(async () => ({
    hterm: {
      initPromise: Promise.resolve(),
      messageManager: {
        useCrlf: false,
        addMessages,
        findAndLoadMessages,
      },
    },
  })),
}));

describe('loadNasshMessages', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    addMessages.mockReset();
    findAndLoadMessages.mockReset();
  });

  it('loads only the packaged en locale and skips the navigator.languages cascade', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ PLUGIN_LOADING: { message: 'Loading…' } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadNasshMessages } = await import('./nasshLocale');
    await loadNasshMessages();
    await loadNasshMessages(); // cached

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/upstream/nassh/_locales/en/messages.json');
    expect(addMessages).toHaveBeenCalledOnce();
    expect(findAndLoadMessages).not.toHaveBeenCalled();
  });
});
