import { describe, expect, it, vi } from 'vitest';
import { shareWith, type SharePayload } from './share';

const file = { name: 'card.png', type: 'image/png' } as unknown as File;
const payload: SharePayload = {
  title: 'Seedbeat',
  text: 'Mega Castle: grade S',
  url: 'https://example.test/#s=cobalt-42',
  file,
};

describe('shareWith', () => {
  it('shares the card with the link in the text where files are supported', async () => {
    const share = vi.fn(async () => {});
    const download = vi.fn();
    const out = await shareWith({ share, canShare: () => true }, payload, download);
    expect(out).toBe('shared');
    expect(share).toHaveBeenCalledWith({
      files: [file],
      title: 'Seedbeat',
      text: 'Mega Castle: grade S https://example.test/#s=cobalt-42',
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('shares the link alone when files are not shareable', async () => {
    const share = vi.fn(async () => {});
    const out = await shareWith({ share, canShare: () => false }, payload, vi.fn());
    expect(out).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Seedbeat', text: payload.text, url: payload.url });
  });

  it('reports a cancelled share without falling back', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const writeText = vi.fn(async () => {});
    const out = await shareWith(
      { share: () => Promise.reject(abort), clipboard: { writeText } },
      payload,
      vi.fn(),
    );
    expect(out).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to copy and download without Web Share, or when it refuses', async () => {
    const writeText = vi.fn(async () => {});
    const download = vi.fn();
    expect(await shareWith({ clipboard: { writeText } }, payload, download)).toBe(
      'copied+downloaded',
    );
    expect(writeText).toHaveBeenCalledWith(payload.url);
    expect(download).toHaveBeenCalledWith(file);
    const refused = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    expect(
      await shareWith(
        { share: () => Promise.reject(refused), clipboard: { writeText } },
        { ...payload, file: null },
        download,
      ),
    ).toBe('copied');
  });

  it('fails cleanly with no share and no clipboard', async () => {
    expect(await shareWith({}, { ...payload, file: null }, vi.fn())).toBe('failed');
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    expect(await shareWith({ clipboard: { writeText } }, payload, vi.fn())).toBe('failed');
  });
});
