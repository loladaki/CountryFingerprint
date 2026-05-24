// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// GitHub Pages config:
//   - Repo at github.com/loladaki/CountryFingerprint
//   - Pages serves from https://loladaki.github.io/CountryFingerprint/
//   - So `site` is the full domain, `base` is the repo subpath.
//
// To deploy at a custom domain later, switch `site` to the domain
// and set `base: '/'`.
export default defineConfig({
  site: 'https://loladaki.github.io',
  base: '/CountryFingerprint',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    format: 'file',     // /portugal.html instead of /portugal/index.html
    assets: 'assets',
  },
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.9,
    }),
  ],
});
