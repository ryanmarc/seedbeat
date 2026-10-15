import { describe, expect, it } from 'vitest';
import { getBar } from '../bars';
import { buildChart } from '../chart';
import { MOOD_IDS } from '../moods';
import { makeSong } from '../song';

/**
 * Freezes the authored song so a melody or progression edit is a deliberate, reviewed change.
 * Update with `pnpm vitest run --project unit packages/core/src/curated -u` after tuning.
 */
describe('friday snapshot', () => {
  for (const mood of MOOD_IDS) {
    it(`${mood}: skeleton, first chorus lead, chart sizes`, () => {
      const s = makeSong('friday', mood, 'song');
      const chorus = s.sections.find((x) => x.type === 'chorus')!.start;
      const lead = [0, 1, 2, 3].map((k) =>
        getBar(s, chorus + k)
          .ev.filter((e) => e.type === 'lead')
          .map((e) => `${e.step}:${e.midi}:${e.len}`)
          .join(' '),
      );
      const charts = [0, 1, 2, 3].map((d) => {
        const c = buildChart(s, d as 0 | 1 | 2 | 3).notes;
        return { notes: c.length, holds: c.filter((n) => n.end > 0).length };
      });
      expect({
        bpm: s.bpm,
        scale: s.scaleName,
        root: s.root,
        name: s.name,
        total: s.total,
        progs: s.progs,
        lead,
        charts,
      }).toMatchSnapshot();
    });
  }
});
