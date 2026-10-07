'use client';

import { LangSwitch, useI18n, type Lang } from './i18n';
import { IconChevronLeft } from './icons';

/**
 * Terminos de uso y politica de privacidad, en español e ingles.
 * Texto en lenguaje sencillo; refleja como funciona la app de verdad: todo
 * ocurre en el telefono del usuario y no se recopila ningun dato.
 */
const UPDATED: Record<Lang, string> = { es: '7 de octubre de 2026', en: 'October 7, 2026' };

interface Section {
  title: string;
  body: string[];
}

const CONTENT: Record<Lang, { title: string; intro: string; updated: string; back: string; sections: Section[] }> = {
  es: {
    title: 'Términos y privacidad',
    updated: 'Última actualización',
    back: 'Volver a la app',
    intro:
      'ScannerFree es una herramienta gratuita para escanear documentos con la cámara del teléfono. Aquí explicamos, en palabras simples, qué pasa con tu información y cuáles son las reglas de uso.',
    sections: [
      {
        title: '1. Tus documentos no salen de tu teléfono',
        body: [
          'Todo el procesamiento (fotos, recorte, filtros y creación del PDF) ocurre dentro de tu navegador, en tu propio dispositivo.',
          'No subimos, no recibimos y no guardamos tus fotos, documentos ni PDF en ningún servidor. Nadie más que tú puede verlos.',
          'Cuando usas "Añadir PDF", el archivo se abre en tu teléfono; tampoco se envía a ningún lado.',
          'Los archivos solo salen del teléfono cuando tú decides compartirlos o descargarlos (por ejemplo, por WhatsApp o correo). Desde ese momento se rigen por las reglas de la app o servicio que elijas.',
        ],
      },
      {
        title: '2. Qué datos se usan',
        body: [
          'No pedimos cuentas, nombres, correos ni números de teléfono. No usamos analítica, publicidad, rastreadores ni cookies de seguimiento.',
          'Cámara: se usa solo mientras escaneas y solo con tu permiso, que puedes quitar en cualquier momento desde los ajustes del navegador.',
          'Almacenamiento en tu dispositivo: para que no pierdas tu trabajo, la app guarda en tu propio navegador las páginas escaneadas, las fotos sin editar y tus preferencias (idioma, modo, tamaño de hoja, calidad). Eso no es rastreo: es necesario para que la app funcione, por eso no hay aviso de cookies. Se borra con "Empezar de nuevo" o al borrar los datos del sitio en tu navegador.',
          'Alojamiento: la página se sirve desde Vercel. Como cualquier servicio de alojamiento, Vercel puede registrar datos técnicos de la conexión (como la dirección IP y el tipo de navegador) por seguridad y funcionamiento. Nosotros no usamos esos datos para identificarte. Más información en la política de privacidad de Vercel.',
        ],
      },
      {
        title: '3. Menores de edad',
        body: [
          'La app es apta para todas las edades. Como no recopilamos datos personales de nadie, tampoco recopilamos datos de menores.',
          'Si escaneas documentos de niños (por ejemplo, tareas o boletas escolares), esos documentos se quedan en tu dispositivo. Te recomendamos compartirlos solo con quien corresponda.',
        ],
      },
      {
        title: '4. Uso aceptable',
        body: [
          'Eres responsable del contenido que escaneas y compartes. Úsala solo con documentos que tengas derecho a copiar y compartir.',
          'No la uses para falsificar documentos, copiar material protegido sin permiso ni para ninguna actividad ilegal.',
        ],
      },
      {
        title: '5. Sin garantías',
        body: [
          'ScannerFree se ofrece gratis y "tal cual", sin garantías de ningún tipo. Hacemos lo posible para que funcione bien, pero puede tener errores o dejar de estar disponible.',
          'Como tus páginas se guardan solo en tu dispositivo, pueden perderse si borras los datos del navegador, cambias de teléfono o el navegador libera espacio. Guarda o comparte tus archivos importantes.',
          'En la medida que lo permita la ley, no somos responsables por pérdidas de datos ni por daños derivados del uso de la app.',
        ],
      },
      {
        title: '6. Software de terceros',
        body: [
          'La app usa software libre: PDF.js (Mozilla, licencia Apache 2.0), Next.js y React (licencia MIT) y las fuentes Barlow Condensed, Instrument Sans y JetBrains Mono (licencia SIL Open Font). Gracias a sus autores.',
        ],
      },
      {
        title: '7. Cambios',
        body: [
          'Si cambiamos estas reglas, actualizaremos esta página y la fecha de arriba. Si algún día la app empezara a recopilar datos, lo diremos claramente aquí antes de hacerlo.',
        ],
      },
    ],
  },
  en: {
    title: 'Terms & privacy',
    updated: 'Last updated',
    back: 'Back to the app',
    intro:
      "ScannerFree is a free tool for scanning documents with your phone's camera. Here we explain, in plain words, what happens to your information and the rules for using it.",
    sections: [
      {
        title: '1. Your documents never leave your phone',
        body: [
          'All processing (photos, cropping, filters and creating the PDF) happens inside your browser, on your own device.',
          "We don't upload, receive or store your photos, documents or PDFs on any server. Nobody but you can see them.",
          'When you use "Add PDF", the file is opened on your phone; it is not sent anywhere either.',
          'Files only leave your phone when you choose to share or download them (for example, via WhatsApp or email). From then on, the rules of the app or service you choose apply.',
        ],
      },
      {
        title: '2. What data is used',
        body: [
          "We don't ask for accounts, names, emails or phone numbers. We don't use analytics, advertising, trackers or tracking cookies.",
          'Camera: used only while you scan and only with your permission, which you can revoke at any time in your browser settings.',
          "On-device storage: so you don't lose your work, the app saves the scanned pages, unedited photos and your preferences (language, mode, page size, quality) in your own browser. That is not tracking: it's needed for the app to work, which is why there is no cookie banner. It's deleted with \"Start over\" or by clearing the site's data in your browser.",
          "Hosting: the page is served by Vercel. Like any hosting service, Vercel may log technical connection data (such as IP address and browser type) for security and operation. We don't use that data to identify you. See Vercel's privacy policy for more.",
        ],
      },
      {
        title: '3. Children',
        body: [
          "The app is suitable for all ages. Since we don't collect personal data from anyone, we don't collect data from children either.",
          "If you scan children's documents (for example, homework or report cards), those documents stay on your device. We recommend sharing them only with the people who need them.",
        ],
      },
      {
        title: '4. Acceptable use',
        body: [
          'You are responsible for the content you scan and share. Only use it with documents you have the right to copy and share.',
          "Don't use it to forge documents, copy protected material without permission, or for any illegal activity.",
        ],
      },
      {
        title: '5. No warranty',
        body: [
          'ScannerFree is provided free of charge and "as is", without warranties of any kind. We do our best to keep it working well, but it may have bugs or become unavailable.',
          'Because your pages are stored only on your device, they can be lost if you clear your browser data, change phones, or the browser frees up space. Save or share your important files.',
          'To the extent permitted by law, we are not liable for data loss or for damages arising from the use of the app.',
        ],
      },
      {
        title: '6. Third-party software',
        body: [
          'The app uses open-source software: PDF.js (Mozilla, Apache 2.0 license), Next.js and React (MIT license), and the Barlow Condensed, Instrument Sans and JetBrains Mono fonts (SIL Open Font License). Thanks to their authors.',
        ],
      },
      {
        title: '7. Changes',
        body: [
          'If we change these rules, we will update this page and the date above. If the app ever starts collecting data, we will say so clearly here before doing it.',
        ],
      },
    ],
  },
};

