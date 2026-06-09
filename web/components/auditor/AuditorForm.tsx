'use client';

import { useState } from 'react';
import type { AuditorRequest } from '../../lib/auditor-types';

interface Props {
  onSubmit: (params: AuditorRequest) => void;
  disabled: boolean;
}

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
      className="flex flex-col gap-4"
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
        <span className="text-sm font-medium">Sitio web del negocio</span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          className="rounded-md border border-ink-800 bg-ink-900 p-2 text-sm outline-none focus:border-ink-600"
          placeholder="mi-negocio.com"
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Nombre del negocio</span>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="rounded-md border border-ink-800 bg-ink-900 p-2 text-sm outline-none focus:border-ink-600"
            placeholder="Taller Lopez"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Ciudad</span>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-md border border-ink-800 bg-ink-900 p-2 text-sm outline-none focus:border-ink-600"
            placeholder="Quetzaltenango"
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="self-start rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-ink-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
      >
        {disabled ? 'Auditando...' : 'Auditar gratis'}
      </button>
    </form>
  );
}
