import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Predictive Agent — TimesFM + Ollama',
  description:
    'UI para el agente predictivo: forecast con TimesFM y razonamiento con Ollama, todo open source.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="es">
      <body className="min-h-screen bg-ink-950 text-ink-100 antialiased">
        {children}
      </body>
    </html>
  );
}
