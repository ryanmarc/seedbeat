import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { render } from 'preact-render-to-string';
import { Title } from './Title';

describe('Title', () => {
  it('renders the game name and generator version', () => {
    const html = render(h(Title, { generatorVersion: 1 }));
    expect(html).toContain('SEEDBEAT');
    expect(html).toContain('Generator v1');
  });
});
