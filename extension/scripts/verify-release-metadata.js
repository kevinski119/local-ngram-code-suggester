const manifest = require('../package.json');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const failures = [];
if (manifest.publisher === 'pending-publisher-id') {
    failures.push('replace package.json publisher with your Marketplace publisher ID');
}
const marketplaceReadme = fs.readFileSync(
    path.resolve(__dirname, '..', 'README.md'),
    'utf8'
);
if (marketplaceReadme.includes('REPLACE_WITH_')) {
    failures.push('replace Marketplace README image placeholders with public HTTPS URLs');
}
for (const filename of ['completion-demo.gif', 'diagnostics.png', 'pack-manager.png']) {
    if (!fs.existsSync(path.resolve(__dirname, '..', 'assets', 'marketplace', filename))) {
        failures.push(`capture assets/marketplace/${filename} from a clean Extension Host`);
    }
}
const modelBytes = fs.readFileSync(
    path.resolve(__dirname, '..', 'models', 'model.json.gz')
);
const model = JSON.parse(zlib.gunzipSync(modelBytes).toString('utf8'));
if (JSON.stringify(model.corpus ?? {}).includes('REPLACE_WITH_')) {
    failures.push('replace starter-model corpus placeholders with the final public fork revision');
}
for (const [field, value] of [
    ['repository.url', manifest.repository?.url],
    ['homepage', manifest.homepage],
    ['bugs.url', manifest.bugs?.url]
]) {
    if (!value || value.includes('amest/vscode-ngram-code-suggester')) {
        failures.push(`replace ${field} with the public fork URL`);
    }
}
if (failures.length > 0) {
    console.error('Release metadata is not finalized:');
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
}
console.log('Release metadata is ready.');
