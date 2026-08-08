import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const base = process.env.SITE_BASE || '/';

export default defineConfig({
  site: process.env.SITE_URL || 'https://angkorgit.app',
  base,
  trailingSlash: 'always',
  integrations: [sitemap()],
});
