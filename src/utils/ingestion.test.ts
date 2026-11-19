import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  chunkText,
  parseCsvToMarkdown,
  parseJsonToMarkdown,
  parseS3XmlListing,
  validatePostgresUri,
  validateS3PublicUrl,
  validateWebsiteUrl,
  extractHtmlToKnowledge,
  parseSitemapXml,
  parseSitemapIndexXml,
  scoreUrlPriority,
  isSameSiteHost,
  estimateTokens,
} from './ingestion';

test('slugify produces URL-safe lowercase slugs', () => {
  assert.equal(slugify('Meridian Logistics Corp!'), 'meridian-logistics-corp');
  assert.equal(slugify('  Billing & SLA Bot 2.0  '), 'billing-sla-bot-2-0');
  assert.ok(slugify('!').startsWith('svc-'));
});

test('chunkText splits long documents with bounded overlap', () => {
  const longDoc = Array.from({ length: 12 }, (_, i) =>
    `Paragraph ${i + 1}: Meridian Logistics provides 24/7 freight customs clearance across North America and EU corridors with guaranteed 4-hour SLA response times.`
  ).join('\n\n');

  const chunks = chunkText(longDoc, 450, 80);
  assert.ok(chunks.length >= 4);
  for (const c of chunks) {
    assert.ok(c.length <= 460);
    assert.ok(c.length > 0);
  }
});

test('parseCsvToMarkdown handles quoted values and headers', () => {
  const csv = 'sku,name,price\n"SKU-100","Cold-Chain Pallet, Large",420\n"SKU-200","Air Freight Crate",185';
  const md = parseCsvToMarkdown(csv, 'catalog.csv');
  assert.match(md, /Columns: sku, name, price/);
  assert.match(md, /Cold-Chain Pallet, Large/);
  assert.match(md, /Row 2: sku: SKU-200/);
});

test('parseJsonToMarkdown serializes structured arrays and objects', () => {
  const json = JSON.stringify([{ region: 'EU-West', slaHours: 4 }, { region: 'US-East', slaHours: 2 }]);
  const md = parseJsonToMarkdown(json, 'slas.json');
  assert.match(md, /Array containing 2 items/);
  assert.match(md, /region: EU-West \| slaHours: 4/);
});

