'use client';

import { useState } from 'react';
import type { AuditorRequest } from '../../lib/auditor-types';
import { IconArrow } from './icons';

interface Props {
  onSubmit: (params: AuditorRequest) => void;
  disabled: boolean;
}

const INPUT_CLASSES =
  'w-full rounded-sm border border-violet-400/20 bg-[#0a0514]/80 px-3.5 py-2.5 text-sm text-violet-50 ' +
  'placeholder-violet-300/25 outline-none transition duration-200 ' +
  'focus:border-fuchsia-400/60 focus:ring-4 focus:ring-fuchsia-500/10 hover:border-violet-400/35';

const LABEL_CLASSES = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-300/60';

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
        <span className={canSubmit ? 'btn-halo' : undefined}>
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-premium inline-flex items-center gap-2.5 px-6 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:text-violet-300/30"
          >
            {disabled ? (
              <>
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white"
                />
                Auditando...
              </>
            ) : (
              <>
                Auditar gratis
                <IconArrow className="h-4 w-4" />
              </>
            )}
          </button>
        </span>
        <p className="text-[11px] leading-snug text-violet-300/40">
          Sin registro. Analizamos solo informacion publica de tu sitio.
        </p>
      </div>
    </form>
  );
}
