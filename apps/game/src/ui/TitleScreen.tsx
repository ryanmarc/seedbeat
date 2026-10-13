import { useEffect, useRef } from 'preact/hooks';
import { controller } from '../app/controller';
import { screen } from '../app/state';

export function TitleScreen() {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h.current?.focus();
  }, []);
  return (
    <section class="screen" id="title" aria-labelledby="title-h1">
      <div class="panel">
        <header class="brand">
          <h1 id="title-h1" ref={h} tabIndex={-1}>
            SEEDBEAT
          </h1>
          <p class="lede">
            Type a seed and get a song. The chart is written from the melody, so every note you hit
            is a note you hear.
          </p>
        </header>
        <div class="menurow">
          <button type="button" class="btn primary" onClick={() => (screen.value = 'select')}>
            PLAY
          </button>
          <button type="button" class="btn" onClick={() => controller.openOverlay('profile')}>
            Profile
          </button>
          <button type="button" class="btn" onClick={() => controller.openOverlay('settings')}>
            Settings
          </button>
        </div>
        <p class="hint">Daily and Practice modes arrive in the next milestone.</p>
      </div>
    </section>
  );
}
