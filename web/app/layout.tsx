import type { Metadata, Viewport } from 'next';
import { Public_Sans, Zilla_Slab } from 'next/font/google';
import './globals.css';

// Zilla Slab: slab serif con caracter de imprenta/sello para titulos y
// CTAs. Public Sans: cuerpo neutro y calido. Eleccion deliberada — nada
// de Inter/Space Grotesk/Nunito (defaults que delatan UI de IA).
const display = Zilla_Slab({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});
const body = Public_Sans({
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
  themeColor: '#EDE4D3',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="es" className={`${display.variable} ${body.variable}`}>
      <body className="scanner-theme min-h-screen font-sans text-cocoa-900 antialiased">
        {children}
      </body>
    </html>
  );
}
