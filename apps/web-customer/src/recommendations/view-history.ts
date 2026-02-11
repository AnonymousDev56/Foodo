const STORAGE_KEY = "foodo.customer.view-history.v1";
const MAX_ITEMS = 20;

interface ViewHistoryPayload {
  productIds: string[];
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readHistory(): string[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as ViewHistoryPayload;
    if (!parsed || !Array.isArray(parsed.productIds)) {
      return [];
    }

    return parsed.productIds.filter((id) => typeof id === "string" && id.trim().length > 0);
  } catch {
    return [];
  }
}

function writeHistory(productIds: string[]) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        productIds: productIds.slice(0, MAX_ITEMS)
      } satisfies ViewHistoryPayload)
    );
  } catch {
    // Best-effort storage, keep silent.
  }
}

export function trackProductView(productId: string) {
  if (!productId) {
    return;
  }

  const existing = readHistory().filter((id) => id !== productId);
  writeHistory([productId, ...existing]);
}

export function getViewedProductIds(limit = 5) {
  return readHistory().slice(0, Math.max(1, limit));
}
