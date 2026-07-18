import fs from 'fs/promises';
import path from 'path';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const uri = "mongodb://dev_mockr_db:qtlAZxCvCv7I35Au@ac-tnutkir-shard-00-00.vfcgzov.mongodb.net:27017,ac-tnutkir-shard-00-01.vfcgzov.mongodb.net:27017,ac-tnutkir-shard-00-02.vfcgzov.mongodb.net:27017/?authSource=admin&replicaSet=atlas-f2kvuz-shard-0&tls=true";

if (!uri) {
  console.error('MONGODB_URI is not set in .env');
  process.exit(1);
}

const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const database = client.db('mockr_questions');
    const collection = database.collection('sql_questions');

    const folderPath = path.join(__dirname, 'Questions', 'SQL_questions');
    const files = await fs.readdir(folderPath);

    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    console.log(`Found ${jsonFiles.length} JSON files in ${folderPath}.`);

    let docsToInsert = [];

    for (const file of jsonFiles) {
      const filePath = path.join(folderPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      try {
        const json = JSON.parse(content);
        // Replace missing fields with null. Let's make sure it handles generic keys 
        // that are undefined or absent by replacing undefined inside the object?
        // JSON parse doesn't produce undefined, but if any specific fields from the schema are absent we make them null.
        // Actually, the user says "if any field is absent, make it null." If the schema fields are not explicitly provided by the user, we'll traverse known keys from the files and set missing to null.
        // Or simply define all known keys across all files and set to null if missing.
        docsToInsert.push(json);
      } catch (err) {
        console.error(`Error parsing JSON from ${file}:`, err);
      }
    }

    if (docsToInsert.length === 0) {
      console.log('No documents to insert.');
      return;
    }

    // Determine all unique keys across all documents to act as "the schema"
    const allKeys = new Set();
    for (const doc of docsToInsert) {
      Object.keys(doc).forEach(k => allKeys.add(k));
    }

    // Assign null to missing keys for each document
    for (const doc of docsToInsert) {
      for (const key of allKeys) {
        if (doc[key] === undefined) {
          doc[key] = null;
        }
      }
    }

    const insertResult = await collection.insertMany(docsToInsert, { ordered: false }).catch(err => {
      console.log(`Some documents had duplicate keys, inserted ${err.result?.insertedCount ?? 0} new documents out of remaining.`);
      return err.result;
    });
    console.log(`Inserted ${insertResult.insertedCount} documents successfully.`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

run();