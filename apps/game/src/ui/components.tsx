import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/** A full-screen scroll container with one centred panel; focuses its heading on mount (SR/keyboard). */
export function Screen({
  title,
  children,
  id,
  lede,
}: {
  title: string;
  children: ComponentChildren;
  id: string;
  lede?: string;
}) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    h.current?.focus();
  }, []);
  return (
    <section class="screen" id={id} aria-labelledby={`${id}-title`}>
      <div class="panel" role="group">
        <header class="brand">
          <h2 id={`${id}-title`} ref={h} tabIndex={-1}>
            {title}
          </h2>
          {lede && <p class="lede">{lede}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div class="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div class="setting">
      <div>
        <div class="name">{label}</div>
        {desc && <div class="desc">{desc}</div>}
      </div>
      <button
        type="button"
        class="toggle"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function Range({
  label,
  desc,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  desc?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div class="setting">
      <div>
        <div class="name">{label}</div>
        {desc && <div class="desc">{desc}</div>}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span class="sr-only">{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        />
        <output style={{ fontFamily: 'var(--font-num)', minWidth: 56, textAlign: 'right' }}>
          {format(value)}
        </output>
      </label>
    </div>
  );
}

export function Choice<T extends string | number>({
  label,
  desc,
  value,
  options,
  onChange,
}: {
  label: string;
  desc?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="setting">
      <div>
        <div class="name">{label}</div>
        {desc && <div class="desc">{desc}</div>}
      </div>
      <div class="seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
