const fs = require('fs');
let page = fs.readFileSync('page.tsx', 'utf-8');

// I need to wrap the return in <> and </>
// Where is the exact return for default function Home() ?
// let's do this:
page = page.replace('return (', 'return (<>');
// Then find the LAST `  );\n}` in the file.
const lastIndex = page.lastIndexOf('  );\n}');
if (lastIndex !== -1) {
  page = page.substring(0, lastIndex) + '  </>);\n}' + page.substring(lastIndex + 7);
}

fs.writeFileSync('page.tsx', page);
