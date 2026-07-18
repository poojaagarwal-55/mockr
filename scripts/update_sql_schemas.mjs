import fs from 'fs/promises';
import path from 'path';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const uri = process.env.MONGODB_URI || "mongodb://dev_mockr_db:qtlAZxCvCv7I35Au@ac-tnutkir-shard-00-00.vfcgzov.mongodb.net:27017,ac-tnutkir-shard-00-01.vfcgzov.mongodb.net:27017,ac-tnutkir-shard-00-02.vfcgzov.mongodb.net:27017/?authSource=admin&replicaSet=atlas-f2kvuz-shard-0&tls=true";

const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const database = client.db('mockr_questions');
    const collection = database.collection('sql_questions');

    const folderPath = path.join(__dirname, 'Questions', 'SQL_questions');
    const files = await fs.readdir(folderPath);

    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    console.log(`Updating ${jsonFiles.length} JSON files in the database.`);

    for (const file of jsonFiles) {
      const filePath = path.join(folderPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      try {
        const json = JSON.parse(content);
        
        // Update the document in MongoDB
        // Assuming title or 'id' can uniquely identify the question.
        await collection.updateOne(
          { title: json.title },
          { 
              $set: { 
                  description: json.description,
                  schema: json.schema
              } 
          }
        );
        console.log(`Updated schema for: ${json.title}`);
      } catch (err) {
        console.error(`Error parsing JSON or updating ${file}:`, err);
      }
    }

    console.log(`Update process completed successfully.`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

run();