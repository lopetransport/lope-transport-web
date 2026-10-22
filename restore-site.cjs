const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'site-files.json'), 'utf8'));
if (bundle.version !== 1 || !Array.isArray(bundle.files)) throw new Error('Invalid site bundle');
const configFiles = new Set(['next.config.ts', 'postcss.config.mjs', 'tsconfig.json', 'proxy.ts']);
for (const file of bundle.files) {
  if (typeof file.path !== 'string' || typeof file.base64 !== 'string') throw new Error('Invalid site file');
  const relative = file.path;
  if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => p === '..' || p === '')) throw new Error('Unsafe site path');
  if (!configFiles.has(relative) && !['app/', 'public/', 'db/', 'components/', 'lib/'].some(prefix => relative.startsWith(prefix))) throw new Error('Unexpected site path');
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Path outside site root');
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, Buffer.from(file.base64, 'base64'));
}
console.log(`Restored ${bundle.files.length} website files.`);
