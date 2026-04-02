import path from "node:path";

export function normalizeZulipEmojiName(raw?: string | null): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/^:+|:+$/g, "");
}

export function extractZulipUploadUrls(html: string, baseUrl: string): string[] {
  if (!html) {
    return [];
  }
  let baseOrigin = "";
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    baseOrigin = "";
  }
  const matches = html.matchAll(
    /(?:https?:\/\/[^\s"'<>)]+)?\/user_uploads\/\d+\/[a-zA-Z0-9_-]+\/[^\s"'<>)]+/g,
  );
  const urls = new Set<string>();
  for (const match of matches) {
    const raw = match[0];
    try {
      const absolute = new URL(raw, baseUrl);
      if (baseOrigin && absolute.origin !== baseOrigin) continue;
      if (!absolute.pathname.includes("/user_uploads/")) continue;
      urls.add(absolute.toString());
    } catch {
      // ignore malformed URLs
    }
  }
  return Array.from(urls);
}

function resolveFilename(url: string, contentDisposition?: string | null): string {
  let filename = "";
  if (contentDisposition) {
    const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (encodedMatch?.[1]) {
      filename = decodeURIComponent(encodedMatch[1]);
    } else {
      const match = contentDisposition.match(/filename="?([^";]+)"?/i);
      if (match?.[1]) {
        filename = match[1];
      }
    }
  }

  if (!filename) {
    try {
      const parsed = new URL(url);
      const base = path.basename(parsed.pathname);
      if (base) {
        filename = base;
      }
    } catch {
      // ignore
    }
  }

  if (!filename) {
    filename = "upload.bin";
  }

  return path.basename(filename);
}

export async function downloadZulipUpload(
  url: string,
  baseUrl: string,
  authHeader: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const baseOrigin = new URL(baseUrl).origin;
  const target = new URL(url);
  if (target.origin !== baseOrigin || !target.pathname.includes("/user_uploads/")) {
    throw new Error("Refusing to download Zulip upload from non-Zulip origin");
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${authHeader}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Zulip upload download failed: ${res.status} ${res.statusText}`);
  }
  const contentLength = res.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (!Number.isNaN(length) && length > maxBytes) {
      throw new Error(`Zulip upload exceeds max size (${length} > ${maxBytes})`);
    }
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(`Zulip upload exceeds max size (${buffer.length} > ${maxBytes})`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const filename = resolveFilename(url, res.headers.get("content-disposition"));
  return { buffer, contentType, filename };
}
