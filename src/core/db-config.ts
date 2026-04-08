import PocketBase from "pocketbase";

const LOCAL_DEVELOPMENT_URL = "http://127.0.0.1:8090";

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function resolvePocketBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_POCKETBASE_URL?.trim();
  if (configuredUrl) {
    return trimTrailingSlashes(configuredUrl);
  }

  if (import.meta.env.DEV) {
    return LOCAL_DEVELOPMENT_URL;
  }

  throw new Error(
    "[FiDe] Production ortamında VITE_POCKETBASE_URL zorunludur. Lütfen ortam değişkenini tanımlayın.",
  );
}

export const POCKETBASE_URL = resolvePocketBaseUrl();
export const pb = new PocketBase(POCKETBASE_URL);

pb.autoCancellation(true);

// TOTAL_LINES: 24
// HAS_PLACEHOLDERS: NO
// OMITTED_ANY_CODE: NO
// IS_THIS_THE_COMPLETE_FILE: YES
