import { useState } from 'preact/hooks';
import { controller } from '../app/controller';
import { settings, showToast } from '../app/state';
import type { FrameCap, LanePalette, QualityMode } from '../save/schema';
import { Choice, Range, Screen, Toggle } from './components';

const KEY_LABEL = (code: string): string =>
  code
    .replace(/^Key/, '')
    .replace(/^Arrow/, '→ ')
    .replace(/^Digit/, '');

export function SettingsScreen() {
  const s = settings.value;
  const set = (patch: Partial<typeof s>): void => controller.store.setSettings(patch);
  const [listening, setListening] = useState<number | null>(null);
  const captureKey = (lane: number): void => {
    setListening(lane);
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      if (e.code !== 'Escape') controller.setKey(lane, e.code);
      setListening(null);
      window.removeEventListener('keydown', onKey, true);
    };
    window.addEventListener('keydown', onKey, true);
  };
  const importSave = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        controller.store.importJSON(await f.text());
        showToast('Save imported.');
      } catch {
        showToast('That file is not a Seedbeat save.');
      }
    };
    input.click();
  };
  const exportSave = (): void => {
    const blob = new Blob([controller.store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'seedbeat-save.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <Screen id="settings" title="Settings">
      <h3>Gameplay</h3>
      <Range
        label="Note speed"
        desc="Scales how long notes are on screen"
        value={s.noteSpeed}
        min={0.75}
        max={2}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(noteSpeed) => set({ noteSpeed })}
      />
      <Toggle
        label="No-fail"
        desc="Health never ends the run; scores are flagged"
        checked={s.noFail}
        onChange={(noFail) => set({ noFail })}
      />
      <Toggle
        label="High hit line (touch)"
        desc="Raises the hit line further above the pads"
        checked={s.hitLineHigh}
        onChange={(hitLineHigh) => set({ hitLineHigh })}
      />
      <Choice<LanePalette>
        label="Lane colours"
        value={s.lanePalette}
        options={[
          { value: 'mood', label: 'Mood' },
          { value: 'cb-a', label: 'CB A' },
          { value: 'cb-b', label: 'CB B' },
          { value: 'high-contrast', label: 'High' },
        ]}
        onChange={(lanePalette) => set({ lanePalette })}
      />
      <Toggle
        label="Show early / late"
        checked={s.showEarlyLate}
        onChange={(showEarlyLate) => set({ showEarlyLate })}
      />
      <Choice
        label="Judgement text size"
        value={s.judgementTextSize}
        options={[
          { value: 'small', label: 'S' },
          { value: 'normal', label: 'M' },
          { value: 'large', label: 'L' },
        ]}
        onChange={(judgementTextSize) => set({ judgementTextSize })}
      />
      <h3>Timing</h3>
      <Range
        label="Audio offset"
        desc="From calibration; shifts judgement and drawing"
        value={s.audioOffsetMs}
        min={-200}
        max={200}
        step={1}
        format={(v) => `${v} ms`}
        onChange={(audioOffsetMs) => set({ audioOffsetMs })}
      />
      <Range
        label="Visual offset"
        desc="Shifts drawing only"
        value={s.visualOffsetMs}
        min={-100}
        max={100}
        step={1}
        format={(v) => `${v} ms`}
        onChange={(visualOffsetMs) => set({ visualOffsetMs })}
      />
      <div class="setting">
        <div class="name">Calibration</div>
        <button
          type="button"
          class="btn small"
          onClick={() => controller.openOverlay('calibration')}
        >
          Run calibration
        </button>
      </div>
      <h3>Audio</h3>
      <Range
        label="Master volume"
        value={s.masterVolume}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(masterVolume) => set({ masterVolume })}
      />
      <Range
        label="Music volume"
        value={s.musicVolume}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(musicVolume) => set({ musicVolume })}
      />
      <Toggle
        label="Hit sounds"
        desc="A short click per judgement"
        checked={s.hitSounds}
        onChange={(hitSounds) => set({ hitSounds })}
      />
      <Range
        label="Hit sound volume"
        value={s.hitVolume}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(hitVolume) => set({ hitVolume })}
      />
      <Toggle
        label="Haptics"
        desc="Light tick on hit, stronger on miss (mobile)"
        checked={s.haptics}
        onChange={(haptics) => set({ haptics })}
      />
      <h3>Controls</h3>
      <div class="setting">
        <div>
          <div class="name">Lane keys</div>
          <div class="desc">
            Click a key, then press the new one. Arrows always work. Gamepad face buttons and
            shoulders map to lanes.
          </div>
        </div>
        <div class="btnrow">
          {s.keys.map((k, lane) => (
            <button
              key={lane}
              type="button"
              class="btn small keycap"
              aria-pressed={listening === lane}
              aria-label={`Lane ${lane + 1} key: ${KEY_LABEL(k)}`}
              onClick={() => captureKey(lane)}
            >
              {listening === lane ? '…' : KEY_LABEL(k)}
            </button>
          ))}
        </div>
      </div>
      <h3>Display</h3>
      <Choice
        label="Reduced motion"
        desc="No strobe, fewer particles, static chevrons"
        value={s.reducedMotion}
        options={[
          { value: 'system', label: 'System' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
        onChange={(reducedMotion) => set({ reducedMotion })}
      />
      <Choice<QualityMode>
        label="Quality"
        value={s.quality}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'high', label: 'High' },
          { value: 'battery', label: 'Battery' },
        ]}
        onChange={(quality) => set({ quality })}
      />
      <Choice<FrameCap>
        label="Frame-rate cap"
        value={s.frameCap}
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 60, label: '60' },
          { value: 30, label: '30' },
        ]}
        onChange={(frameCap) => set({ frameCap })}
      />
      <Toggle
        label="Diagnostics overlay"
        desc="fps, late frames, tier, clock (also F3)"
        checked={s.diagnostics}
        onChange={(diagnostics) => controller.setDiagnostics(diagnostics)}
      />
      <h3>Data</h3>
      <div class="btnrow">
        <button type="button" class="btn" onClick={exportSave}>
          Export save
        </button>
        <button type="button" class="btn" onClick={importSave}>
          Import save
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            if (confirm('Reset all progress and settings?')) controller.store.reset();
          }}
        >
          Reset progress
        </button>
      </div>
      <div class="btnrow">
        <button type="button" class="btn primary" onClick={() => controller.closeOverlay()}>
          DONE
        </button>
      </div>
    </Screen>
  );
}
