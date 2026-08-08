# Launch Checklist — angkorgit.app

Runbook for verifying and re-running the website launch at `https://angkorgit.app`.
The site is a static Astro build deployed to GitHub Pages by `.github/workflows/website.yml`.

## 1. DNS (Hostinger)

- Nameservers stay on Hostinger parking: `aurora.dns-parking.com` / `nebula.dns-parking.com`.
- In the DNS Zone Editor, the apex `@` must have **only** the four GitHub Pages A records:
  `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
- `www` is a CNAME to `cheat2001.github.io`.
- Remove any stale Hostinger parked-page record (`2.57.91.91`). If a resolver still returns it,
  it is upstream caching — TTL is 14400s (4h). Verify against Google/Cloudflare resolvers:

```bash
dig @8.8.8.8 angkorgit.app A +short
dig @1.1.1.1 angkorgit.app A +short
```

## 2. GitHub Pages

- Pages source must be **GitHub Actions** (set in repo Settings → Pages).
- Custom domain + HTTPS enforced:

```bash
gh api --method POST repos/cheat2001/angkorgit/pages -f build_type=workflow
gh api --method PUT repos/cheat2001/angkorgit/pages -f cname=angkorgit.app -F https_enforced=true
```

- The build uses `SITE_URL=https://angkorgit.app` and `SITE_BASE=/` (pinned in the workflow).
- `apps/website/public/CNAME` must contain `angkorgit.app`.

## 3. Smoke checks

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://angkorgit.app/          # 200
curl -s https://angkorgit.app/sitemap-index.xml                          # sitemapindex XML
curl -s https://angkorgit.app/robots.txt                                 # Sitemap line
curl -s https://angkorgit.app/og.png -o /dev/null -w "%{http_code}\n"    # 200
```

## 4. Search Console

- Verify via **URL-prefix property** (`https://angkorgit.app/`); the meta tag is in
  `apps/website/src/layouts/Base.astro` and is served once the deployment is live.
- Submit sitemap `sitemap-index.xml` (Sitemaps → Add a new sitemap).
- If it reports "Couldn't fetch", the fetch happened while DNS was still flapping — wait for
  DNS to settle, then Resubmit.
- Request indexing for `https://angkorgit.app/` via URL Inspection.

## 5. Housekeeping

- GitHub repo About → Website is set to `https://angkorgit.app/`.
- The temporary `https://cheat2001.github.io/angkorgit/` URL is retired.

## What "launched" looked like (2026-08)

1. Built the Astro site, added the GitHub Pages workflow, deployed.
2. Bought `angkorgit.app`, pointed DNS, deleted the stale `2.57.91.91` record.
3. Enabled Pages + custom domain + HTTPS via the CLI; deployed at root base.
4. Fixed the OG image (headline clipped at 1200px — font-size 72 → 52).
5. Added Search Console verification, JSON-LD, canonical, robots, sitemap.
6. Flushed local DNS, confirmed Google/Cloudflare resolvers clean, sitemap indexed.
