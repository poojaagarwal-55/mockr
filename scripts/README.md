# CS Fundamentals - Detailed Answer Generator

This script generates detailed explanations for CS Fundamental questions using Google's Gemini Pro API and stores them in MongoDB.

## What it does

1. Connects to your MongoDB database
2. Finds all CS Fundamental questions that don't have a `detailedAnswer` field
3. Uses Gemini Pro to generate comprehensive, educational explanations
4. Adds the `detailedAnswer` field to each document in MongoDB

## Setup

### 1. Install Python dependencies

```bash
cd scripts
pip install -r requirements.txt
```

Or if you're using Python 3:

```bash
pip3 install -r requirements.txt
```

### 2. Make sure your .env file is configured

The script reads from `apps/api/.env` and needs:
- `MONGODB_URI` - Your MongoDB connection string
- `GOOGLE_GENERATIVE_AI_API_KEY` - Your Gemini API key

## Usage

### Run the script

```bash
python generate-cs-detailed-answers.py
```

Or:

```bash
python3 generate-cs-detailed-answers.py
```

### Options

When you run the script, you'll be prompted to choose:

1. **Process all questions** - Generates detailed answers for all questions in the database
2. **Process limited number** - For testing, you can process just a few questions first

### Example Output

```
============================================================
CS Fundamentals - Detailed Answer Generator
============================================================
✅ Connected to MongoDB
📊 Total CS Fundamental questions in database: 150
📊 Found 150 questions without detailed answers

Options:
1. Process all questions
2. Process limited number (for testing)

Enter your choice (1 or 2): 2
Enter number of questions to process: 5

📝 Processing [1/5]: DBMS - What is normalization?...
✅ Updated successfully

📝 Processing [2/5]: OS - Explain process scheduling...
✅ Updated successfully

...

============================================================
✅ Processing complete!
   Processed: 5
   Failed: 0
   Total: 5
============================================================
```

## Schema Changes

The script adds a new field to the CS Fundamental questions:

```typescript
{
  topic: "CN" | "DBMS" | "OOPS" | "OS",
  question: string,
  answer: string,              // Original short answer (for AI context)
  detailedAnswer: string,      // NEW: Detailed explanation for users
  createdAt: Date,
  updatedAt: Date
}
```

## Rate Limiting

The script includes a 1-second delay between API calls to avoid hitting Gemini's rate limits.

## Notes

- The script is idempotent - it only processes questions that don't have a `detailedAnswer` field
- You can run it multiple times safely
- If it fails midway, just run it again and it will continue from where it left off
- The original `answer` field is preserved and used as context for generating the detailed answer

## After Running

Once you've generated all the detailed answers, you can:

1. Update your TypeScript model to include the `detailedAnswer` field
2. Update your API routes to return the detailed answer to users
3. Update your frontend to display the detailed explanation
4. Delete this script if you don't need it anymore

## Troubleshooting

### "MONGODB_URI not found"
Make sure your `apps/api/.env` file exists and has the `MONGODB_URI` variable.

### "GOOGLE_GENERATIVE_AI_API_KEY not found"
Make sure your `apps/api/.env` file has the `GOOGLE_GENERATIVE_AI_API_KEY` variable.

### API Rate Limit Errors
If you hit rate limits, the script will show errors. Just wait a few minutes and run it again - it will skip the already processed questions.

### Connection Timeout
If MongoDB connection times out, check your network and MongoDB URI.
