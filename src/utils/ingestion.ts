export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (cleaned.length < 2) {
    return `svc-${Math.random().toString(36).slice(2, 7)}`;
  }
  return cleaned;
}

export function generateApiKey(prefix = 'sk_live_rm'): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let body = '';
  for (let i = 0; i < 32; i++) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}_${body}`;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

export function chunkText(text: string, maxChars = 1100, overlap = 140): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let cursor = 0;
  const safeOverlap = Math.min(overlap, Math.floor(maxChars / 3));

  while (cursor < normalized.length) {
    let end = Math.min(cursor + maxChars, normalized.length);
    if (end < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', end);
      const sentenceBreak = normalized.lastIndexOf('. ', end);
      const lineBreak = normalized.lastIndexOf('\n', end);
      const minBoundary = cursor + Math.floor(maxChars * 0.55);

      if (paragraphBreak >= minBoundary) {
        end = paragraphBreak + 2;
      } else if (sentenceBreak >= minBoundary) {
        end = sentenceBreak + 2;
      } else if (lineBreak >= minBoundary) {
        end = lineBreak + 1;
      }
    }

    const slice = normalized.slice(cursor, end).trim();
    if (slice) {
      chunks.push(slice);
    }

    if (end >= normalized.length) break;
    cursor = Math.max(cursor + 1, end - safeOverlap);
  }

  return chunks;
}

export function parseCsvToMarkdown(csv: string, filename: string): string {
  const lines = csv
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return '';

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1, 201).map(parseLine);

  const out: string[] = [`# Dataset: ${filename}`, `Columns: ${headers.join(', ')}`, `Total rows indexed: ${rows.length}`, ''];
  rows.forEach((row, idx) => {
    const pairs = headers
      .map((header, i) => `${header}: ${row[i] ?? ''}`)
      .join(' | ');
    out.push(`Row ${idx + 1}: ${pairs}`);
  });

  return out.join('\n');
}

export function parseJsonToMarkdown(jsonStr: string, filename: string): string {
  const parsed = JSON.parse(jsonStr);
  const lines: string[] = [`# JSON Knowledge Source: ${filename}`, ''];

  if (Array.isArray(parsed)) {
    lines.push(`Array containing ${parsed.length} items.`);
    parsed.slice(0, 150).forEach((item, idx) => {
      if (item && typeof item === 'object') {
        const summary = Object.entries(item as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join(' | ');
        lines.push(`Item ${idx + 1}: ${summary}`);
      } else {
        lines.push(`Item ${idx + 1}: ${String(item)}`);
      }
    });
  } else if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value && typeof value === 'object') {
        lines.push(`## ${key}`);
        lines.push(JSON.stringify(value, null, 2));
      } else {
        lines.push(`- ${key}: ${String(value)}`);
      }
    }
  } else {
    lines.push(String(parsed));
  }

  return lines.join('\n');
}

export function validatePostgresUri(uri: string): { valid: boolean; error?: string; redacted?: string } {
  const trimmed = uri.trim();
  if (!trimmed) {
    return { valid: false, error: 'PostgreSQL connection URI is required.' };
  }
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
    return { valid: false, error: 'URI must start with postgresql:// or postgres://' };
  }
  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname) {
      return { valid: false, error: 'PostgreSQL URI must include a valid host.' };
    }
    const dbName = parsed.pathname.replace(/^\//, '') || 'postgres';
    const user = parsed.username || 'readonly';
    const port = parsed.port || '5432';
    return {
      valid: true,
      redacted: `postgresql://${user}:***@${parsed.hostname}:${port}/${dbName}`,
    };
  } catch {
    return { valid: false, error: 'Invalid PostgreSQL URI syntax.' };
  }
}

