import { useEffect } from 'preact/hooks';
import { MOODS } from '@seedbeat/core';
import { screen, selection, settings, toast } from '../app/state';
import { CalibrationScreen } from './CalibrationScreen';
import { Hud } from './Hud';
import { PauseScreen } from './PauseScreen';
import { ProfileScreen } from './ProfileScreen';
import { ResultsScreen } from './ResultsScreen';
import { SelectScreen } from './SelectScreen';
import { SettingsScreen } from './SettingsScreen';
import { TitleScreen } from './TitleScreen';

export function App() {
  const sc = screen.value;
  // Re-tint the chrome per mood (DESIGN.md §1) and apply the battery-saver class.
  useEffect(() => {
    const p = MOODS[selection.value.mood].palette;
    const r = document.documentElement.style;
    r.setProperty('--accent', p.accent);
    r.setProperty('--accent2', p.accent2);
  }, [selection.value.mood]);
  useEffect(() => {
    document.body.classList.toggle('lowfx', settings.value.quality === 'battery');
  }, [settings.value.quality]);
  return (
    <>
      {sc === 'title' && <TitleScreen />}
      {sc === 'select' && <SelectScreen />}
      {(sc === 'playing' || sc === 'paused') && <Hud />}
      {sc === 'paused' && <PauseScreen />}
      {sc === 'results' && <ResultsScreen />}
      {sc === 'settings' && <SettingsScreen />}
      {sc === 'calibration' && <CalibrationScreen />}
      {sc === 'profile' && <ProfileScreen />}
      {toast.value && (
        <div class="toast" role="status">
          {toast.value}
        </div>
      )}
    </>
  );
}
