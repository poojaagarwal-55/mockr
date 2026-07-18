#!/usr/bin/env python3
"""
Script to check all databases and collections in MongoDB
"""

import os
import sys
from pymongo import MongoClient
from dotenv import load_dotenv

# Load environment variables
load_dotenv('../apps/api/.env')

MONGODB_URI = os.getenv('MONGODB_URI')

if not MONGODB_URI:
    print("❌ Error: MONGODB_URI not found")
    sys.exit(1)

try:
    client = MongoClient(MONGODB_URI)
    
    print("="*60)
    print("MongoDB Databases and Collections")
    print("="*60)
    
    # List all databases
    databases = client.list_database_names()
    print(f"\n📊 Found {len(databases)} database(s):\n")
    
    for db_name in databases:
        db = client[db_name]
        collections = db.list_collection_names()
        
        print(f"📁 Database: {db_name}")
        print(f"   Collections ({len(collections)}):")
        
        for coll_name in collections:
            coll = db[coll_name]
            count = coll.count_documents({})
            print(f"      - {coll_name}: {count} documents")
            
            # Check if this is cs_fundamental_questions
            if 'cs_fundamental' in coll_name.lower():
                print(f"         ✅ Found CS Fundamentals collection!")
                # Show sample document
                sample = coll.find_one()
                if sample:
                    print(f"         Sample fields: {list(sample.keys())}")
        
        print()
    
    print("="*60)
    
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