export function validateS3PublicUrl(url: string): {
  valid: boolean;
  error?: string;
  listUrl?: string;
  baseUrl?: string;
  prefix?: string;
} {
  const trimmed = url.trim();
  if (!trimmed) {
    return { valid: false, error: 'Public S3 folder URL is required.' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'URL must use https:// or http://' };
    }

    const host = parsed.hostname.toLowerCase();
    const isS3Like =
      host.includes('.s3.') ||
      host.endsWith('.s3.amazonaws.com') ||
      host === 's3.amazonaws.com' ||
      host.includes('storage.googleapis.com');

    if (!isS3Like) {
      return {
        valid: false,
        error: 'Provide a public S3 or GCS bucket URL (e.g. https://my-bucket.s3.us-east-1.amazonaws.com/docs/).',
      };
    }

    const pathSegments = parsed.pathname.replace(/^\/+/, '');
    const baseUrl = `${parsed.protocol}//${parsed.host}`;
    const prefix = parsed.searchParams.get('prefix') ?? pathSegments;
    const listUrl = `${baseUrl}/?list-type=2${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ''}`;

    return {
      valid: true,
      listUrl,
      baseUrl,
      prefix,
    };
  } catch {
    return { valid: false, error: 'Invalid S3 URL format.' };
  }
}

export interface S3ListedObject {
  key: string;
  size: number;
  url: string;
}

export function parseS3XmlListing(xml: string, baseUrl: string): S3ListedObject[] {
  const results: S3ListedObject[] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/gi;
  let match: RegExpExecArray | null;

  while ((match = contentsRegex.exec(xml)) !== null) {
    const block = match[1];
    const keyMatch = /<Key>([\s\S]*?)<\/Key>/i.exec(block);
    const sizeMatch = /<Size>(\d+)<\/Size>/i.exec(block);
    if (!keyMatch) continue;

    const key = keyMatch[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();

    if (!key || key.endsWith('/')) continue;

    const size = sizeMatch ? Number(sizeMatch[1]) : 0;
    const encodedKey = key
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');

    results.push({
      key,
      size,
      url: `${baseUrl.replace(/\/+$/, '')}/${encodedKey}`,
    });
  }

  return results;
}

export function isBlockedHostOrIp(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }

  // IPv4 private / loopback / link-local / metadata ranges
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // Cloud metadata & link-local
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // Carrier-grade NAT
  }

  // IPv6 loopback / unique local / link-local
  if (host.includes(':')) {
    if (
      host === '::1' ||
      host.startsWith('fe80:') ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:169.254.') ||
      host.startsWith('::ffff:192.168.')
    ) {
      return true;
    }
  }

  return false;
}

export function validateWebsiteUrl(rawUrl: string): {
  valid: boolean;
  error?: string;
  normalizedUrl?: string;
  origin?: string;
  hostname?: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Website URL is required.' };
  }

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;

  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'Website URL must use https:// or http://.' };
    }
    if (isBlockedHostOrIp(parsed.hostname)) {
      return {
        valid: false,
        error: 'Private, localhost, or internal network URLs are blocked for security.',
      };
    }
    if (!parsed.hostname.includes('.')) {
      return { valid: false, error: 'Provide a public domain name (e.g. https://docs.company.com).' };
    }

    parsed.hash = '';
    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      origin: parsed.origin,
      hostname: parsed.hostname.toLowerCase(),
    };
  } catch {
    return { valid: false, error: 'Invalid website URL format.' };
  }
}

const SKIPPED_WEB_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
  '.pdf', '.zip', '.tar', '.gz', '.mp4', '.mp3', '.wav', '.mov',
  '.css', '.js', '.mjs', '.woff', '.woff2', '.ttf', '.eot', '.xml', '.json',
]);

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function isSameSiteHost(hostA: string, hostB: string): boolean {
  const a = stripWww(hostA);
  const b = stripWww(hostB);
  return Boolean(a) && a === b;
}

