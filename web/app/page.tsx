import type { Metadata } from 'next';
import { ScannerApp } from '../components/scanner/ScannerApp';

export const metadata: Metadata = {
  title: 'Scanner — escanea documentos desde tu celular',
  description:
    'Escanea documentos con la camara, deteccion automatica de bordes, correccion de perspectiva, filtros y export a JPG, PNG o PDF. Todo en tu navegador.',
};

/**
 * Home del deploy: el scanner. Diseno "Obturador": la app ocupa
 * exactamente el alto de la pantalla y cada vista reparte ese alto — visor
 * a sangre arriba, controles abajo al alcance del pulgar, sin scroll.
 */
export default function HomePage(): React.ReactElement {
  return (
    <main className="app-shell mx-auto flex w-full max-w-lg flex-col overflow-hidden bg-night-950 sm:border-x sm:border-night-800">
      <ScannerApp />
    </main>
  );
}
