/**
 * Shared TypeScript types for per-country JSON data files.
 *
 * Each country in /src/data/{code}.json must match the CountryData shape.
 */

// ── Map region data ──────────────────────────────────────────────
/**
 * A region row. Keys must match the metric keys declared in `mapMetrics`.
 * The `name` field is always present and shown in tooltip / side panel.
 */
export interface Region {
  name: string;
  [metric: string]: number | string;
}
export type RegionMap = Record<string, Region>;

// ── Map metric configuration ─────────────────────────────────────
export interface MetricConfig {
  /** Pretty label for legend + button */
  label: string;
  /** Override key shown in the side panel (defaults to label) */
  dpKey?: string;
  /** Numeric format applied to values */
  format:
    | 'currency'
    | 'currencyPerM2'
    | 'currencyPerMo'
    | 'population'
    | 'percent'
    | 'permille'
    | 'degrees'
    | 'doctors';
  /** [light, dark] gradient pair */
  colors: [string, string];
}

// ── D3 projection settings ───────────────────────────────────────
export interface ProjectionConfig {
  center: [number, number];
  scale: number;
  translate: [number, number];
}

// ── Country meta ─────────────────────────────────────────────────
export interface CountryMeta {
  code: 'pt' | 'es' | 'fr' | 'de' | 'it';
  name: string;
  flag: string;
  /** Title shown in <h1>, e.g. "Portugal by the Numbers" */
  title: string;
  /** Subtitle line under the title */
  subtitle: string;
  /** Meta description for SEO */
  description: string;
}

// ── Top-level data shape ─────────────────────────────────────────
export interface CountryData {
  meta: CountryMeta;
  /** REGIONS object keyed by region id */
  regions: RegionMap;
  /** Per-metric config used by the InteractiveMap */
  mapMetrics: Record<string, MetricConfig>;
  /** Ordered metric buttons displayed in the map control panel */
  mapButtons: { key: string; label: string }[];
  /** GeoJSON URL */
  geojsonUrl: string;
  /** D3 Mercator projection settings */
  projection: ProjectionConfig;
  /** Expression that resolves a GeoJSON feature to a REGIONS key */
  featureIdResolver: string;
  /** Singular noun used in the "Click a {x} on the map" prompt */
  regionUnit: string;
  /** Stroke colour applied to the selected region */
  strokeOnSelect: string;
  /** Map SVG viewBox */
  mapViewBox?: string;
}
