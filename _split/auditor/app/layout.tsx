import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Auditor GEO/SEO',
  description: 'Audita la visibilidad de un negocio en Google y motores de IA.',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
