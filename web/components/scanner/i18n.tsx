'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Idiomas de la app (español / inglés) sin librerias.
 *
 * El idioma vive en un "store" de modulo: cualquier componente lo lee con
 * useI18n() y el selector (LangSwitch) lo cambia en todas las pantallas a la
 * vez. Se recuerda en localStorage; la primera vez se toma del navegador
 * (ingles si el telefono esta en ingles, si no español). El HTML se genera
 * en español (servidor) y el cambio ocurre al hidratar, sin errores de
 * hidratacion (useSyncExternalStore con snapshot de servidor).
 */
export type Lang = 'es' | 'en';
type Vars = Record<string, string | number>;
type Entry = string | ((v: Vars) => string);
export type TFn = (key: string, vars?: Vars) => string;

const plural = (n: number | string, one: string, many: string): string => (Number(n) === 1 ? one : many);

const ES: Record<string, Entry> = {
  // Comunes
  'common.addPdf': 'Añadir un PDF',
  'common.back': 'Volver',
  'common.cancel': 'CANCELAR',
  'common.close': 'Cerrar',
  'common.closeNotice': 'Cerrar aviso',
  'common.loading': 'Cargando',
  'common.reload': 'Recargar',
  'err.generic': 'Algo salió mal. Inténtalo de nuevo.',
  'lang.label': 'Idioma',

  // Modos de escaneo y filtros
  'mode.doc': 'Documento',
  'mode.receipt': 'Recibo',
  'mode.bw': 'B&N',
  'mode.photo': 'Foto',
  'filter.original': 'Original',
  'filter.magic': 'Mágico',
  'filter.doc': 'Documento',
  'filter.shadow': 'Sin sombra',
  'filter.receipt': 'Factura',
  'filter.bw': 'B&N',
  'filter.grayscale': 'Gris',
  'filter.sharpen': 'Nítido',
  'filter.photo': 'Foto',
  'filter.vivid': 'Vívido',
  'filterHint.original': 'Sin procesamiento',
  'filterHint.magic': 'Escaneo automático: papel parejo, tinta firme, colores intactos',
  'filterHint.doc': 'Blanquea el papel y quita sombras; conserva sellos y firmas en color',
  'filterHint.shadow': 'Solo levanta sombras y empareja la luz, sin blanquear ni tocar colores',
  'filterHint.receipt': 'Realza texto desvanecido de tickets, facturas y papel térmico',
  'filterHint.bw': 'Blanco y negro adaptativo para máxima legibilidad',
  'filterHint.grayscale': 'Escala de grises con contraste automático',
  'filterHint.sharpen': 'Enfoca capturas levemente borrosas',
  'filterHint.photo': 'Balance de blancos y contraste natural para fotografías',
  'filterHint.vivid': 'Colores intensos y contraste marcado',
  'paper.auto': 'Ajustar',
  'paper.carta': 'Carta',
  'paper.a4': 'A4',
  'paper.oficio': 'Oficio',

  // Camara
  'cap.tapToStart': 'TOCA PARA ACTIVAR LA CÁMARA',
  'cap.opening': 'ABRIENDO CÁMARA',
  'cap.noCamera': 'Sin cámara',
  'cap.noCameraMsg': 'No pudimos abrir la cámara en este navegador.',
  'cap.takePhoto': 'Tomar foto',
  'cap.retry': 'REINTENTAR CÁMARA',
  'cap.autoTitle': 'Captura automática al detectar el documento',
  'cap.burst': 'RÁFAGA',
  'cap.burstTitle': 'Varias páginas seguidas: se editan al final',
  'cap.torch': 'LUZ',
  'cap.torchOn': 'LUZ ON',
  'cap.torchTitle': 'Linterna',
  'cap.preparing': 'PREPARANDO FOTO',
  'cap.modes': 'Modo de escaneo',
  'cap.gallery': 'Galería',
  'cap.galleryShort': 'GALERÍA',
  'cap.done': 'Listo',
  'cap.capture': 'Capturar',
  'cap.captureN': 'Capturar página {n}',
  'cap.editShots': 'Editar {n} capturas',
  'cap.myPages': 'Mis páginas ({n})',
  'cap.confirmDiscard': (v) => `Tienes ${v.n} ${plural(v.n!, 'foto', 'fotos')} sin editar. ¿Descartarlas?`,
  'cap.errDenied':
    'El permiso de cámara está bloqueado. Actívalo en los ajustes del navegador, o toma la foto con el botón de abajo.',
  'cap.errNotFound': 'No encontramos una cámara en este dispositivo.',
  'cap.errBusy': 'Otra app está usando la cámara. Ciérrala y reintenta.',
  'cap.errUnknown': 'No pudimos abrir la cámara en este navegador.',
  'cap.hud.shooting': 'CAPTURANDO · NO TE MUEVAS',
  'cap.hud.manual': 'MANUAL · TOCA EL OBTURADOR',
  'cap.hud.lowContrast': 'POCO CONTRASTE · MÁS LUZ',
  'cap.hud.next': 'LISTO · PON LA SIGUIENTE HOJA',
  'cap.hud.locked': 'BLOQUEADO · NO TE MUEVAS',
  'cap.hud.detected': 'DOCUMENTO DETECTADO',
  'cap.hud.searching': 'BUSCANDO BORDES',

  // Editor
  'edit.title': 'Ajustar',
  'edit.rotate': 'ROTAR',
  'edit.detect': 'Detectar bordes',
  'edit.margin': 'MARGEN',
  'edit.all': 'TODO',
  'edit.allAria': 'Imagen completa',
  'edit.filter': 'Filtro',
  'edit.apply': 'Aplicar',
  'edit.processing': 'Procesando',
  'edit.noEdges': 'NO ENCONTRÉ LOS BORDES · AJÚSTALOS A MANO',
  'edit.hint.crossed': 'LAS ESQUINAS SE CRUZAN · AJÚSTALAS',
  'edit.hint.detected': 'BORDES LISTOS · AJUSTA SI HACE FALTA',
  'edit.hint.drag': 'ARRASTRA LAS 4 ESQUINAS',
  'edit.hint.adjust': 'AJUSTA LAS ESQUINAS SI HACE FALTA',
  'edit.errMemory':
    'No se pudo procesar la página (memoria insuficiente). Guarda las páginas que ya tienes e inténtalo de nuevo.',
  'edit.corner0': 'esquina superior izquierda',
  'edit.corner1': 'esquina superior derecha',
  'edit.corner2': 'esquina inferior derecha',
  'edit.corner3': 'esquina inferior izquierda',
  'edit.cornerAria': '{corner}: {x}% horizontal, {y}% vertical. Usa las flechas para ajustar.',

  // Exportar
  'exp.title': 'Exportar',
  'exp.pagesShort': '{n} PÁG',
  'exp.nPages': '{n} pág',
  'exp.pageView': 'Página {i} de {n}. Ver',
  'exp.rotatePage': 'Girar página {i}',
  'exp.scanAnother': 'Escanear otra página',
  'exp.scan': 'Escanear',
  'exp.addPdf': 'Añadir PDF',
  'exp.hintDrag': 'MANTÉN PRESIONADA UNA HOJA PARA MOVERLA',
  'exp.hintTap': 'TOCA UNA PÁGINA PARA VERLA',
  'exp.restart': 'EMPEZAR DE NUEVO',
  'exp.filename': 'NOMBRE DEL ARCHIVO',
  'exp.paper': 'TAMAÑO DE HOJA',
  'exp.paperAutoHint': 'LA HOJA TOMA LA FORMA DEL DOCUMENTO, SIN BORDES',
  'exp.paperFixedHint': '{paper} EXACTA PARA IMPRIMIR · DOCUMENTO CENTRADO',
  'exp.quality': 'CALIDAD',
  'exp.qMax': 'Máxima',
  'exp.qSmall': 'Ligera',
  'exp.qMaxHint': 'LA MEJOR NITIDEZ (300 DPI) · ARCHIVO MÁS PESADO',
  'exp.qSmallHint': 'PESA MUCHO MENOS · IDEAL PARA WHATSAPP Y CORREO',
  'exp.format': 'Formato',
  'exp.hint.pdf': 'Todas las páginas en un solo archivo',
  'exp.hint.jpg': 'Una imagen por página',
  'exp.hint.jpgIos': 'Una imagen por página · se guarda en Fotos',
  'exp.hint.png': 'Una imagen por página · sin compresión',
  'exp.meta.fitted': 'AJUSTADO',
  'exp.meta.jpegSmall': 'JPEG · LIGERA',
  'exp.readyTap': 'Listo · toca para guardar',
  'exp.preparing': 'Preparando',
  'exp.save': 'Guardar {what}',
  'exp.download': 'DESCARGAR AL DISPOSITIVO',
  'exp.done.shared': 'Listo.',
  'exp.done.downloaded1': 'Archivo descargado.',
  'exp.done.downloadedN': '{n} archivos descargados.',
  'exp.errGenerate': 'No se pudo generar el archivo. Inténtalo de nuevo.',
  'exp.viewer.page': 'Página',
  'exp.viewer.aria': 'Página {i} de {n}',
  'exp.viewer.alt': 'Página {i}',
  'exp.viewer.before': 'ANTES',
  'exp.viewer.beforeAria': 'Mover antes',
  'exp.viewer.rotate': 'GIRAR',
  'exp.viewer.rotateAria': 'Girar',
  'exp.viewer.remove': 'QUITAR',
  'exp.viewer.removeAria': 'Quitar',
  'exp.viewer.after': 'DESPUÉS',
  'exp.viewer.afterAria': 'Mover después',
  'legal.link': 'TÉRMINOS Y PRIVACIDAD',

  // Avisos de la app
  'app.restored': (v) => `Sesión anterior restaurada · ${v.n} ${plural(v.n!, 'página', 'páginas')}`,
  'app.restoredMissing': ' ({n} no se pudieron recuperar)',
  'app.someFailed': '{n} de {total} imágenes no se pudieron abrir.',
  'app.confirmDiscard': 'Se descartarán {n} fotos sin editar. ¿Continuar?',
  'app.orphansFailed': 'No se pudieron abrir las fotos sin editar.',
  'app.pdfAdded': (v) => `PDF añadido · ${v.n} ${plural(v.n!, 'hoja', 'hojas')}`,
  'app.pdfAddedFirst': 'PDF añadido · primeras {n} de {total} hojas',
  'app.pdfFailed': ' ({n} no se pudieron leer)',
  'app.confirmRestart': (v) =>
    `Se borrarán ${Number(v.n) === 1 ? 'la página' : `las ${v.n} páginas`} de este documento. ¿Empezar de nuevo?`,
  'app.queue': 'FOTO {i}/{n}',
  'app.cantOpen': 'NO SE PUDO ABRIR',
  'app.otherTab': 'OTRA PESTAÑA',
  'app.otherTabMsg': 'La app está abierta en otra pestaña y los cambios de aquí ya no se guardan.',
  'app.noBackup': 'SIN RESPALDO',
  'app.noBackupMsg':
    'No se pudo guardar la sesión (almacenamiento lleno o modo privado). Guarda el archivo ahora: si recargas, perderás las páginas.',
  'app.orphans': (v) =>
    `Tienes ${Number(v.n) === 1 ? '1 foto' : `${v.n} fotos`} sin editar de la vez anterior.`,
  'app.discard': 'DESCARTAR',
  'app.continue': 'CONTINUAR',
  'app.readingPdf': 'LEYENDO PDF',
  'app.removed': (v) => (Number(v.n) === 1 ? 'PÁGINA ELIMINADA' : `${v.n} PÁGINAS ELIMINADAS`),
  'app.undo': 'Deshacer',

  // Errores de imagen y PDF
  'img.heic': 'Este navegador no abre fotos HEIC. Cambia la cámara a "JPG / Más compatible" o compártela como JPG.',
  'img.invalid': 'La imagen no tiene dimensiones válidas.',
  'img.tooBig': 'Imagen demasiado grande ({mp} MP). Máximo {max} MP.',
  'img.decode': 'No se pudo abrir la imagen (formato no compatible o archivo dañado).',
  'pdf.tooBig': 'El PDF es demasiado grande (máximo 50 MB).',
  'pdf.loadNetwork': 'No se pudo cargar el lector de PDF. Revisa tu conexión o recarga la página e inténtalo de nuevo.',
  'pdf.loadBrowser': 'Este navegador no puede leer PDF. Actualiza el sistema del teléfono o prueba con otro navegador.',
  'pdf.password': 'Ese PDF tiene contraseña. Ábrelo sin contraseña o guarda una copia sin protección.',
  'pdf.invalid': 'El archivo no es un PDF válido o está dañado.',
  'pdf.open': 'No se pudo abrir el PDF.',
  'pdf.noneRead': 'No se pudo leer ninguna hoja del PDF.',
  'pdf.draw': 'Tu navegador no pudo dibujar la hoja.',
  'pdf.empty': 'Ese PDF no tiene hojas.',
};