export function scoreUrlPriority(urlStr: string): number {
  try {
    const parsed = new URL(urlStr);
    const p = parsed.pathname.toLowerCase();
    let score = 0;

    // High-value commercial, product, pricing, and support pages
    if (/\/(pricing|price|plans|packages|tiers|billing|subscriptions|rates)\b/.test(p)) score += 120;
    if (/\/(faq|faqs|help|support|knowledge|kb)\b/.test(p)) score += 90;
    if (/\/(docs|documentation|guide|guides|api|developers|reference)\b/.test(p)) score += 85;
    if (/\/(product|products|features|solutions|platform|services|capabilities|overview)\b/.test(p)) score += 75;
    if (/\/(enterprise|security|compliance|sla|integrations|about|company|contact)\b/.test(p)) score += 55;
    if (p === '/' || p === '') score += 60;

    // Low-value / noisy paths for B2B support chatbots
    if (/\/(blog|news|press|articles|stories|podcast|events|webinars|changelog|release-notes)\b/.test(p)) score -= 50;
    if (/\/(privacy|terms|legal|cookie|cookies|gdpr|disclaimer|sitemap)\b/.test(p)) score -= 65;
    if (/\/(careers|jobs|hiring|team|press-kit)\b/.test(p)) score -= 60;
    if (/\/(login|signin|sign-in|signup|sign-up|register|auth|account|cart|checkout|reset-password)\b/.test(p)) score -= 90;
    if (/\/(tag|tags|category|categories|author|page)\//.test(p)) score -= 70;

    // Prefer shallower paths (top-level pages over deep archive slugs)
    const depth = p.split('/').filter(Boolean).length;
    score -= Math.min(depth, 6) * 6;

    return score;
  } catch {
    return -100;
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function summarizeJsonLdNode(node: unknown, out: string[], depth = 0): void {
  if (!node || depth > 5 || out.length >= 60) return;
  if (Array.isArray(node)) {
    for (const item of node) summarizeJsonLdNode(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const rawType = obj['@type'];
  const types = Array.isArray(rawType) ? rawType.map(String) : rawType ? [String(rawType)] : [];

  if (types.some((t) => /Question/i.test(t))) {
    const q = typeof obj.name === 'string' ? obj.name.trim() : '';
    const ansObj = obj.acceptedAnswer as Record<string, unknown> | undefined;
    const a = ansObj && typeof ansObj.text === 'string' ? ansObj.text.replace(/<[^>]+>/g, ' ').trim() : '';
    if (q && a) out.push(`FAQ: ${q} — ${a}`);
  } else if (types.some((t) => /Offer|PriceSpecification|UnitPriceSpecification/i.test(t))) {
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const price = obj.price ?? obj.lowPrice;
    const highPrice = obj.highPrice;
    const currency = typeof obj.priceCurrency === 'string' ? obj.priceCurrency : '';
    const desc = typeof obj.description === 'string' ? obj.description.trim() : '';
    const priceStr =
      price !== undefined
        ? `${currency ? `${currency} ` : ''}${price}${highPrice !== undefined ? ` - ${highPrice}` : ''}`
        : '';
    const parts = [name, priceStr, desc].filter(Boolean);
    if (parts.length > 0) out.push(`Pricing Offer: ${parts.join(' | ')}`);
  } else if (types.some((t) => /Product|SoftwareApplication|Service|Organization/i.test(t))) {
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const desc = typeof obj.description === 'string' ? obj.description.trim() : '';
    if (name || desc) {
      out.push(`${types[0]}: ${[name, desc].filter(Boolean).join(' — ')}`);
    }
  }

  for (const key of ['@graph', 'mainEntity', 'offers', 'hasOfferCatalog', 'itemListElement', 'priceSpecification']) {
    if (obj[key]) summarizeJsonLdNode(obj[key], out, depth + 1);
  }
}

function collectReadableStringsFromJson(val: unknown, out: string[], seen: Set<string>, depth = 0): void {
  if (!val || depth > 7 || out.length >= 120) return;
  if (typeof val === 'string') {
    const clean = val.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (
      clean.length >= 12 &&
      clean.length <= 420 &&
      !/^(https?:\/\/|\/_next\/|data:|#|true$|false$)/i.test(clean) &&
      !/^[a-z0-9_-]{24,}$/i.test(clean) &&
      !seen.has(clean)
    ) {
      seen.add(clean);
      out.push(clean);
    }
    return;
  }
  if (Array.isArray(val)) {
    for (const item of val.slice(0, 40)) {
      collectReadableStringsFromJson(item, out, seen, depth + 1);
    }
    return;
  }
  if (typeof val === 'object') {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (/^(buildId|assetPrefix|scriptLoader|__N_SSG|__N_SSP|gssp|isFallback|runtimeConfig|locale|locales|defaultLocale)$/i.test(k)) {
        continue;
      }
      collectReadableStringsFromJson(v, out, seen, depth + 1);
    }
  }
}

export function extractStructuredDataFromHtml(html: string, includeHydrationText = false): string[] {
  const lines: string[] = [];
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      summarizeJsonLdNode(parsed, lines);
    } catch {
      // Ignore invalid JSON-LD blocks
    }
  }

  if (includeHydrationText) {
    const nextDataMatch = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (nextDataMatch) {
      try {
        const parsed = JSON.parse(nextDataMatch[1].trim());
        const pageProps = parsed?.props?.pageProps ?? parsed?.props;
        if (pageProps) {
          const seen = new Set<string>(lines);
          collectReadableStringsFromJson(pageProps, lines, seen);
        }
      } catch {
        // Ignore invalid __NEXT_DATA__
      }
    }
  }

  return Array.from(new Set(lines)).slice(0, 80);
}

export function isLikelyJsShellHtml(html: string, bodyTextLength: number): boolean {
  if (bodyTextLength >= 350) return false;
  const hasAppMount = /id=["'](root|app|__next|__nuxt)["']/i.test(html);
  const hasEnableJs = /enable javascript|requires javascript|javascript is required/i.test(html);
  const scriptTags = (html.match(/<script\b/gi) ?? []).length;
  return hasEnableJs || (hasAppMount && scriptTags >= 2 && bodyTextLength < 220);
}

export interface ExtractedWebPage {
  url: string;
  title: string;
  description: string;
  text: string;
  links: string[];
  isJsShell: boolean;
}

export function extractHtmlToKnowledge(html: string, pageUrl: string): ExtractedWebPage {
  const parsedPage = new URL(pageUrl);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim()).slice(0, 120)
    : parsedPage.hostname;

  const metaDescMatch =
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html) ??
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i.exec(html) ??
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i.exec(html);
  const description = metaDescMatch ? decodeHtmlEntities(metaDescMatch[1].trim()).slice(0, 300) : '';

  // Collect same-site links (treating apex & www as same site) before stripping nav/footer
  const linkSet = new Set<string>();
  const hrefRegex = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  let hrefMatch: RegExpExecArray | null;
  while ((hrefMatch = hrefRegex.exec(html)) !== null) {
    const rawHref = hrefMatch[1].trim();
    if (!rawHref || /^(mailto:|tel:|javascript:|data:)/i.test(rawHref)) continue;
    try {
      const resolved = new URL(rawHref, parsedPage);
      if (!isSameSiteHost(resolved.hostname, parsedPage.hostname)) continue;
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
      resolved.hash = '';
      resolved.search = '';
      const pathLower = resolved.pathname.toLowerCase();
      const dotIdx = pathLower.lastIndexOf('.');
      if (dotIdx >= 0 && SKIPPED_WEB_EXTENSIONS.has(pathLower.slice(dotIdx))) continue;
      const clean = resolved.toString().replace(/\/$/, '') || resolved.origin;
      if (clean !== pageUrl.replace(/\/$/, '')) {
        linkSet.add(clean);
      }
    } catch {
      // Ignore malformed href
    }
  }

  // Strip non-content boilerplate blocks
  const cleanedHtml = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|template|canvas)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Preserve table cell separation so pricing matrices stay legible
  const withBreaks = cleanedHtml
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(h[1-6]|p|div|section|article|li|tr|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');

  const normalizedLines = decodeHtmlEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').replace(/(\s*\|\s*)+$/g, '').trim())
    .filter((line) => line.length > 0 && line !== '|');

  // Deduplicate immediate consecutive repeated lines
  const dedupedLines: string[] = [];
  for (const line of normalizedLines) {
    if (dedupedLines[dedupedLines.length - 1] !== line) {
      dedupedLines.push(line);
    }
  }

  const bodyText = dedupedLines.join('\n');
  const structuredLines = extractStructuredDataFromHtml(html, bodyText.length < 400);
  const combinedBody = [
    bodyText,
    ...(structuredLines.length > 0 ? ['', 'Structured Page Data:', ...structuredLines] : []),
  ]
    .join('\n')
    .trim();

  const isJsShell = isLikelyJsShellHtml(html, combinedBody.length);

  const headerPrefix = [
    `Page Title: ${title}`,
    `Source URL: ${pageUrl}`,
    ...(description ? [`Summary: ${description}`] : []),
    '',
  ].join('\n');

  const sortedLinks = Array.from(linkSet)
    .sort((a, b) => scoreUrlPriority(b) - scoreUrlPriority(a))
    .slice(0, 60);

  return {
    url: pageUrl,
    title,
    description,
    text: `${headerPrefix}${combinedBody}`.trim(),
    links: sortedLinks,
    isJsShell,
  };
}

export function parseSitemapIndexXml(xml: string, baseOriginOrHost: string, maxSitemaps = 4): string[] {
  if (!/<sitemapindex\b/i.test(xml)) return [];
  const baseHost = baseOriginOrHost.includes('://')
    ? new URL(baseOriginOrHost).hostname
    : baseOriginOrHost;
  const sitemaps: string[] = [];
  const locRegex = /<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xml)) !== null) {
    const raw = decodeHtmlEntities(match[1].trim());
    try {
      const parsed = new URL(raw);
      if (!isSameSiteHost(parsed.hostname, baseHost)) continue;
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      sitemaps.push(parsed.toString());
    } catch {
      // Skip invalid URL
    }
  }

  // Prefer page/main sitemaps over blog/post/author sitemaps
  return Array.from(new Set(sitemaps))
    .sort((a, b) => {
      const score = (u: string) => {
        const lower = u.toLowerCase();
        if (/post|blog|news|author|tag|category/.test(lower)) return -20;
        if (/page|main|core|product|pricing|docs/.test(lower)) return 20;
        return 0;
      };
      return score(b) - score(a);
    })
    .slice(0, maxSitemaps);
}

export function parseSitemapXml(xml: string, baseOriginOrHost: string, maxUrls = 30): string[] {
  const baseHost = baseOriginOrHost.includes('://')
    ? new URL(baseOriginOrHost).hostname
    : baseOriginOrHost;
  const urls: string[] = [];
  const locRegex = /<loc>([\s\S]*?)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xml)) !== null && urls.length < 500) {
    const raw = decodeHtmlEntities(match[1].trim());
    try {
      const parsed = new URL(raw);
      if (!isSameSiteHost(parsed.hostname, baseHost)) continue;
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      parsed.hash = '';
      const pathLower = parsed.pathname.toLowerCase();
      const dotIdx = pathLower.lastIndexOf('.');
      if (dotIdx >= 0 && SKIPPED_WEB_EXTENSIONS.has(pathLower.slice(dotIdx))) continue;
      urls.push(parsed.toString());
    } catch {
      // Skip invalid URL
    }
  }
  return Array.from(new Set(urls))
    .sort((a, b) => scoreUrlPriority(b) - scoreUrlPriority(a))
    .slice(0, maxUrls);
}


