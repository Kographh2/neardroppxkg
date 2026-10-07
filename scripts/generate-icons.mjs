import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
const svg = await readFile(new URL('../public/favicon.svg', import.meta.url));
for (const size of [192, 512]) await sharp(svg).resize(size, size).png().toFile(new URL(`../public/icon-${size}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const maskable = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#2465df"/><path d="M160 355V157l192 198V157" fill="none" stroke="#fff" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/></svg>');
await sharp(maskable).png().toFile(new URL('../public/icon-maskable.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