const EN: Record<string, Entry> = {
  'common.addPdf': 'Add a PDF',
  'common.back': 'Back',
  'common.cancel': 'CANCEL',
  'common.close': 'Close',
  'common.closeNotice': 'Dismiss',
  'common.loading': 'Loading',
  'common.reload': 'Reload',
  'err.generic': 'Something went wrong. Please try again.',
  'lang.label': 'Language',

  'mode.doc': 'Document',
  'mode.receipt': 'Receipt',
  'mode.bw': 'B&W',
  'mode.photo': 'Photo',
  'filter.original': 'Original',
  'filter.magic': 'Magic',
  'filter.doc': 'Document',
  'filter.shadow': 'No shadow',
  'filter.receipt': 'Receipt',
  'filter.bw': 'B&W',
  'filter.grayscale': 'Gray',
  'filter.sharpen': 'Sharp',
  'filter.photo': 'Photo',
  'filter.vivid': 'Vivid',
  'filterHint.original': 'No processing',
  'filterHint.magic': 'Automatic scan: even paper, solid ink, colors intact',
  'filterHint.doc': 'Whitens the paper and removes shadows; keeps colored stamps and signatures',
  'filterHint.shadow': 'Only lifts shadows and evens out the light, without whitening or touching colors',
  'filterHint.receipt': 'Boosts faded text on receipts, invoices and thermal paper',
  'filterHint.bw': 'Adaptive black and white for maximum legibility',
  'filterHint.grayscale': 'Grayscale with automatic contrast',
  'filterHint.sharpen': 'Sharpens slightly blurry shots',
  'filterHint.photo': 'White balance and natural contrast for photos',
  'filterHint.vivid': 'Intense colors and strong contrast',
  'paper.auto': 'Fit',
  'paper.carta': 'Letter',
  'paper.a4': 'A4',
  'paper.oficio': 'Legal 13"',

  'cap.tapToStart': 'TAP TO START THE CAMERA',
  'cap.opening': 'OPENING CAMERA',
  'cap.noCamera': 'No camera',
  'cap.noCameraMsg': "We couldn't open the camera in this browser.",
  'cap.takePhoto': 'Take photo',
  'cap.retry': 'RETRY CAMERA',
  'cap.autoTitle': 'Capture automatically when the document is detected',
  'cap.burst': 'BURST',
  'cap.burstTitle': 'Several pages in a row: edit them at the end',
  'cap.torch': 'LIGHT',
  'cap.torchOn': 'LIGHT ON',
  'cap.torchTitle': 'Flashlight',
  'cap.preparing': 'PREPARING PHOTO',
  'cap.modes': 'Scan mode',
  'cap.gallery': 'Gallery',
  'cap.galleryShort': 'GALLERY',
  'cap.done': 'Done',
  'cap.capture': 'Capture',
  'cap.captureN': 'Capture page {n}',
  'cap.editShots': 'Edit {n} shots',
  'cap.myPages': 'My pages ({n})',
  'cap.confirmDiscard': (v) => `You have ${v.n} unedited ${plural(v.n!, 'photo', 'photos')}. Discard them?`,
  'cap.errDenied':
    'Camera permission is blocked. Allow it in your browser settings, or take the photo with the button below.',
  'cap.errNotFound': "We couldn't find a camera on this device.",
  'cap.errBusy': 'Another app is using the camera. Close it and try again.',
  'cap.errUnknown': "We couldn't open the camera in this browser.",
  'cap.hud.shooting': 'CAPTURING · HOLD STILL',
  'cap.hud.manual': 'MANUAL · TAP THE SHUTTER',
  'cap.hud.lowContrast': 'LOW CONTRAST · MORE LIGHT',
  'cap.hud.next': 'DONE · PLACE THE NEXT PAGE',
  'cap.hud.locked': 'LOCKED · HOLD STILL',
  'cap.hud.detected': 'DOCUMENT DETECTED',
  'cap.hud.searching': 'LOOKING FOR EDGES',

  'edit.title': 'Adjust',
  'edit.rotate': 'ROTATE',
  'edit.detect': 'Detect edges',
  'edit.margin': 'MARGIN',
  'edit.all': 'ALL',
  'edit.allAria': 'Whole image',
  'edit.filter': 'Filter',
  'edit.apply': 'Apply',
  'edit.processing': 'Processing',
  'edit.noEdges': "COULDN'T FIND THE EDGES · ADJUST THEM BY HAND",
  'edit.hint.crossed': 'THE CORNERS CROSS · FIX THEM',
  'edit.hint.detected': 'EDGES FOUND · ADJUST IF NEEDED',
  'edit.hint.drag': 'DRAG THE 4 CORNERS',
  'edit.hint.adjust': 'ADJUST THE CORNERS IF NEEDED',
  'edit.errMemory': "Couldn't process the page (not enough memory). Save the pages you have and try again.",
  'edit.corner0': 'top left corner',
  'edit.corner1': 'top right corner',
  'edit.corner2': 'bottom right corner',
  'edit.corner3': 'bottom left corner',
  'edit.cornerAria': '{corner}: {x}% horizontal, {y}% vertical. Use the arrow keys to adjust.',

  'exp.title': 'Export',
  'exp.pagesShort': (v) => `${v.n} ${plural(v.n!, 'PAGE', 'PAGES')}`,
  'exp.nPages': (v) => `${v.n} ${plural(v.n!, 'page', 'pages')}`,
  'exp.pageView': 'Page {i} of {n}. View',
  'exp.rotatePage': 'Rotate page {i}',
  'exp.scanAnother': 'Scan another page',
  'exp.scan': 'Scan',
  'exp.addPdf': 'Add PDF',
  'exp.hintDrag': 'PRESS AND HOLD A PAGE TO MOVE IT',
  'exp.hintTap': 'TAP A PAGE TO VIEW IT',
  'exp.restart': 'START OVER',
  'exp.filename': 'FILE NAME',
  'exp.paper': 'PAGE SIZE',
  'exp.paperAutoHint': 'THE PAGE TAKES THE SHAPE OF THE DOCUMENT, NO BORDERS',
  'exp.paperFixedHint': 'EXACT {paper} FOR PRINTING · DOCUMENT CENTERED',
  'exp.quality': 'QUALITY',
  'exp.qMax': 'Best',
  'exp.qSmall': 'Light',
  'exp.qMaxHint': 'SHARPEST (300 DPI) · LARGER FILE',
  'exp.qSmallHint': 'MUCH SMALLER · GREAT FOR WHATSAPP AND EMAIL',
  'exp.format': 'Format',
  'exp.hint.pdf': 'All pages in a single file',
  'exp.hint.jpg': 'One image per page',
  'exp.hint.jpgIos': 'One image per page · saved to Photos',
  'exp.hint.png': 'One image per page · lossless',
  'exp.meta.fitted': 'FITTED',
  'exp.meta.jpegSmall': 'JPEG · LIGHT',
  'exp.readyTap': 'Ready · tap to save',
  'exp.preparing': 'Preparing',
  'exp.save': 'Save {what}',
  'exp.download': 'DOWNLOAD TO DEVICE',
  'exp.done.shared': 'Done.',
  'exp.done.downloaded1': 'File downloaded.',
  'exp.done.downloadedN': '{n} files downloaded.',
  'exp.errGenerate': "Couldn't create the file. Please try again.",
  'exp.viewer.page': 'Page',
  'exp.viewer.aria': 'Page {i} of {n}',
  'exp.viewer.alt': 'Page {i}',
  'exp.viewer.before': 'BEFORE',
  'exp.viewer.beforeAria': 'Move earlier',
  'exp.viewer.rotate': 'ROTATE',
  'exp.viewer.rotateAria': 'Rotate',
  'exp.viewer.remove': 'REMOVE',
  'exp.viewer.removeAria': 'Remove',
  'exp.viewer.after': 'AFTER',
  'exp.viewer.afterAria': 'Move later',
  'legal.link': 'TERMS & PRIVACY',

  'app.restored': (v) => `Previous session restored · ${v.n} ${plural(v.n!, 'page', 'pages')}`,
  'app.restoredMissing': " ({n} couldn't be recovered)",
  'app.someFailed': "{n} of {total} images couldn't be opened.",
  'app.confirmDiscard': '{n} unedited photos will be discarded. Continue?',
  'app.orphansFailed': "Couldn't open the unedited photos.",
  'app.pdfAdded': (v) => `PDF added · ${v.n} ${plural(v.n!, 'page', 'pages')}`,
  'app.pdfAddedFirst': 'PDF added · first {n} of {total} pages',
  'app.pdfFailed': " ({n} couldn't be read)",
  'app.confirmRestart': (v) =>
    `${Number(v.n) === 1 ? 'The page' : `All ${v.n} pages`} of this document will be deleted. Start over?`,
  'app.queue': 'PHOTO {i}/{n}',
  'app.cantOpen': "COULDN'T OPEN",
  'app.otherTab': 'ANOTHER TAB',
  'app.otherTabMsg': "The app is open in another tab, so changes here aren't being saved anymore.",
  'app.noBackup': 'NOT BACKED UP',
  'app.noBackupMsg':
    "The session couldn't be saved (storage full or private mode). Save your file now: if you reload, you'll lose the pages.",
  'app.orphans': (v) =>
    `You have ${Number(v.n) === 1 ? '1 unedited photo' : `${v.n} unedited photos`} from last time.`,
  'app.discard': 'DISCARD',
  'app.continue': 'CONTINUE',
  'app.readingPdf': 'READING PDF',
  'app.removed': (v) => (Number(v.n) === 1 ? 'PAGE DELETED' : `${v.n} PAGES DELETED`),
  'app.undo': 'Undo',

  'img.heic': 'This browser can\'t open HEIC photos. Set your camera to "Most compatible / JPG" or share it as JPG.',
  'img.invalid': "The image doesn't have valid dimensions.",
  'img.tooBig': 'Image too large ({mp} MP). Maximum {max} MP.',
  'img.decode': "Couldn't open the image (unsupported format or damaged file).",
  'pdf.tooBig': 'The PDF is too large (50 MB max).',
  'pdf.loadNetwork': "Couldn't load the PDF reader. Check your connection or reload the page and try again.",
  'pdf.loadBrowser': "This browser can't read PDFs. Update your phone's system or try another browser.",
  'pdf.password': 'That PDF is password-protected. Open it without a password or save an unprotected copy.',
  'pdf.invalid': 'The file is not a valid PDF or is damaged.',
  'pdf.open': "Couldn't open the PDF.",
  'pdf.noneRead': "Couldn't read any page of the PDF.",
  'pdf.draw': "Your browser couldn't draw the page.",
  'pdf.empty': 'That PDF has no pages.',
};

