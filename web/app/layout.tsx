import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

// Display para titulos (geometrica, con caracter) + Inter para UI.
// next/font descarga y self-hostea en build: cero requests a Google
// en runtime y sin FOUT.
const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});
const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Scanner — escanea documentos desde tu celular',
  description:
    'Escanea documentos con la camara: deteccion de bordes, correccion de perspectiva, filtros y export a JPG, PNG o PDF. Todo en tu navegador.',
};

// viewportFit cover + safe-area en CSS: la UI llega hasta el borde en
// telefonos con notch sin que el home-indicator tape los botones.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#06080e',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`}>
      <body className="scanner-theme min-h-screen font-sans text-carbon-200 antialiased">
        {children}
      </body>
    </html>
  );
}
