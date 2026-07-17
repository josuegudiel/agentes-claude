import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agente predictivo — TimesFM + LLM',
  description: 'Forecast de series con TimesFM e interpretacion con un LLM open source.',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
