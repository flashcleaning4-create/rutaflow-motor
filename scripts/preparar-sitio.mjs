// Monta la carpeta que se publica en Cloudflare Pages (site/):
//   site/                 página de prueba (prueba/)
//   site/motor/           motor de rutas (WebAssembly) y su API
//   site/teselas/<id>/    mapa de carreteras de España, comprimido (.gph.gz)
//   site/teselas/manifest.json   lista de teselas y versión
//   site/_headers         cabeceras (CORS y caché)
//
// Uso: node scripts/preparar-sitio.mjs <carpeta-teselas> <carpeta-motor>
// Sin dependencias: solo Node 22.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const [tilesDir = 'work/tiles', motorDir = 'engine'] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const site = path.join(root, 'site');

// Límites del plan gratuito de Cloudflare Pages.
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(site, { recursive: true });

// 1. Página de prueba
fs.cpSync(path.join(root, 'prueba'), site, { recursive: true });

// 2. Motor: dist/valhalla.mjs + valhalla.wasm y lib/ (API en JS).
const motorOut = path.join(site, 'motor');
fs.mkdirSync(path.join(motorOut, 'dist'), { recursive: true });
fs.mkdirSync(path.join(motorOut, 'lib'), { recursive: true });
for (const f of ['valhalla.mjs', 'valhalla.wasm']) {
  fs.copyFileSync(path.join(motorDir, 'dist', f), path.join(motorOut, 'dist', f));
}
for (const f of ['index.js', 'tiles.js']) {
  fs.copyFileSync(path.join(motorDir, 'lib', f), path.join(motorOut, 'lib', f));
}
// La API importa la configuración como JSON ("import ... with { type: 'json' }"),
// que no todos los navegadores admiten en un worker: se incrusta.
{
  const indexPath = path.join(motorOut, 'lib', 'index.js');
  const config = fs.readFileSync(path.join(motorDir, 'lib', 'default-config.json'), 'utf8');
  let js = fs.readFileSync(indexPath, 'utf8');
  const re = /import\s+defaultConfig\s+from\s+["']\.\/default-config\.json["']\s+with\s*\{\s*type:\s*["']json["']\s*\};?/;
  if (!re.test(js)) throw new Error('No se encontró la importación de default-config.json en lib/index.js');
  js = js.replace(re, `const defaultConfig = ${config.trim()};`);
  fs.writeFileSync(indexPath, js);
}

// 3. Teselas comprimidas, en una carpeta con el id de esta construcción.
const tiles = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.gph')) tiles.push(p);
  }
}
for (const level of ['0', '1', '2']) {
  const d = path.join(tilesDir, level);
  if (fs.existsSync(d)) walk(d);
}
if (tiles.length === 0) throw new Error(`No hay teselas en ${tilesDir}`);
tiles.sort();

const hash = crypto.createHash('sha256');
for (const t of tiles) {
  const st = fs.statSync(t);
  hash.update(`${path.relative(tilesDir, t)}:${st.size}:${st.mtimeMs}`);
}
const build = new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + hash.digest('hex').slice(0, 8);
const tilesOut = path.join(site, 'teselas', build);

const manifest = {
  build,
  valhalla: fs.readFileSync(path.join(motorDir, 'VALHALLA_VERSION'), 'utf8').trim(),
  createdAt: new Date().toISOString(),
  base: `teselas/${build}/`,
  tiles: {},
};
let rawBytes = 0;
let gzBytes = 0;
let biggest = { path: '', bytes: 0 };
for (const t of tiles) {
  const rel = path.relative(tilesDir, t).split(path.sep).join('/');
  const raw = fs.readFileSync(t);
  const gz = zlib.gzipSync(raw, { level: 9 });
  const out = path.join(tilesOut, `${rel}.gz`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, gz);
  manifest.tiles[rel] = gz.length;
  rawBytes += raw.length;
  gzBytes += gz.length;
  if (gz.length > biggest.bytes) biggest = { path: rel, bytes: gz.length };
}
fs.writeFileSync(path.join(site, 'teselas', 'manifest.json'), JSON.stringify(manifest));

// 4. Cabeceras
fs.writeFileSync(
  path.join(site, '_headers'),
  [
    '/teselas/manifest.json',
    '  Access-Control-Allow-Origin: *',
    '  Cache-Control: no-cache',
    '/teselas/*',
    '  Access-Control-Allow-Origin: *',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/motor/*',
    '  Access-Control-Allow-Origin: *',
    '  Cache-Control: public, max-age=3600',
    '/*',
    '  X-Content-Type-Options: nosniff',
    '',
  ].join('\n')
);

// 5. Comprobaciones de los límites gratuitos
let count = 0;
let tooBig = [];
(function countAll(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) countAll(p);
    else {
      count++;
      const size = fs.statSync(p).size;
      if (size > MAX_FILE_BYTES) tooBig.push(`${path.relative(site, p)} (${(size / 1048576).toFixed(1)} MB)`);
    }
  }
})(site);

const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;
console.log(`Construcción ${build}`);
console.log(`Teselas: ${tiles.length} (${mb(rawBytes)} sin comprimir, ${mb(gzBytes)} comprimidas)`);
console.log(`Tesela más grande: ${biggest.path} (${(biggest.bytes / 1048576).toFixed(1)} MB comprimida)`);
console.log(`Archivos a publicar: ${count} (máximo ${MAX_FILES})`);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Mapa de carreteras\n- Construcción: \`${build}\`\n- Teselas: ${tiles.length} (${mb(gzBytes)} comprimidas)\n- Más grande: ${biggest.path} (${(biggest.bytes / 1048576).toFixed(1)} MB)\n- Archivos a publicar: ${count}\n`
  );
}
if (count > MAX_FILES) {
  console.error(`Demasiados archivos para Cloudflare Pages: ${count} > ${MAX_FILES}`);
  process.exit(1);
}
if (tooBig.length) {
  console.error(`Archivos de más de 25 MB (Cloudflare Pages no los admite):\n${tooBig.join('\n')}`);
  process.exit(1);
}
