import { get, set } from 'idb-keyval';
import { defaultSave, migrate, type Best, type Save, type Settings } from './schema';

const KEY = 'seedbeat:save';

/** Minimal key-value backend so tests run in Node without IndexedDB. */
export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export const idbKV: KV = {
  get: (k) => get(k),
  set: (k, v) => set(k, v),
};

export class MemoryKV implements KV {
  private readonly m = new Map<string, unknown>();
  async get(k: string): Promise<unknown> {
    return this.m.get(k);
  }
  async set(k: string, v: unknown): Promise<void> {
    this.m.set(k, structuredClone(v));
  }
}

/**
 * Holds the save in memory and writes it through on every change (debounced to one write per
 * tick). Reads happen once at boot. Nothing here runs inside the frame loop.
 */
export class SaveStore {
  private data: Save = defaultSave();
  private writing: Promise<void> | null = null;
  private dirty = false;
  private readonly listeners = new Set<(s: Save) => void>();

  constructor(private readonly kv: KV = idbKV) {}

  get save(): Save {
    return this.data;
  }

  async load(): Promise<Save> {
    try {
      this.data = migrate(await this.kv.get(KEY));
    } catch {
      this.data = defaultSave();
    }
    this.emit();
    return this.data;
  }

  subscribe(fn: (s: Save) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.data);
  }

  /** Apply a change and persist. */
  update(fn: (s: Save) => void): void {
    fn(this.data);
    this.emit();
    this.dirty = true;
    this.writing ??= Promise.resolve().then(async () => {
      this.writing = null;
      if (!this.dirty) return;
      this.dirty = false;
      await this.kv.set(KEY, this.data);
    });
  }

  /** Resolves after pending writes. */
  async flush(): Promise<void> {
    await this.writing;
    if (this.dirty) {
      this.dirty = false;
      await this.kv.set(KEY, this.data);
    }
  }

  setSettings(patch: Partial<Settings>): void {
    this.update((s) => Object.assign(s.settings, patch));
  }

  /** Record a result; returns true when it is a new best for the key. */
  recordBest(key: string, best: Best): boolean {
    const prev = this.data.bests[key];
    const isBest = !prev || best.score > prev.score;
    this.update((s) => {
      if (isBest) s.bests[key] = best;
      else if (prev && best.stars > prev.stars) prev.stars = best.stars;
    });
    return isBest;
  }

  addRecent(seed: string): void {
    this.update((s) => {
      s.recents = [seed, ...s.recents.filter((x) => x !== seed)].slice(0, 20);
    });
  }

  toggleFavourite(seed: string): void {
    this.update((s) => {
      s.favourites = s.favourites.includes(seed)
        ? s.favourites.filter((x) => x !== seed)
        : [...s.favourites, seed];
    });
  }

  exportJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /** Replace the save with imported JSON (migrated). Throws on invalid JSON. */
  importJSON(json: string): void {
    const parsed = JSON.parse(json) as unknown;
    this.update((s) => Object.assign(s, migrate(parsed)));
  }

  reset(): void {
    this.update((s) => Object.assign(s, defaultSave()));
  }
}