export function LegalContent(): React.ReactElement {
  const { lang } = useI18n();
  const c = CONTENT[lang];
  return (
    <main className="mx-auto h-[100dvh] w-full max-w-lg overflow-y-auto bg-night-950 sm:border-x sm:border-night-800">
      <div className="safe-top safe-x safe-bottom">
        <div className="flex items-center justify-between gap-3 pb-4">
          <a
            href="/"
            className="press flex min-h-[44px] items-center gap-1.5 rounded-xl border border-night-600 px-3 font-mono text-[11px] font-bold tracking-[0.08em] text-night-200"
          >
            <IconChevronLeft className="h-4 w-4" />
            {c.back.toUpperCase()}
          </a>
          <LangSwitch />
        </div>
        <h1 className="font-display text-[34px] font-extrabold uppercase leading-none tracking-[0.02em]">{c.title}</h1>
        <p className="mt-2 font-mono text-[11px] tracking-[0.06em] text-night-400">
          {c.updated.toUpperCase()}: {UPDATED[lang].toUpperCase()}
        </p>
        <p className="mt-4 leading-relaxed text-night-200">{c.intro}</p>
        {c.sections.map((s) => (
          <section key={s.title} className="mt-6">
            <h2 className="font-display text-xl font-bold uppercase tracking-[0.03em] text-volt">{s.title}</h2>
            {s.body.map((p) => (
              <p key={p} className="mt-2 text-[15px] leading-relaxed text-night-200">
                {p}
              </p>
            ))}
          </section>
        ))}
        <p className="mt-8 pb-4 font-mono text-[10px] tracking-[0.06em] text-night-500">© ScannerFree</p>
      </div>
    </main>
  );
}
