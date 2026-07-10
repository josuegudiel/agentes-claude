import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Scanner — escanea documentos desde tu celular',
  description:
    'Escanea documentos con la camara: deteccion de bordes, correccion de perspectiva, filtros y export a JPG, PNG o PDF. Todo en tu navegador.',
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
