const fs = require('fs');
let page = fs.readFileSync('page.tsx', 'utf-8');

page = page.replace(
  'return (\n    {/* ── Page shell ── */}\n    <div ref={mainRef} id="landing-page"',
  'return (<>\n    {/* ── Page shell ── */}\n    <div ref={mainRef} id="landing-page"'
);

const lastIndex = page.lastIndexOf(');\n}');
if (lastIndex !== -1 && page.includes('return (<>')) {
  page = page.substring(0, lastIndex) + '</>);\n}' + page.substring(lastIndex + 4);
}

fs.writeFileSync('page.tsx', page);
