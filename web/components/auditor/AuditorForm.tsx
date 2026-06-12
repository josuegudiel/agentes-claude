'use client';

import { useState } from 'react';
import type { AuditorRequest } from '../../lib/auditor-types';

interface Props {
  onSubmit: (params: AuditorRequest) => void;
  disabled: boolean;
}

const INPUT_CLASSES =
  'w-full rounded-xl border border-ink-700/70 bg-ink-950/60 px-3.5 py-2.5 text-sm text-ink-100 ' +
  'placeholder-ink-600 outline-none transition duration-200 ' +
  'focus:border-emerald-400/60 focus:ring-4 focus:ring-emerald-500/10 hover:border-ink-600';

const LABEL_CLASSES = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400';

export function AuditorForm({ onSubmit, disabled }: Props): React.ReactElement {
  const [url, setUrl] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [city, setCity] = useState('');

  const canSubmit =
    !disabled &&
    url.trim().length >= 4 &&
    businessName.trim().length >= 2 &&
    city.trim().length >= 2;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
          url: url.trim(),
          businessName: businessName.trim(),
          city: city.trim(),
        });
      }}
    >
      <label className="flex flex-col gap-2">
        <span className={LABEL_CLASSES}>Sitio web del negocio</span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          className={INPUT_CLASSES}
          placeholder="mi-negocio.com"
        />
      </label>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className={LABEL_CLASSES}>Nombre del negocio</span>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className={INPUT_CLASSES}
            placeholder="Taller Lopez"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className={LABEL_CLASSES}>Ciudad</span>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={INPUT_CLASSES}
            placeholder="Quetzaltenango"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-premium inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-ink-950 disabled:cursor-not-allowed disabled:text-ink-500"
        >
          {disabled ? (
            <>
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-950/30 border-t-ink-950"
              />
              Auditando...
            </>
          ) : (
            <>
              Auditar gratis
              <span aria-hidden className="text-base leading-none">
                →
              </span>
            </>
          )}
        </button>
        <p className="text-[11px] leading-snug text-ink-500">
          Sin registro. Analizamos solo informacion publica de tu sitio.
        </p>
      </div>
    </form>
  );
}
