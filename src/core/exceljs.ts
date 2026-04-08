import type { Workbook, Worksheet } from 'exceljs';

const MAX_EXCEL_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ['.xlsx'];
const SUPPORTED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

type ExcelJsBrowserModule = {
  Workbook: typeof import('exceljs').Workbook;
};
let excelJsModulePromise: Promise<ExcelJsBrowserModule> | null = null;

function createExcelJsImport(): Promise<ExcelJsBrowserModule> {
  return import('exceljs/dist/exceljs.bare.min.js').then((module) => module.default as ExcelJsBrowserModule);
}

export function preloadExcelJs(): Promise<ExcelJsBrowserModule> {
  if (!excelJsModulePromise) {
    excelJsModulePromise = createExcelJsImport().catch((error) => {
      excelJsModulePromise = null;
      throw error;
    });
  }

  return excelJsModulePromise;
}

async function loadExcelJs(): Promise<ExcelJsBrowserModule> {
  return preloadExcelJs();
}

function normalizeFileName(value: string): string {
  return String(value ?? '').trim();
}

export function isSupportedExcelFile(file: File): { ok: true } | { ok: false; message: string } {
  const fileName = normalizeFileName(file.name).toLocaleLowerCase('tr-TR');
  const hasSupportedExtension = SUPPORTED_EXTENSIONS.some((ext) => fileName.endsWith(ext));
  const mimeType = String(file.type ?? '').trim();
  const mimeTypeAllowed = mimeType === '' || SUPPORTED_MIME_TYPES.has(mimeType);

  if (!hasSupportedExtension || !mimeTypeAllowed) {
    return { ok: false, message: 'Lütfen yalnızca .xlsx uzantılı Excel dosyası seçin.' };
  }

  if (file.size <= 0) {
    return { ok: false, message: 'Seçilen Excel dosyası boş görünüyor.' };
  }

  if (file.size > MAX_EXCEL_FILE_SIZE_BYTES) {
    return { ok: false, message: 'Excel dosyası çok büyük. Lütfen 10 MB altındaki bir .xlsx dosyası seçin.' };
  }

  return { ok: true };
}

function normalizeCellValue(cellValue: unknown): string | number | boolean | null {
  if (cellValue === null || cellValue === undefined) return '';
  if (typeof cellValue === 'string' || typeof cellValue === 'number' || typeof cellValue === 'boolean') {
    return cellValue;
  }
  if (cellValue instanceof Date) {
    return cellValue.toISOString();
  }
  if (typeof cellValue === 'object') {
    const valueRecord = cellValue as Record<string, unknown>;

    if (typeof valueRecord.richText !== 'undefined' && Array.isArray(valueRecord.richText)) {
      return valueRecord.richText
        .map((segment) => String((segment as Record<string, unknown>).text ?? ''))
        .join('');
    }

    if (typeof valueRecord.text === 'string') return valueRecord.text;
    if (typeof valueRecord.hyperlink === 'string') return valueRecord.hyperlink;
    if (typeof valueRecord.formula === 'string' && typeof valueRecord.result !== 'undefined') {
      return normalizeCellValue(valueRecord.result);
    }
    if (typeof valueRecord.result !== 'undefined') return normalizeCellValue(valueRecord.result);
    if (typeof valueRecord.sharedFormula === 'string' && typeof valueRecord.result !== 'undefined') {
      return normalizeCellValue(valueRecord.result);
    }
    if (typeof valueRecord.error === 'string') return valueRecord.error;
  }

  return String(cellValue);
}

function worksheetToMatrix(worksheet: Worksheet): unknown[][] {
  const rows: unknown[][] = [];

  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values;
    const rowData = Array.isArray(values)
      ? values.slice(1).map((value) => normalizeCellValue(value))
      : [];

    while (rowData.length > 0 && rowData[rowData.length - 1] === '') {
      rowData.pop();
    }

    rows.push(rowData);
  });

  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === '')) {
    rows.pop();
  }

  return rows;
}

export async function readExcelRowsFromArrayBuffer(buffer: ArrayBuffer): Promise<unknown[][]> {
  const { Workbook } = await loadExcelJs();
  const workbook: Workbook = new Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Çalışma sayfası bulunamadı.');
  }

  return worksheetToMatrix(worksheet);
}

export async function readExcelRowsFromFile(file: File): Promise<unknown[][]> {
  const validation = isSupportedExcelFile(file);
  if (!validation.ok && 'message' in validation) {
    throw new Error(validation.message);
  }

  const buffer = await file.arrayBuffer();
  return readExcelRowsFromArrayBuffer(buffer);
}

function worksheetFromHtmlTable(workbook: Workbook, table: HTMLTableElement, sheetName: string): Worksheet {
  const worksheet = workbook.addWorksheet(sheetName);
  const rowElements = Array.from(table.querySelectorAll('tr'));

  rowElements.forEach((rowElement) => {
    const cells = Array.from(rowElement.querySelectorAll('th, td')).map((cell) =>
      String(cell.textContent ?? '').trim(),
    );
    worksheet.addRow(cells);
  });

  return worksheet;
}

export async function exportHtmlTableToExcel(
  table: HTMLTableElement,
  fileName: string,
  sheetName = 'Sayfa1',
): Promise<void> {
  const { Workbook } = await loadExcelJs();
  const workbook: Workbook = new Workbook();
  worksheetFromHtmlTable(workbook, table, sheetName);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}
