#!/usr/bin/env python3
"""
Quick script to check what collections exist in MongoDB
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
    
    # List all databases
    print("="*60)
    print("Available Databases:")
    print("="*60)
    for db_name in client.list_database_names():
        print(f"  • {db_name}")
    
    # Check MockrCluster0 database
    print("\n" + "="*60)
    print("Collections in 'MockrCluster0' database:")
    print("="*60)
    db = client['MockrCluster0']
    collections = db.list_collection_names()
    
    if not collections:
        print("  (No collections found)")
    else:
        for coll_name in collections:
            count = db[coll_name].count_documents({})
            print(f"  • {coll_name}: {count} documents")
    
    # Try other common database names
    print("\n" + "="*60)
    print("Checking other common database names:")
    print("="*60)
    
    for db_name in ['test', 'admin', 'local', 'mockr', 'interview_prep']:
        try:
            db = client[db_name]
            collections = db.list_collection_names()
            if collections:
                print(f"\n  Database: {db_name}")
                for coll_name in collections:
                    count = db[coll_name].count_documents({})
                    print(f"    • {coll_name}: {count} documents")
        except:
            pass
    
    print("\n" + "="*60)
    
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
