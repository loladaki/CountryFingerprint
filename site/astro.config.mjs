// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages config:
//   - User has the repo at github.com/loladaki/CountryFingerprint
//   - Pages will serve from https://loladaki.github.io/CountryFingerprint/
//   - So `site` is the full domain, `base` is the repo subpath.
//
// To deploy at a custom domain later, switch `site` to the domain and set
// `base: '/'`.
//
// Sitemap integration is added in Phase H (SEO polish) — for now we keep
// the build minimal so the scaffold is verifiable.
export default defineConfig({
  site: 'https://loladaki.github.io',
  base: '/CountryFingerprint',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    format: 'file',     // /portugal.html instead of /portugal/index.html
    assets: 'assets',
  },
});
