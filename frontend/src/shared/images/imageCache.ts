import { API_URL } from "@/shared/api/http";
import { Category, Product, ProductImage } from "@/shared/types/models";

const IMAGE_CACHE_NAME = "ovoshi-help-image-cache-v1";
const IMAGE_CACHE_INDEX_KEY = "ovoshi_help_image_cache_index_v1";

type ImageCacheEntry = {
  url: string;
};

type ImageCacheIndex = Record<string, ImageCacheEntry>;

type ImageAsset = {
  owner: string;
  url: string;
};

let reconciliationQueue = Promise.resolve();

export function imageUrl(filePath?: string | null, contentHash?: string | null) {
  if (!filePath) return null;

  const url = new URL(filePath, API_URL);
  if (contentHash) url.searchParams.set("v", contentHash);
  return url.toString();
}

export function productImageUrl(image?: ProductImage | null) {
  return imageUrl(image?.filePath, image?.contentHash);
}

export function categoryImageUrl(category?: Category | null) {
  return imageUrl(category?.imageFilePath, category?.imageContentHash);
}

export function reconcileProductImageCache(products: Product[]) {
  const assets: ImageAsset[] = [];
  const ownerPrefixes = new Set<string>();

  products.forEach((product) => {
    if (product.id == null) return;
    const prefix = `product:${product.id}:`;
    ownerPrefixes.add(prefix);
    product.images?.forEach((image) => {
      const url = productImageUrl(image);
      if (!url) return;
      assets.push({ owner: `${prefix}image:${image.id}`, url });
    });
  });

  scheduleReconciliation(assets, ownerPrefixes);
}

export function reconcileCategoryImageCache(categories: Category[]) {
  const assets: ImageAsset[] = [];
  const ownerPrefixes = new Set<string>();

  forEachCategory(categories, (category) => {
    if (category.id == null) return;
    const prefix = `category:${category.id}:`;
    ownerPrefixes.add(prefix);
    const url = categoryImageUrl(category);
    if (url) assets.push({ owner: `${prefix}image`, url });
  });

  scheduleReconciliation(assets, ownerPrefixes);
}

function forEachCategory(categories: Category[], callback: (category: Category) => void) {
  categories.forEach((category) => {
    callback(category);
    if (category.children?.length) forEachCategory(category.children, callback);
  });
}

function scheduleReconciliation(assets: ImageAsset[], ownerPrefixes: Set<string>) {
  if (!canManageImageCache()) return;

  reconciliationQueue = reconciliationQueue
    .then(() => reconcileImageCache(assets, ownerPrefixes))
    .catch((error) => console.warn("Не удалось синхронизировать кэш изображений", error));
}

async function reconcileImageCache(assets: ImageAsset[], ownerPrefixes: Set<string>) {
  const cache = await window.caches.open(IMAGE_CACHE_NAME);
  const index = readIndex();
  const currentOwners = new Set(assets.map((asset) => asset.owner));

  for (const [owner, entry] of Object.entries(index)) {
    if (
      [...ownerPrefixes].some((prefix) => owner.startsWith(prefix)) &&
      !currentOwners.has(owner)
    ) {
      await cache.delete(entry.url);
      delete index[owner];
    }
  }

  for (const asset of assets) {
    const previous = index[asset.owner];
    if (previous && previous.url !== asset.url) {
      await cache.delete(previous.url);
    }
    index[asset.owner] = { url: asset.url };
  }

  writeIndex(index);
}

function canManageImageCache() {
  return typeof window !== "undefined" && "caches" in window && window.isSecureContext;
}

function readIndex(): ImageCacheIndex {
  try {
    const raw = window.localStorage.getItem(IMAGE_CACHE_INDEX_KEY);
    return raw ? (JSON.parse(raw) as ImageCacheIndex) : {};
  } catch {
    return {};
  }
}

function writeIndex(index: ImageCacheIndex) {
  try {
    window.localStorage.setItem(IMAGE_CACHE_INDEX_KEY, JSON.stringify(index));
  } catch {
    // The cache remains usable even when persistent storage is unavailable.
  }
}
