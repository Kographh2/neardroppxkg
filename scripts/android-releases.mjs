import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const directory = 'public/android/releases';
await mkdir(directory, { recursive: true });
const releases = [];
for (const file of await readdir(directory)) {
  if (!file.endsWith('.apk')) continue;
  const match = /^neardrop-(\d+\.\d+\.\d+)\.apk$/.exec(file);
  if (!match) throw new Error('APK filename must be neardrop-MAJOR.MINOR.PATCH.apk');
  const bytes = await readFile(join(directory, file));
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('APK must be a valid ZIP/APK container: ' + file);
  const info = await stat(join(directory, file));
  releases.push({ version: match[1], url: '/android/releases/' + file, size: info.size, sha256: createHash('sha256').update(bytes).digest('hex') });
}
releases.sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
await mkdir('src/generated', { recursive: true });
await writeFile('src/generated/android-releases.json', JSON.stringify(releases, null, 2) + '\n');
console.info('Android release catalog: ' + releases.length + ' APKs.');
