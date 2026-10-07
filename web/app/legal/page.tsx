import type { Metadata } from 'next';
import { LegalContent } from '../../components/scanner/LegalContent';

export const metadata: Metadata = {
  title: 'Términos y privacidad · ScannerFree',
  description: 'Términos de uso y política de privacidad de ScannerFree. Terms of use and privacy policy.',
};

export default function LegalPage(): React.ReactElement {
  return <LegalContent />;
}
