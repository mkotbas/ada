import type PocketBase from 'pocketbase';
import { sanitizeUrl } from '../../core/dom';
import { notify } from '../../core/notify';
import { errorService } from '../../core/error';
import { withLoadingOverlay } from '../../core/utils';

type QuillLike = {
  root: HTMLElement;
  clipboard: { dangerouslyPasteHTML: (html: string) => void };
  setText: (text: string) => void;
  getSemanticHTML?: () => string;
};

declare const Quill: new (selector: string, opts: unknown) => QuillLike;

const DEFAULT_TEMPLATE =
  '<p>{YONETMEN_ADI} Bey Merhaba,</p>' +
  '<p>Ziyaret etmiş olduğum {BAYI_BILGISI} bayi karnesi aşağıdadır.</p>' +
  '<p><br></p>' +
  '{DENETIM_ICERIGI}' +
  '<p><br></p>' +
  '{PUAN_TABLOSU}';

const ALLOWED_TAGS = new Set([
  'A',
  'B',
  'BR',
  'EM',
  'H1',
  'H2',
  'H3',
  'I',
  'LI',
  'OL',
  'P',
  'SPAN',
  'STRONG',
  'U',
  'UL',
]);

let pb: PocketBase | null = null;
let quill: QuillLike | null = null;

export async function initializeEpostaTaslagiModule(pbInstance: PocketBase): Promise<void> {
  pb = pbInstance;
  ensureQuill();
  wireEvents();
  await loadTemplate();
}

function ensureQuill(): void {
  const toolbarOptions = [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ align: [] }],
    ['clean'],
  ];

  if (!quill) {
    quill = new Quill('#editor-container', {
      modules: { toolbar: toolbarOptions },
      theme: 'snow',
    });
  } else {
    quill.setText('');
  }
}

function wireEvents(): void {
  const saveBtn = document.getElementById('save-template-btn');
  if (!(saveBtn instanceof HTMLButtonElement)) return;

  if (saveBtn.dataset.listenerAttached === 'true') return;
  saveBtn.addEventListener('click', () => { void saveTemplate(); });
  saveBtn.dataset.listenerAttached = 'true';
}

function sanitizeTemplateHtml(rawHtml: string): string {
  const inputDoc = new DOMParser().parseFromString(rawHtml, 'text/html');
  const outputRoot = document.createElement('div');

  const appendSanitizedChildren = (source: ParentNode, target: ParentNode): void => {
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.append(document.createTextNode(child.textContent ?? ''));
        continue;
      }

      if (!(child instanceof HTMLElement)) {
        continue;
      }

      const tag = child.tagName.toUpperCase();
      if (!ALLOWED_TAGS.has(tag)) {
        appendSanitizedChildren(child, target);
        continue;
      }

      if (tag === 'BR') {
        target.append(document.createElement('br'));
        continue;
      }

      const sanitizedElement = document.createElement(tag.toLowerCase());

      if (tag === 'A') {
        const safeHref = sanitizeUrl(child.getAttribute('href') ?? '');
        if (!safeHref) {
          appendSanitizedChildren(child, target);
          continue;
        }
        sanitizedElement.setAttribute('href', safeHref);
        sanitizedElement.setAttribute('rel', 'noopener noreferrer');
      }

      appendSanitizedChildren(child, sanitizedElement);
      target.append(sanitizedElement);
    }
  };

  appendSanitizedChildren(inputDoc.body, outputRoot);
  return outputRoot.innerHTML;
}

async function loadTemplate(): Promise<void> {
  await withLoadingOverlay('E-posta şablonu yükleniyor...', async () => {
    let emailTemplate = DEFAULT_TEMPLATE;

    if (pb?.authStore.isValid) {
      try {
        const record = await pb.collection('ayarlar').getFirstListItem('anahtar="emailTemplate"');
        const value = (record as { deger?: unknown }).deger;
        if (typeof value === 'string' && value.trim()) {
          emailTemplate = value;
        }
      } catch (err) {
        const e = err as { status?: number };
        if (e.status !== 404) {
          console.error('E-posta şablonu yüklenemedi:', err);
          errorService.handle(e, { userMessage: 'E-posta şablonu buluttan yüklenirken bir hata oluştu.' });
        }
      }
    }

    if (quill) {
      quill.setText('');
      quill.clipboard.dangerouslyPasteHTML(sanitizeTemplateHtml(emailTemplate));
    }
  });
}

async function saveTemplate(): Promise<void> {
  if (!pb?.authStore.isValid) {
    notify.warning('Bu işlemi yapmak için sisteme giriş yapmalısınız.');
    return;
  }

  if (!quill) return;

  await withLoadingOverlay('E-posta şablonu kaydediliyor...', async () => {
    const rawTemplate = quill!.getSemanticHTML ? quill!.getSemanticHTML() : quill!.root.innerHTML;
    const data = { deger: sanitizeTemplateHtml(rawTemplate) };

    try {
      const record = await pb!.collection('ayarlar').getFirstListItem('anahtar="emailTemplate"');
      await pb!.collection('ayarlar').update((record as { id: string }).id, data);
      notify.success('E-posta şablonu başarıyla güncellendi.');
    } catch (err) {
      const e = err as { status?: number };

      if (e.status === 404) {
        try {
          await pb!.collection('ayarlar').create({ anahtar: 'emailTemplate', ...data });
          notify.success('E-posta şablonu başarıyla kaydedildi.');
        } catch (createErr) {
          console.error('E-posta şablonu oluşturulurken hata:', createErr);
          errorService.handle(createErr, { userMessage: 'Şablon kaydedilirken bir hata oluştu.' });
        }
      } else {
        console.error('E-posta şablonu kaydedilirken hata:', err);
        errorService.handle(e, { userMessage: 'Şablon kaydedilirken bir hata oluştu.' });
      }
    }
  });
}

// TOTAL_LINES: 174
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
