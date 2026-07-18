const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env.local');
console.log('Reading:', envPath);
console.log('Exists:', fs.existsSync(envPath));

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  
  lines.forEach((line, i) => {
    if (line.includes('WEBHOOK')) {
      console.log(`\nLine ${i + 1}:`);
      console.log('Raw:', JSON.stringify(line));
      console.log('Length:', line.length);
      
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        value = value.replace(/^["'](.*)["']$/, '$1');
        console.log('Key:', key);
        console.log('Value:', value);
      }
    }
  });
}
