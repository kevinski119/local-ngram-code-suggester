const fs = require('node:fs');
const path = require('node:path');

for (const filename of ['LICENSE', 'CHANGELOG.md', 'SUPPORT.md', 'SECURITY.md']) {
    fs.copyFileSync(
        path.resolve(__dirname, '..', '..', filename),
        path.resolve(__dirname, '..', filename)
    );
}
