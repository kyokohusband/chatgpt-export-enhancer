// node tests/icon-audit.js <directory-with-exported-html>
const fs = require('node:fs');
const path = require('node:path');
const library = require('../../desktop/app/lucide-icons.json');
const root = process.argv[2];
const missing = new Map();
const colors = new Map();
for (const name of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  const match = html.match(/<script id="wb-widget-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) continue;
  for (const source of JSON.parse(match[1])) {
    for (const icon of source.matchAll(/<icon\b[^>]*?\bname="([^"]+)"[^>]*>/g)) {
      if (!library[icon[1]]) missing.set(icon[1], (missing.get(icon[1]) || 0) + 1);
      const color = /\bcolor="([^"]+)"/.exec(icon[0]);
      if (color) colors.set(color[1], (colors.get(color[1]) || 0) + 1);
    }
  }
}
console.log('Missing icon names:', [...missing].sort((a, b) => b[1] - a[1]));
console.log('Icon colors:', [...colors].sort((a, b) => b[1] - a[1]));
