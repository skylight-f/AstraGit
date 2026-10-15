import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const manifestPath = 'apps/desktop/build/icon-manifest.json';
const paths = [
  'apps/desktop/build/icon.svg',
  'scripts/generate-icons.mjs',
  'scripts/render-icon.swift',
  'apps/desktop/build/icon.png',
  'apps/desktop/build/icon.icns',
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function pngImageData(png) {
  const image = [];
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error('应用 PNG 数据不完整。');
    const size = png.readUInt32BE(offset);
    if (offset + size + 12 > png.length) throw new Error('应用 PNG 数据长度无效。');
    const type = png.toString('ascii', offset + 4, offset + 8);
    const bytes = png.subarray(offset + 8, offset + 8 + size);
    if (['IHDR', 'sRGB', 'iCCP', 'gAMA', 'cHRM'].includes(type)) image.push(Buffer.from(type), bytes);
    if (type === 'IDAT') compressed.push(bytes);
    offset += size + 12;
  }
  // iconutil 会改写 EXIF 元数据；核对颜色描述和解压后的图像数据。
  return Buffer.concat([...image, inflateSync(Buffer.concat(compressed), { maxOutputLength: 4_195_328 })]);
}

async function readAssets(directory) {
  const entries = await Promise.all(paths.map(async path => [path, await readFile(join(directory, path))]));
  const assets = Object.fromEntries(entries);
  const png = assets['apps/desktop/build/icon.png'];
  if (!png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || png.length < 33
    || png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024 || png[25] !== 6) {
    throw new Error('应用 PNG 必须是 1024px RGBA 图像。');
  }
  const icns = assets['apps/desktop/build/icon.icns'];
  if (icns.length < 8 || icns.toString('ascii', 0, 4) !== 'icns' || icns.readUInt32BE(4) !== icns.length) {
    throw new Error('应用 ICNS 格式或长度无效。');
  }
  const representations = new Map();
  for (let offset = 8; offset < icns.length;) {
    if (offset + 8 > icns.length) throw new Error('应用 ICNS 图层头不完整。');
    const size = icns.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > icns.length) throw new Error('应用 ICNS 图层长度无效。');
    representations.set(icns.toString('ascii', offset, offset + 4), icns.subarray(offset + 8, offset + size));
    offset += size;
  }
  for (const type of ['ic04', 'ic05', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14']) {
    if (!representations.has(type)) throw new Error(`应用 ICNS 缺少图层 ${type}。`);
  }
  if (!pngImageData(representations.get('ic10')).equals(pngImageData(png))) throw new Error('应用 ICNS 的 1024px 图层与 PNG 不一致，请重新生成图标。');
  return { schemaVersion: 1, sha256: Object.fromEntries(entries.map(([path, bytes]) => [path, digest(bytes)])) };
}

export async function writeIconManifest(directory = root) {
  const manifest = await readAssets(directory);
  await writeFile(join(directory, manifestPath), JSON.stringify(manifest, null, 2) + '\n');
}

export async function verifyIconAssets(directory = root) {
  const actual = await readAssets(directory);
  const expected = JSON.parse(await readFile(join(directory, manifestPath), 'utf8'));
  if (expected.schemaVersion !== actual.schemaVersion
    || Object.keys(expected.sha256 ?? {}).length !== paths.length
    || paths.some(path => actual.sha256[path] !== expected.sha256[path])) {
    throw new Error('图标设计源或生成资源不同步，请在 macOS 执行 pnpm icons:generate 并提交完整资源。');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyIconAssets();
  console.info('应用图标源、PNG、ICNS 与尺寸图层校验通过。');
}
