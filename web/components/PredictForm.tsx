'use client';

import { useMemo, useState } from 'react';
import { parseSeries } from '../lib/parse-series';

const SAMPLE_SERIES = `// Ventas semanales de un SaaS (40 semanas)
1240, 1280, 1305, 1290, 1340, 1395, 1410, 1430,
1460, 1490, 1525, 1510, 1560, 1605, 1640, 1670,
1690, 1725, 1760, 1790, 1830, 1855, 1900, 1940,
1980, 2010, 2055, 2100, 2150, 2190, 2230, 2270,
2310, 2360, 2400, 2440, 2485, 2530, 2575, 2615`;

interface Props {
  onSubmit: (params: { series: number[]; horizon: number; question: string }) => void;
  disabled: boolean;
}

export function PredictForm({ onSubmit, disabled }: Props): React.ReactElement {
  const [text, setText] = useState(SAMPLE_SERIES);
  const [horizon, setHorizon] = useState(12);
  const [question, setQuestion] = useState('Cuanto crece y cual es el riesgo a la baja?');

  const parseResult = useMemo(() => {
    const cleaned = text
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    return parseSeries(cleaned);
  }, [text]);

  const canSubmit = !disabled && parseResult.ok;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!parseResult.ok) return;
        onSubmit({ series: parseResult.series, horizon, question: question.trim() });
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="flex items-center justify-between text-sm">
          <span className="font-medium">Serie de tiempo</span>
          <span className="text-xs text-ink-400">
            {parseResult.ok
              ? `${parseResult.series.length} valores`
              : (parseResult.error ?? '...')}
          </span>
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-ink-800 bg-ink-900 p-3 font-mono text-sm text-ink-100 placeholder-ink-500 outline-none focus:border-ink-600"
          placeholder="1240, 1280, 1305, ..."
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Horizonte (pasos)</span>
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="rounded-md border border-ink-800 bg-ink-900 p-2 text-sm outline-none focus:border-ink-600"
          >
            {[4, 8, 12, 16, 24, 32].map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Pregunta para la interpretacion
          </span>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="rounded-md border border-ink-800 bg-ink-900 p-2 text-sm outline-none focus:border-ink-600"
            placeholder="Cual es la tendencia?"
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="self-start rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-ink-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
      >
        {disabled ? 'Prediciendo...' : 'Predecir'}
      </button>
    </form>
  );
}
