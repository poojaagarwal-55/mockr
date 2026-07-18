#!/usr/bin/env python3
"""
Quick test script to verify MongoDB and Gemini API connections
"""

import os
import sys
from pymongo import MongoClient
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv('../apps/api/.env')

print("="*60)
print("Connection Test Script")
print("="*60)

# Test MongoDB
print("\n1. Testing MongoDB connection...")
MONGODB_URI = os.getenv('MONGODB_URI')
if not MONGODB_URI:
    print("❌ MONGODB_URI not found in .env")
    sys.exit(1)

try:
    client = MongoClient(MONGODB_URI)
    # Use the correct database name
    db = client['mockr_questions']
    collection = db['cs_fundamental_questions']
    
    # Test the connection
    count = collection.count_documents({})
    
    print(f"✅ MongoDB connected successfully")
    print(f"   Database: {db.name}")
    print(f"   Found {count} CS Fundamental questions")
except Exception as e:
    print(f"❌ MongoDB connection failed: {e}")
    sys.exit(1)

# Test Gemini API
print("\n2. Testing Gemini API...")
GOOGLE_API_KEY = os.getenv('GOOGLE_GENERATIVE_AI_API_KEY')
if not GOOGLE_API_KEY:
    print("❌ GOOGLE_GENERATIVE_AI_API_KEY not found in .env")
    sys.exit(1)

try:
    genai.configure(api_key=GOOGLE_API_KEY)
    model = genai.GenerativeModel('gemini-3.5-flash')
    response = model.generate_content("Say 'Hello, I am working!' in one sentence.")
    print(f"✅ Gemini API connected successfully")
    print(f"   Response: {response.text[:100]}...")
except Exception as e:
    print(f"❌ Gemini API connection failed: {e}")
    sys.exit(1)

print("\n" + "="*60)
print("✅ All connections successful! You're ready to run the script.")
print("="*60)
