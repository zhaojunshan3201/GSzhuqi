import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const directory = dirname(fileURLToPath(import.meta.url));

const jobs = [
  {
    input: 'figure-1-three-tier-control-architecture.svg',
    output: 'figure-1-three-tier-control-architecture.png',
    height: 1329,
  },
  {
    input: 'figure-2-three-tier-collaboration-example.svg',
    output: 'figure-2-three-tier-collaboration-example.png',
    height: 1264,
  },
];

for (const { input, output, height } of jobs) {
  await sharp(join(directory, input), { density: 300 })
    .resize({ width: 2400, height, fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toFile(join(directory, output));
}