export const DICTS: Record<Lang, Record<string, Entry>> = { es: ES, en: EN };

/** Traduce `key` (con {variables}). Si falta en ingles usa el español. */
export function translate(lang: Lang, key: string, vars: Vars = {}): string {
  const entry = DICTS[lang][key] ?? ES[key];
  if (entry === undefined) return key;
  if (typeof entry === 'function') return entry(vars);
  return entry.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function isLang(v: unknown): v is Lang {
  return v === 'es' || v === 'en';
}

// --- Store del idioma -------------------------------------------------------
const STORAGE_KEY = 'scanner.lang';
let current: Lang | null = null;
const listeners = new Set<() => void>();

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* sin almacenamiento */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return /^en\b/i.test(nav) ? 'en' : 'es';
}

function getLang(): Lang {
  if (current === null) {
    current = initialLang();
    if (typeof document !== 'undefined') document.documentElement.lang = current;
  }
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* sin almacenamiento: solo esta visita */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useI18n(): { lang: Lang; setLang: (l: Lang) => void; t: TFn } {
  const lang = useSyncExternalStore(subscribe, getLang, () => 'es' as Lang);
  const t = useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang]);
  return { lang, setLang, t };
}

/** Selector ES | EN (radiogroup compacto). */
export function LangSwitch({ className = '' }: { className?: string }): React.ReactElement {
  const { lang, setLang: set, t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={t('lang.label')}
      className={`flex shrink-0 overflow-hidden rounded-lg border border-white/20 bg-black/55 font-mono text-[11px] font-bold tracking-[0.06em] ${className}`}
    >
      {(['es', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          lang={l}
          aria-label={l === 'es' ? 'Español' : 'English'}
          onClick={() => set(l)}
          className={`min-h-[36px] min-w-[38px] px-2 ${lang === l ? 'bg-volt text-night-950' : 'text-night-200'}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
