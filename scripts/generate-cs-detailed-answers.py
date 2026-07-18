#!/usr/bin/env python3
"""
Script to generate detailed answers for CS Fundamental questions using Gemini Pro.
This script will:
1. Connect to MongoDB
2. Fetch all CS Fundamental questions
3. Generate detailed explanations using Gemini Pro
4. Add a new 'detailedAnswer' field to each document
"""

import os
import sys
from pymongo import MongoClient
import google.generativeai as genai
from dotenv import load_dotenv
import time

# Load environment variables
load_dotenv('../apps/api/.env')

# Configuration
MONGODB_URI = os.getenv('MONGODB_URI')
GOOGLE_API_KEY = os.getenv('GOOGLE_GENERATIVE_AI_API_KEY')

if not MONGODB_URI:
    print("❌ Error: MONGODB_URI not found in environment variables")
    sys.exit(1)

if not GOOGLE_API_KEY:
    print("❌ Error: GOOGLE_GENERATIVE_AI_API_KEY not found in environment variables")
    sys.exit(1)

# Configure Gemini
genai.configure(api_key=GOOGLE_API_KEY)

# System prompt for generating detailed answers
SYSTEM_PROMPT = """You are an expert computer science educator. Your task is to provide detailed, comprehensive explanations for CS fundamental questions.

Guidelines for your answers:
1. Start with a clear, concise definition or overview
2. Break down complex concepts into digestible parts
3. Use examples, analogies, or real-world scenarios where appropriate
4. Include technical details but explain them in an accessible way
5. Cover edge cases or common misconceptions if relevant
6. Use proper formatting with paragraphs for readability
7. Keep the tone educational but engaging
8. Aim for 200-400 words depending on the complexity of the topic

Format your response in a clear, structured manner with proper paragraphs."""

def connect_to_mongodb():
    """Connect to MongoDB and return the collection"""
    try:
        client = MongoClient(MONGODB_URI)
        # Use the correct database name
        db = client['mockr_questions']
        collection = db['cs_fundamental_questions']
        
        # Test the connection
        collection.find_one()
        
        print(f"✅ Connected to MongoDB")
        print(f"   Database: {db.name}")
        return collection
    except Exception as e:
        print(f"❌ Error connecting to MongoDB: {e}")
        sys.exit(1)

def generate_detailed_answer(question: str, short_answer: str, topic: str) -> str:
    """Generate a detailed answer using Gemini Pro"""
    try:
        model = genai.GenerativeModel(
            model_name='gemini-3.5-flash',
            system_instruction=SYSTEM_PROMPT
        )
        
        prompt = f"""Topic: {topic}

Question: {question}

Short Answer (for reference): {short_answer}

Please provide a detailed, comprehensive explanation for this question. Make it educational, clear, and well-structured."""

        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        print(f"❌ Error generating answer: {e}")
        return None

def process_questions(collection, limit=None):
    """Process all questions and generate detailed answers"""
    
    # Find questions that don't have detailedAnswer field yet
    query = {"detailedAnswer": {"$exists": False}}
    total_questions = collection.count_documents(query)
    
    if total_questions == 0:
        print("✅ All questions already have detailed answers!")
        return
    
    print(f"📊 Found {total_questions} questions without detailed answers")
    
    if limit:
        print(f"⚠️  Processing only first {limit} questions (limit set)")
        questions = collection.find(query).limit(limit)
    else:
        questions = collection.find(query)
    
    processed = 0
    failed = 0
    
    for doc in questions:
        question_id = doc['_id']
        question = doc['question']
        answer = doc['answer']
        topic = doc['topic']
        
        print(f"\n📝 Processing [{processed + 1}/{total_questions if not limit else min(limit, total_questions)}]: {topic} - {question[:60]}...")
        
        # Generate detailed answer
        detailed_answer = generate_detailed_answer(question, answer, topic)
        
        if detailed_answer:
            # Update the document
            try:
                collection.update_one(
                    {"_id": question_id},
                    {"$set": {"detailedAnswer": detailed_answer}}
                )
                print(f"✅ Updated successfully")
                processed += 1
            except Exception as e:
                print(f"❌ Error updating document: {e}")
                failed += 1
        else:
            print(f"❌ Failed to generate answer")
            failed += 1
        
        # Rate limiting - wait 1 second between requests to avoid hitting API limits
        if processed < total_questions:
            time.sleep(1)
    
    print(f"\n{'='*60}")
    print(f"✅ Processing complete!")
    print(f"   Processed: {processed}")
    print(f"   Failed: {failed}")
    print(f"   Total: {processed + failed}")
    print(f"{'='*60}")

def main():
    """Main function"""
    print("="*60)
    print("CS Fundamentals - Detailed Answer Generator")
    print("="*60)
    
    # Connect to MongoDB
    collection = connect_to_mongodb()
    
    # Check total questions
    total = collection.count_documents({})
    print(f"📊 Total CS Fundamental questions in database: {total}")
    
    # Ask user if they want to process all or limit
    print("\nOptions:")
    print("1. Process all questions")
    print("2. Process limited number (for testing)")
    
    choice = input("\nEnter your choice (1 or 2): ").strip()
    
    if choice == "2":
        limit = int(input("Enter number of questions to process: ").strip())
        process_questions(collection, limit=limit)
    else:
        confirm = input(f"\n⚠️  This will process {total} questions. Continue? (yes/no): ").strip().lower()
        if confirm == 'yes':
            process_questions(collection)
        else:
            print("❌ Cancelled by user")
            sys.exit(0)

if __name__ == "__main__":
    main()
