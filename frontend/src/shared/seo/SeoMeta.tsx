import { useEffect } from "react";

type SeoMetaProps = {
  title: string;
  description: string;
  canonicalPath?: string;
  image?: string | null;
  pending?: boolean;
  robots?: "index,follow" | "noindex,follow" | "noindex,nofollow";
  structuredData?: Record<string, unknown> | Record<string, unknown>[] | null;
};

export function absoluteUrl(value: string | null | undefined) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value, window.location.origin).toString();
}

function upsertMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

function upsertCanonical(url: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.append(element);
  }
  element.href = url;
}

export function SeoMeta({
  title,
  description,
  canonicalPath,
  image,
  pending = false,
  robots = "index,follow",
  structuredData,
}: SeoMetaProps) {
  useEffect(() => {
    const canonical = new URL(
      canonicalPath ?? window.location.pathname,
      window.location.origin,
    ).toString();
    // Keep server-rendered metadata while the matching page fetches its client data.
    // A different route must replace it immediately to avoid describing the previous page.
    if (
      pending &&
      document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href === canonical
    ) {
      return;
    }
    const imageUrl =
      absoluteUrl(image) ?? new URL("/pwa-512x512.png", window.location.origin).toString();

    document.title = title;
    document.documentElement.lang = "ru";
    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", robots);
    upsertCanonical(canonical);
    upsertMeta("property", "og:locale", "ru_RU");
    const structuredItems = Array.isArray(structuredData) ? structuredData : [structuredData];
    const isProduct = structuredItems.some((item) => item?.["@type"] === "Product");
    upsertMeta("property", "og:type", isProduct ? "product" : "website");
    upsertMeta("property", "og:site_name", "Фирма «Актив»");
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", canonical);
    upsertMeta("property", "og:image", imageUrl);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", imageUrl);

    const existing = document.head.querySelector<HTMLScriptElement>(
      'script[data-seo="structured-data"]',
    );
    if (!structuredData) {
      existing?.remove();
    } else {
      const script = existing ?? document.createElement("script");
      script.type = "application/ld+json";
      script.dataset.seo = "structured-data";
      // Avoid accidentally ending the script tag when a product name or description contains HTML.
      script.textContent = JSON.stringify(structuredData).replace(/</g, "\\u003c");
      if (!existing) document.head.append(script);
    }
    return () => {
      document.head.querySelector('script[data-seo="structured-data"]')?.remove();
    };
  }, [canonicalPath, description, image, pending, robots, structuredData, title]);

  return null;
}
