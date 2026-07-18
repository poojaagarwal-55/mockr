const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: 'E:/Hackathon/practers/.env' });

function splitDescriptionAndSchema(text) {
  if (!text || typeof text !== 'string') return { description: text || '', schema: '' };
  const lines = text.split('\n');
  const tableStart = lines.findIndex((l) => /^\s*\*?\*?Table\s*:/i.test(l.trim()));
  if (tableStart === -1) return { description: text.trim(), schema: '' };
  const description = lines.slice(0, tableStart).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const schema = lines.slice(tableStart).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { description, schema };
}

(async () => {
  const dir = 'E:/Hackathon/practers/Questions/SQL_questions';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const localTitles = new Set(files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).title));

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const coll = client.db('mockr_questions').collection('sql_questions');
  const docs = await coll.find({}, { projection: { title: 1, description: 1, schema: 1 } }).toArray();
  const targets = docs.filter((d) => d.title && !localTitles.has(d.title));

  let updated = 0;
  for (const d of targets) {
    const existingSchema = (d.schema || '').trim();
    if (existingSchema) continue;
    const { description, schema } = splitDescriptionAndSchema(d.description || '');
    if (!schema) continue;
    await coll.updateOne({ _id: d._id }, { $set: { description, schema } });
    updated++;
    console.log('Updated:', d.title);
  }

  const remaining = await coll.countDocuments({ $or: [{ schema: { $exists: false } }, { schema: '' }, { schema: null }] });
  console.log('\nUpdated missing set:', updated);
  console.log('Total docs still missing schema:', remaining);

  await client.close();
})();
