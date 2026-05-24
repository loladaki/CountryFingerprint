# EU Stats — Astro frontend

Static site generator powering [loladaki.github.io/CountryFingerprint](https://loladaki.github.io/CountryFingerprint).

## Architecture

```
site/
├── src/
│   ├── layouts/      Reusable page layouts (BaseLayout, CountryLayout)
│   ├── components/   UI components (Eubar, MetricCard, ChartCard, …)
│   ├── pages/        One file per route (index, portugal, spain, …)
│   ├── data/         Per-country JSON data + TS types
│   └── styles/       Global CSS variables and shared styles
├── public/           Static assets served at /
├── dist/             Build output (gitignored)
└── astro.config.mjs  Astro configuration
```

## Development

```bash
cd site
npm install
npm run dev      # http://localhost:4321/CountryFingerprint
```

## Build

```bash
npm run build    # Outputs to site/dist/
npm run preview  # Preview the production build
```

## Deployment

The site is deployed automatically via GitHub Actions on push to `main`.
See `.github/workflows/deploy.yml`.

## Backend API

The live data (fuel, Brent, Eurostat, INSEE, INE, ECB, Euribor) comes from a
Node.js Express API hosted on Render: `https://countryfingerprint.onrender.com`.

The frontend works offline-first: if the API is unavailable, static fallbacks
in `src/data/{country}.json` keep every page useful.
