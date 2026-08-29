const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { createICNS, createICO } = require('png2icons');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'ui', 'assets', 'oryn-logo.svg');
const buildDir = path.join(root, 'build');

async function main() {
    await fs.mkdir(buildDir, { recursive: true });
    const input = await sharp(source, { density: 1024 })
        .resize(1024, 1024, { fit: 'contain' })
        .png()
        .toBuffer();

    const icns = createICNS(input, 2, 0);
    const ico = createICO(input, 2, 0, true, true);
    if (!icns || !ico) throw new Error('Icon generation returned an empty asset.');

    await fs.writeFile(path.join(buildDir, 'icon.icns'), icns);
    await fs.writeFile(path.join(buildDir, 'icon.ico'), ico);
    console.log('Generated build/icon.icns and build/icon.ico from ui/assets/oryn-logo.svg.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