test('parseS3XmlListing extracts public files and skips directory keys', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <ListBucketResult>
      <Contents><Key>docs/</Key><Size>0</Size></Contents>
      <Contents><Key>docs/onboarding-guide.md</Key><Size>2048</Size></Contents>
      <Contents><Key>docs/pricing/2026 rates.csv</Key><Size>4096</Size></Contents>
    </ListBucketResult>`;
  const files = parseS3XmlListing(xml, 'https://acme-public.s3.us-east-1.amazonaws.com');
  assert.equal(files.length, 2);
  assert.equal(files[0].key, 'docs/onboarding-guide.md');
  assert.equal(files[0].url, 'https://acme-public.s3.us-east-1.amazonaws.com/docs/onboarding-guide.md');
  assert.equal(files[1].url, 'https://acme-public.s3.us-east-1.amazonaws.com/docs/pricing/2026%20rates.csv');
});

test('validatePostgresUri accepts valid URIs and redacts password', () => {
  const ok = validatePostgresUri('postgresql://readonly_bot:s3cr3t@db.meridian.io:5432/logistics');
  assert.equal(ok.valid, true);
  assert.equal(ok.redacted, 'postgresql://readonly_bot:***@db.meridian.io:5432/logistics');

  const bad = validatePostgresUri('mysql://root:pass@localhost/test');
  assert.equal(bad.valid, false);
});

test('validateS3PublicUrl builds ListObjectsV2 URL and rejects non-bucket hosts', () => {
  const ok = validateS3PublicUrl('https://meridian-docs.s3.us-east-1.amazonaws.com/policies/');
  assert.equal(ok.valid, true);
  assert.equal(ok.prefix, 'policies/');
  assert.equal(ok.listUrl, 'https://meridian-docs.s3.us-east-1.amazonaws.com/?list-type=2&prefix=policies%2F');

  const bad = validateS3PublicUrl('https://example.com/random');
  assert.equal(bad.valid, false);
});

test('estimateTokens returns positive integer estimates', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('Hello world from UAL'), 5);
});

test('validateWebsiteUrl normalizes public domains and blocks SSRF targets', () => {
  const bare = validateWebsiteUrl('docs.example.com/pricing');
  assert.equal(bare.valid, true);
  assert.equal(bare.normalizedUrl, 'https://docs.example.com/pricing');

  assert.equal(validateWebsiteUrl('http://localhost:3000/admin').valid, false);
  assert.equal(validateWebsiteUrl('http://127.0.0.1/secret').valid, false);
  assert.equal(validateWebsiteUrl('http://169.254.169.254/computeMetadata/v1/').valid, false);
  assert.equal(validateWebsiteUrl('http://10.0.0.5/internal').valid, false);
  assert.equal(validateWebsiteUrl('http://192.168.1.10/').valid, false);
  assert.equal(validateWebsiteUrl('http://metadata.google.internal/').valid, false);
  assert.equal(validateWebsiteUrl('file:///etc/passwd').valid, false);
});

test('isSameSiteHost matches apex and www variants only', () => {
  assert.equal(isSameSiteHost('example.com', 'www.example.com'), true);
  assert.equal(isSameSiteHost('www.example.com', 'example.com'), true);
  assert.equal(isSameSiteHost('docs.example.com', 'example.com'), false);
  assert.equal(isSameSiteHost('evil-example.com', 'example.com'), false);
});

test('scoreUrlPriority ranks pricing and faq above blog and privacy pages', () => {
  assert.ok(scoreUrlPriority('https://acme.com/pricing') > scoreUrlPriority('https://acme.com/blog/2026-update'));
  assert.ok(scoreUrlPriority('https://acme.com/faq') > scoreUrlPriority('https://acme.com/privacy'));
  assert.ok(scoreUrlPriority('https://acme.com/plans') > scoreUrlPriority('https://acme.com/login'));
});

test('extractHtmlToKnowledge strips boilerplate, extracts JSON-LD offers, and prioritizes links', () => {
  const html = `
    <html>
      <head>
        <title>Acme Pricing &amp; SLAs</title>
        <meta name="description" content="Enterprise plans with 99.95% SLA." />
        <style>body { color: red; }</style>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Acme Cloud",
            "offers": {
              "@type": "Offer",
              "name": "Pro Plan",
              "price": "199",
              "priceCurrency": "USD"
            }
          }
        </script>
      </head>
      <body>
        <nav>
          <a href="/privacy">Privacy</a>
          <a href="/docs/getting-started">Docs</a>
          <a href="https://www.acme.example.com/faq">FAQ</a>
          <a href="https://external.org/out">Out</a>
        </nav>
        <main>
          <h1>Enterprise Pricing</h1>
          <table><tr><th>Tier</th><th>Price</th></tr><tr><td>Starter</td><td>$99/month</td></tr></table>
          <a href="/security">Security Overview</a>
          <a href="/logo.png">Logo</a>
        </main>
        <script>console.log("ignore me");</script>
        <footer>Copyright Acme</footer>
      </body>
    </html>
  `;
  const page = extractHtmlToKnowledge(html, 'https://acme.example.com/pricing');
  assert.equal(page.title, 'Acme Pricing & SLAs');
  assert.match(page.text, /Enterprise Pricing/);
  assert.match(page.text, /Starter \| \$99\/month/);
  assert.match(page.text, /Pricing Offer: Pro Plan \| USD 199/);
  assert.doesNotMatch(page.text, /ignore me/);
  assert.doesNotMatch(page.text, /Copyright Acme/);
  assert.equal(page.links[0], 'https://www.acme.example.com/faq');
  assert.ok(page.links.indexOf('https://acme.example.com/docs/getting-started') < page.links.indexOf('https://acme.example.com/privacy'));
});

test('parseSitemapIndexXml and parseSitemapXml prioritize pricing over blog posts', () => {
  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
    <sitemapindex>
      <sitemap><loc>https://www.acme.example.com/blog-sitemap.xml</loc></sitemap>
      <sitemap><loc>https://www.acme.example.com/page-sitemap.xml</loc></sitemap>
    </sitemapindex>`;
  const childMaps = parseSitemapIndexXml(indexXml, 'https://acme.example.com', 4);
  assert.equal(childMaps[0], 'https://www.acme.example.com/page-sitemap.xml');

  const urlsetXml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset>
      <url><loc>https://www.acme.example.com/blog/launch-post</loc></url>
      <url><loc>https://www.acme.example.com/privacy-policy</loc></url>
      <url><loc>https://www.acme.example.com/pricing</loc></url>
      <url><loc>https://www.acme.example.com/docs/api</loc></url>
      <url><loc>https://other.example.com/ignored</loc></url>
      <url><loc>https://www.acme.example.com/banner.png</loc></url>
    </urlset>`;
  const urls = parseSitemapXml(urlsetXml, 'https://acme.example.com', 10);
  assert.equal(urls[0], 'https://www.acme.example.com/pricing');
  assert.equal(urls[1], 'https://www.acme.example.com/docs/api');
  assert.equal(urls.includes('https://other.example.com/ignored'), false);
});


