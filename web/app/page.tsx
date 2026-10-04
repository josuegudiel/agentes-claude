import { ScannerApp } from '../components/scanner/ScannerApp';
import { ServiceWorker } from '../components/scanner/ServiceWorker';

/**
 * Home del deploy: el scanner. Diseno "Obturador": la app ocupa
 * exactamente el alto de la pantalla y cada vista reparte ese alto — visor
 * a sangre arriba, controles abajo al alcance del pulgar, sin scroll.
 */
export default function HomePage(): React.ReactElement {
  return (
    <main className="app-shell mx-auto flex w-full max-w-lg flex-col overflow-hidden bg-night-950 sm:border-x sm:border-night-800">
      <ScannerApp />
      <ServiceWorker />
    </main>
  );
}
