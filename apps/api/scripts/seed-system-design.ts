/**
 * Seed Script: System Design Questions → MongoDB
 * 
 * Run: npx tsx scripts/seed-system-design.ts
 * 
 * Inserts 10 system design questions into the `system_design_questions`
 * collection in the `mockr_questions` database.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load env from monorepo root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/mockr_questions";

// ── Schema (mirrors src/models/system-design-question.ts) ──
const SystemDesignQuestionSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    difficulty: { type: String, required: true, enum: ["Easy", "Medium", "Hard"] },
    problemStatement: { type: String, required: true },
    rubricLite: { type: mongoose.Schema.Types.Mixed, required: true },
    rubricFull: { type: mongoose.Schema.Types.Mixed, required: true },
    hints: { type: [String], default: [] },
    followUpQuestions: { type: [String], default: [] },
}, { timestamps: true, collection: "system_design_questions" });

const SystemDesignQuestion = mongoose.model("SystemDesignQuestion", SystemDesignQuestionSchema);

// ── Question Data ──────────────────────────────────────────────
const questions = [
    // ─── 1. URL Shortener ───
    {
        slug: "url-shortener",
        title: "URL Shortener Design",
        difficulty: "Medium",
        problemStatement: `Design a URL shortening service similar to TinyURL or Bit.ly.

**Functional Requirements:**
- Given a long URL, generate a unique short URL
- When users access the short URL, redirect them to the original long URL
- Users can optionally set custom short links
- Links should expire after a configurable time period

**Non-Functional Requirements:**
- The system should be highly available
- URL redirection should happen in real-time with minimal latency
- Shortened links should not be predictable

**Scale:**
- 100M new URLs per month
- 10:1 read to write ratio (1B redirections per month)`,
        rubricLite: {
            requiredComponents: [
                "API Gateway / Load Balancer",
                "Application Server",
                "Database (NoSQL preferred for key-value lookups)",
                "Cache layer (Redis/Memcached for hot URLs)",
                "Base62/Base58 encoding or hash-based ID generation",
            ],
            keyTradeoffs: [
                "SQL vs NoSQL for storage — NoSQL is better for simple key-value lookups at scale",
                "Hash-based vs counter-based short code generation",
                "Cache eviction strategy — LRU for hot URLs",
                "Handling hash collisions if using MD5/SHA truncation",
            ],
            antiPatterns: [
                "Using auto-increment IDs directly (predictable, security risk)",
                "No caching layer (every redirect hits DB)",
                "Single database without replication (availability risk)",
                "Not handling expired URLs cleanup",
            ],
            followUpTriggers: [
                { condition: "Candidate doesn't mention caching", question: "If a viral tweet contains one of your short URLs and it gets millions of clicks in an hour, how would your system handle that?" },
                { condition: "Candidate uses sequential IDs", question: "If I can guess your short URLs by incrementing the ID, what security implications does that have?" },
                { condition: "Candidate doesn't discuss scale", question: "How would your system handle 100 million new URLs being created every month?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "A URL shortener needs an API layer behind a load balancer, an encoding service that converts numeric IDs to Base62 strings, a NoSQL database (like DynamoDB or Cassandra) for O(1) key-value lookups, and a Redis cache for frequently accessed URLs. Use a distributed ID generator (Twitter Snowflake or Zookeeper-based counter ranges) to avoid collisions. The read path checks cache first, falls back to DB. For analytics, stream click events to Kafka for async processing.",
            scoringDimensions: [
                { name: "API Design", weight: 15, criteria: "Clean REST API with proper endpoints for create, redirect, and delete operations" },
                { name: "Encoding Strategy", weight: 20, criteria: "Sound approach for generating unique, non-predictable short codes (Base62, hashing)" },
                { name: "Data Storage", weight: 20, criteria: "Appropriate database choice with proper schema for high read throughput" },
                { name: "Caching", weight: 15, criteria: "Cache layer for hot URLs with proper eviction strategy" },
                { name: "Scalability", weight: 20, criteria: "Horizontal scaling plan, database sharding/partitioning strategy" },
                { name: "Edge Cases", weight: 10, criteria: "Handles collisions, expiration, custom aliases, and abuse prevention" },
            ],
        },
        hints: [
            "Think about the read-to-write ratio — this system is read-heavy. What does that imply for your architecture?",
            "Consider using Base62 encoding (a-z, A-Z, 0-9) — how many characters do you need for 100M URLs?",
            "What happens when two users submit the same long URL? Should they get the same short URL?",
        ],
        followUpQuestions: [
            "How would you implement analytics (click tracking, geographic data)?",
            "How would you handle link expiration at scale?",
            "How would you prevent abuse (spam URLs, phishing)?",
        ],
    },

    // ─── 2. Chat System ───
    {
        slug: "chat-system",
        title: "Real-Time Chat System",
        difficulty: "Hard",
        problemStatement: `Design a real-time chat application similar to WhatsApp or Facebook Messenger.

**Functional Requirements:**
- One-on-one messaging between users
- Group chats (up to 500 members)
- Online/offline status indicators
- Message read receipts
- Support for text, images, and file sharing

**Non-Functional Requirements:**
- Real-time message delivery (< 100ms for online users)
- Messages should be persisted and never lost
- Support for millions of concurrent users
- End-to-end encryption for messages

**Scale:**
- 500M daily active users
- Average user sends 40 messages per day
- 20B messages per day`,
        rubricLite: {
            requiredComponents: [
                "WebSocket servers for real-time bidirectional communication",
                "Message queue (Kafka) for reliable message delivery",
                "Chat database (Cassandra/HBase for write-heavy message storage)",
                "User presence service (Redis for online/offline tracking)",
                "Media storage service (S3 + CDN for images/files)",
                "Push notification service for offline users",
            ],
            keyTradeoffs: [
                "WebSocket vs long polling vs SSE for real-time communication",
                "Message storage: SQL vs NoSQL vs time-series DB",
                "Fan-out on write vs fan-out on read for group messages",
                "Storing messages on device vs server-side storage",
            ],
            antiPatterns: [
                "Using HTTP polling instead of WebSockets for real-time chat",
                "Storing all messages in a single relational table",
                "Not handling offline message delivery",
                "No message ordering guarantees",
            ],
            followUpTriggers: [
                { condition: "Candidate doesn't mention WebSockets", question: "How would you push messages to the recipient in real-time without them constantly polling your server?" },
                { condition: "Candidate doesn't discuss offline users", question: "What happens when a user is offline when a message is sent to them?" },
                { condition: "Candidate doesn't mention message ordering", question: "How do you ensure messages appear in the correct order, especially in group chats?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "Use WebSocket connections through a gateway service for real-time messaging. Each user maintains a persistent connection. Messages are published to Kafka for durability, then routed to the recipient's WebSocket server. Store messages in Cassandra partitioned by (chat_id, timestamp) for efficient retrieval. Use Redis to track which server each user is connected to. For offline users, queue messages and send push notifications via APNs/FCM. Group messages use fan-out on write for small groups and fan-out on read for large groups.",
            scoringDimensions: [
                { name: "Real-Time Architecture", weight: 25, criteria: "WebSocket-based design with proper connection management and routing" },
                { name: "Message Delivery", weight: 25, criteria: "Guaranteed delivery with offline support, ordering, and deduplication" },
                { name: "Data Model", weight: 20, criteria: "Efficient storage schema for messages, optimized for both write and read patterns" },
                { name: "Scalability", weight: 20, criteria: "Horizontal scaling of WebSocket servers, database partitioning strategy" },
                { name: "Additional Features", weight: 10, criteria: "Read receipts, typing indicators, presence, media sharing" },
            ],
        },
        hints: [
            "Think about the connection protocol — HTTP is request-response, but chat is bidirectional. What protocol supports that?",
            "Consider how you would route a message when the sender and recipient are connected to different servers.",
            "How would you partition your message storage? Think about common access patterns: loading a conversation's recent messages.",
        ],
        followUpQuestions: [
            "How would you implement end-to-end encryption?",
            "How would you handle message search across all conversations?",
            "What changes would you need for video/voice calling support?",
        ],
    },

    // ─── 3. Rate Limiter ───
    {
        slug: "rate-limiter",
        title: "Distributed Rate Limiter",
        difficulty: "Easy",
        problemStatement: `Design a distributed rate limiter that can be used to throttle API requests.

**Functional Requirements:**
- Limit the number of requests a user/client can make in a given time window
- Support different rate limits for different API endpoints
- Return appropriate HTTP 429 responses when limit is exceeded
- Support both per-user and global rate limits

**Non-Functional Requirements:**
- Very low latency (should not add significant overhead to requests)
- Highly available — if the rate limiter goes down, allow requests through
- Accurate counting even in a distributed environment

**Scale:**
- 10M requests per second across all services
- Thousands of API servers behind the rate limiter`,
        rubricLite: {
            requiredComponents: [
                "Redis cluster for distributed counters",
                "Rate limiting algorithm (Token Bucket / Sliding Window)",
                "API Gateway or middleware integration",
                "Configuration service for rate limit rules",
            ],
            keyTradeoffs: [
                "Token Bucket vs Leaky Bucket vs Fixed Window vs Sliding Window Log vs Sliding Window Counter",
                "Centralized (Redis) vs local rate limiting with periodic sync",
                "Hard rate limiting vs soft (with some tolerance for distributed lag)",
                "Fail-open vs fail-closed when Redis is unavailable",
            ],
            antiPatterns: [
                "Using a relational database for rate limit counters",
                "Fixed window counters that allow burst at window boundaries",
                "Not handling clock drift across distributed servers",
                "Fail-closed design that blocks all traffic when rate limiter is down",
            ],
            followUpTriggers: [
                { condition: "Candidate uses fixed window", question: "What happens if a user sends all their requests at the boundary between two windows?" },
                { condition: "Candidate doesn't mention distributed challenges", question: "If you have 100 API servers each checking rates independently, how do you ensure accurate global counts?" },
                { condition: "Candidate doesn't discuss failure modes", question: "What happens to your API traffic if Redis goes down?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "Implement a sliding window rate limiter using Redis with sorted sets. Each request adds a timestamped entry, and we count entries within the window using ZRANGEBYSCORE. For performance, use a hybrid approach: local in-memory counters synced to Redis periodically. Place the rate limiter as middleware in the API gateway. Use a token bucket algorithm for smoothing. Fail-open if Redis is unavailable. Store rate limit rules in a config service that can be updated without redeployment.",
            scoringDimensions: [
                { name: "Algorithm Choice", weight: 30, criteria: "Understanding of different rate limiting algorithms and appropriate selection" },
                { name: "Distributed Design", weight: 25, criteria: "Handling distributed counting accurately with Redis or similar" },
                { name: "Integration", weight: 15, criteria: "Where the rate limiter sits in the architecture (gateway, middleware, sidecar)" },
                { name: "Failure Handling", weight: 20, criteria: "Graceful degradation, fail-open behavior, monitoring" },
                { name: "Configuration", weight: 10, criteria: "Dynamic rule updates, per-endpoint/per-user customization" },
            ],
        },
        hints: [
            "Consider the trade-offs between different algorithms: Token Bucket allows bursts, Sliding Window is more precise.",
            "Redis has atomic operations like INCR and EXPIRE that are useful here — think about how to use them together.",
            "What should happen at the boundary of time windows? That's where fixed window counters have a well-known problem.",
        ],
        followUpQuestions: [
            "How would you implement tiered rate limits (free vs premium users)?",
            "How would you rate limit by IP vs by authenticated user vs globally?",
            "How would you handle rate limiting in a multi-region setup?",
        ],
    },

    // ─── 4. Notification System ───
    {
        slug: "notification-system",
        title: "Push Notification System",
        difficulty: "Medium",
        problemStatement: `Design a scalable notification system that supports multiple channels.

**Functional Requirements:**
- Send notifications via push (iOS/Android), SMS, and email
- Support instant, scheduled, and batched notifications
- Users can set notification preferences (opt-in/out per channel)
- Template-based notification content
- Notification history and read/unread tracking

**Non-Functional Requirements:**
- At-least-once delivery guarantee
- Handle millions of notifications per day
- Low latency for real-time notifications (< 5 seconds)
- Graceful degradation when downstream providers are slow

**Scale:**
- 10M users
- 100M notifications per day across all channels`,
        rubricLite: {
            requiredComponents: [
                "Notification Service (orchestration layer)",
                "Message Queue (Kafka/RabbitMQ for async processing)",
                "Channel-specific workers (Push, SMS, Email)",
                "User preference store",
                "Template engine",
                "Notification database for history/tracking",
            ],
            keyTradeoffs: [
                "Push vs pull for notification delivery",
                "At-least-once vs exactly-once delivery semantics",
                "Inline processing vs async queue-based processing",
                "Single queue vs per-channel queues vs priority queues",
            ],
            antiPatterns: [
                "Synchronous notification sending blocking the main request",
                "No retry mechanism for failed deliveries",
                "Sending notifications without checking user preferences",
                "No deduplication leading to duplicate notifications",
            ],
            followUpTriggers: [
                { condition: "Candidate processes synchronously", question: "If you need to send a notification to 1 million users for a flash sale, how would your synchronous approach handle that?" },
                { condition: "Candidate doesn't mention preferences", question: "What if a user has disabled email notifications but your system still sends them? How do you prevent that?" },
                { condition: "Candidate doesn't discuss failures", question: "What happens when the email provider is down? Do you lose those notifications?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "The notification service receives requests via API, validates against user preferences, applies templates, and publishes to Kafka topic(s) partitioned by channel type. Per-channel worker pools consume from Kafka and deliver via provider SDKs (APNs, FCM, Twilio, SendGrid). Failed deliveries are retried with exponential backoff using a dead-letter queue. Store notification history in Cassandra. Use Redis for rate limiting per user. Support priority levels with separate Kafka partitions.",
            scoringDimensions: [
                { name: "Architecture", weight: 25, criteria: "Event-driven async architecture with proper separation of concerns" },
                { name: "Reliability", weight: 25, criteria: "Retry mechanisms, dead-letter queues, at-least-once delivery" },
                { name: "Multi-Channel", weight: 20, criteria: "Clean abstraction for different notification channels" },
                { name: "User Preferences", weight: 15, criteria: "Preference management, opt-in/opt-out, quiet hours" },
                { name: "Scalability", weight: 15, criteria: "Queue-based processing, horizontal scaling of workers" },
            ],
        },
        hints: [
            "Think about this as an event-driven system — the caller shouldn't wait for the notification to actually be delivered.",
            "Different channels have very different latency profiles: push is instant, email can be batched, SMS has rate limits from providers.",
            "What happens when you need to notify 1M users about a sale? You can't do that synchronously.",
        ],
        followUpQuestions: [
            "How would you implement notification aggregation (e.g., '3 people liked your post' instead of 3 separate notifications)?",
            "How would you handle priority notifications (security alerts) vs low-priority ones (marketing)?",
            "How would you implement scheduled notifications (e.g., reminder 1 hour before event)?",
        ],
    },

    // ─── 5. News Feed ───
    {
        slug: "news-feed",
        title: "Social Media News Feed",
        difficulty: "Hard",
        problemStatement: `Design the news feed system for a social media platform like Twitter or Instagram.

**Functional Requirements:**
- Users can create posts (text, images, videos)
- Users see a feed of posts from people they follow
- Feed is ranked by relevance (not just chronological)
- Support for likes, comments, and shares
- Real-time feed updates when new posts are created

**Non-Functional Requirements:**
- Feed generation should be fast (< 200ms)
- Support for celebrities with millions of followers
- Eventually consistent (new posts appear within seconds)

**Scale:**
- 500M users, average 200 follows each
- 1M new posts per day
- Feed is the most accessed feature (~10B feed loads/day)`,
        rubricLite: {
            requiredComponents: [
                "Post Service (CRUD for posts)",
                "Fan-out Service (distributing posts to follower feeds)",
                "Feed Cache (Redis sorted sets per user)",
                "Ranking/ML Service for feed ordering",
                "Media storage (S3 + CDN)",
                "Social Graph service (follow relationships)",
            ],
            keyTradeoffs: [
                "Fan-out on write (push) vs fan-out on read (pull) vs hybrid approach",
                "Chronological vs algorithmic feed ranking",
                "Caching entire feed vs caching components",
                "Pre-computing feeds vs computing on demand",
            ],
            antiPatterns: [
                "Fan-out on write for celebrity users (millions of fan-out operations per post)",
                "Querying the social graph + all posts on every feed load (fan-out on read without caching)",
                "Storing feeds in a relational database with JOINs",
                "Not handling the cold-start problem (new user with empty feed cache)",
            ],
            followUpTriggers: [
                { condition: "Candidate uses only fan-out on write", question: "What happens when a user with 50 million followers posts? How many writes does that trigger?" },
                { condition: "Candidate uses only fan-out on read", question: "If you compute the feed on every request by merging posts from 200 followed users, what's the latency impact?" },
                { condition: "Candidate doesn't mention ranking", question: "Should the feed be purely chronological? How do platforms like Instagram decide what to show first?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "Use a hybrid fan-out approach: fan-out on write for regular users (pre-compute and store feeds in Redis sorted sets), fan-out on read for celebrities (merge their posts at read time). When a user posts, a fan-out worker pushes the post ID to each follower's feed cache. At read time, fetch the cached feed, merge in celebrity posts, apply ML ranking, and return. Store posts in a distributed DB (Cassandra), social graph in a graph DB or adjacency list table, and feed caches in Redis. Use a CDN for media.",
            scoringDimensions: [
                { name: "Fan-out Strategy", weight: 30, criteria: "Hybrid approach handling both regular users and celebrities efficiently" },
                { name: "Data Model", weight: 20, criteria: "Efficient storage for posts, social graph, and feed caches" },
                { name: "Feed Ranking", weight: 15, criteria: "Consideration of relevance ranking beyond chronological order" },
                { name: "Caching", weight: 20, criteria: "Multi-layer caching strategy for feeds and posts" },
                { name: "Real-Time Updates", weight: 15, criteria: "How new posts propagate to followers' feeds" },
            ],
        },
        hints: [
            "The key decision is WHEN to build the feed: when a post is created (push) or when a user opens their feed (pull)?",
            "Not all users are equal — a celebrity with 50M followers is very different from a user with 200 followers. Can you handle them differently?",
            "Think about what data structure would let you efficiently maintain a sorted, bounded list of post IDs per user.",
        ],
        followUpQuestions: [
            "How would you handle trending/viral posts that should appear in many feeds?",
            "How would you implement 'Suggested Posts' from accounts the user doesn't follow?",
            "How would you handle feed pagination and ensuring no missed posts?",
        ],
    },

    // ─── 6. Parking Lot ───
    {
        slug: "parking-lot",
        title: "Parking Lot System",
        difficulty: "Easy",
        problemStatement: `Design an automated parking lot management system.

**Functional Requirements:**
- Multiple floors with different spot sizes (Small, Medium, Large)
- Vehicle entry: assign the nearest available spot matching the vehicle size
- Vehicle exit: calculate fee based on duration and spot type
- Display available spots per floor and type on entry screens
- Support for monthly/reserved parking passes

**Non-Functional Requirements:**
- Real-time spot availability updates
- Handle concurrent entry/exit at multiple gates
- System should work even if central server goes down (gates have local fallback)

**Scale:**
- 5,000 spot parking structure
- 20 entry/exit gates
- Peak throughput: 100 vehicles entering/exiting per minute`,
        rubricLite: {
            requiredComponents: [
                "Vehicle and Spot class hierarchy (OOP)",
                "ParkingLot manager with floor/zone management",
                "Ticket/Payment service",
                "Display board service for availability",
                "Gate controller with sensors",
            ],
            keyTradeoffs: [
                "Nearest spot assignment vs random available spot (latency vs walking distance)",
                "In-memory spot tracking vs database-backed",
                "Centralized vs distributed gate controllers",
                "Fixed pricing vs dynamic pricing based on occupancy",
            ],
            antiPatterns: [
                "Not handling concurrent access (two gates assign the same spot)",
                "Linear scan to find available spots",
                "No separation between spot types/sizes",
                "Not handling edge cases like overstay or lost tickets",
            ],
            followUpTriggers: [
                { condition: "Candidate doesn't handle concurrency", question: "What if two cars arrive at two different gates simultaneously and both get assigned the same spot?" },
                { condition: "Candidate doesn't discuss pricing", question: "How would you calculate the parking fee? What about different rates for different hours?" },
                { condition: "Candidate uses simple array for spots", question: "How would you quickly find the nearest available spot on a specific floor without scanning all spots?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "Model with Vehicle (Car, Truck, Motorcycle) and ParkingSpot (Small, Medium, Large) hierarchies. ParkingLot contains Floors, each with a ParkingSpotManager using a min-heap per spot type for nearest-spot assignment. Use optimistic locking or Redis distributed locks for concurrent gate access. Ticket tracks entry time, spot, and vehicle. PaymentService calculates fee using a strategy pattern for different rate cards. DisplayBoard subscribes to spot changes via an event bus for real-time updates.",
            scoringDimensions: [
                { name: "OOP Design", weight: 30, criteria: "Clean class hierarchy, SOLID principles, proper use of inheritance/composition" },
                { name: "Concurrency", weight: 25, criteria: "Thread-safe spot assignment across multiple gates" },
                { name: "Spot Assignment", weight: 20, criteria: "Efficient algorithm for finding optimal available spot" },
                { name: "Payment Logic", weight: 15, criteria: "Flexible fee calculation supporting different rate structures" },
                { name: "Edge Cases", weight: 10, criteria: "Handles full lot, oversized vehicles, reserved spots, system failures" },
            ],
        },
        hints: [
            "Start with the core classes: what objects exist in a parking lot? Think about vehicles, spots, tickets, and the lot itself.",
            "For finding the nearest available spot efficiently, think about what data structure gives you the minimum element quickly.",
            "How do you prevent two gates from assigning the same spot? Think about locking mechanisms.",
        ],
        followUpQuestions: [
            "How would you add support for electric vehicle charging spots?",
            "How would you implement a mobile app that lets users find their parked car?",
            "How would you handle dynamic pricing during peak hours?",
        ],
    },

    // ─── 7. Key-Value Store ───
    {
        slug: "key-value-store",
        title: "Distributed Key-Value Store",
        difficulty: "Hard",
        problemStatement: `Design a distributed key-value store similar to Amazon DynamoDB or Apache Cassandra.

**Functional Requirements:**
- Put(key, value) — store a key-value pair
- Get(key) — retrieve the value for a given key
- Delete(key) — remove a key-value pair
- Support for configurable consistency levels (strong, eventual)
- Automatic data partitioning across nodes

**Non-Functional Requirements:**
- Highly available (no single point of failure)
- Horizontally scalable by adding more nodes
- Durable — data survives node failures
- Low latency (<10ms for reads and writes)

**Scale:**
- Petabytes of data across thousands of nodes
- Millions of operations per second`,
        rubricLite: {
            requiredComponents: [
                "Consistent hashing ring for data partitioning",
                "Replication across multiple nodes (configurable replication factor)",
                "Gossip protocol for cluster membership",
                "Write-ahead log (WAL) for durability",
                "SSTable/LSM tree for storage engine",
                "Conflict resolution (vector clocks / last-write-wins)",
            ],
            keyTradeoffs: [
                "CAP theorem: consistency vs availability during network partitions",
                "Strong consistency (quorum reads/writes) vs eventual consistency",
                "LSM tree (write-optimized) vs B-tree (read-optimized) storage",
                "Replication factor vs storage cost vs durability",
            ],
            antiPatterns: [
                "Using a single master node (single point of failure)",
                "Not handling node failures and data rebalancing",
                "Ignoring the CAP theorem tradeoffs",
                "No compaction strategy for LSM trees (unbounded disk usage)",
            ],
            followUpTriggers: [
                { condition: "Candidate doesn't mention partitioning", question: "How do you decide which node stores which keys? What happens when you add a new node?" },
                { condition: "Candidate uses single master", question: "What happens when your master node goes down? How do writes continue?" },
                { condition: "Candidate doesn't discuss consistency", question: "If you write to node A and immediately read from node B, will you get the latest value? How do you handle that?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "Use consistent hashing with virtual nodes for even distribution. Each key is replicated to N successor nodes on the ring. Use quorum-based reads/writes (W + R > N for strong consistency). Storage engine uses an LSM tree: writes go to an in-memory memtable (backed by WAL), which flushes to immutable SSTables on disk. Background compaction merges SSTables. Node membership via gossip protocol. Handle conflicts with vector clocks. Use Merkle trees for anti-entropy (detecting/repairing inconsistencies between replicas).",
            scoringDimensions: [
                { name: "Partitioning", weight: 25, criteria: "Consistent hashing with virtual nodes, handling rebalancing" },
                { name: "Replication", weight: 25, criteria: "Multi-node replication with configurable consistency" },
                { name: "Storage Engine", weight: 20, criteria: "LSM tree or similar write-optimized storage with compaction" },
                { name: "Failure Handling", weight: 20, criteria: "Node failure detection, data repair, hinted handoff" },
                { name: "Consistency Model", weight: 10, criteria: "Understanding of CAP theorem, quorum mechanics, conflict resolution" },
            ],
        },
        hints: [
            "Think about how to distribute data across nodes. Simple modular hashing has a problem when nodes are added/removed — what's a better approach?",
            "For durability, consider a two-level storage: fast writes to memory + log, then periodic flush to disk (LSM tree approach).",
            "The CAP theorem says you can't have all three. Which two does your design prioritize, and what's the tradeoff?",
        ],
        followUpQuestions: [
            "How would you handle a network partition between data centers?",
            "How would you implement range queries efficiently?",
            "How would you handle hot keys (keys with extremely high access rates)?",
        ],
    },

    // ─── 8. Web Crawler ───
    {
        slug: "web-crawler",
        title: "Web Crawler",
        difficulty: "Medium",
        problemStatement: `Design a web crawler that can crawl the entire web and build a search index.

**Functional Requirements:**
- Start from a set of seed URLs and discover new URLs by parsing web pages
- Download and store the content of web pages
- Extract and follow links to discover new pages
- Respect robots.txt and crawl rate limits per domain
- Avoid crawling duplicate pages
- Prioritize important/fresh pages

**Non-Functional Requirements:**
- Crawl billions of pages
- Be polite — don't overwhelm any single website
- Handle various content types and encodings
- Fault-tolerant — resume after failures

**Scale:**
- Crawl 1 billion pages per month
- Store petabytes of web content`,
        rubricLite: {
            requiredComponents: [
                "URL Frontier (priority queue of URLs to crawl)",
                "DNS Resolver with caching",
                "HTML Fetcher (multi-threaded downloader)",
                "Content Parser (extract text + links)",
                "URL Deduplication (Bloom filter or hash set)",
                "Content Storage (distributed file system)",
                "Politeness controller (per-domain rate limiting)",
            ],
            keyTradeoffs: [
                "BFS vs DFS crawling strategy",
                "Bloom filter (probabilistic, space-efficient) vs exact URL dedup",
                "Crawl depth vs breadth — how deep to go on each domain",
                "Freshness vs coverage — recrawl known pages vs discover new ones",
            ],
            antiPatterns: [
                "Not respecting robots.txt (legal/ethical issues)",
                "No politeness delay between requests to same domain",
                "Storing all URLs in memory (won't scale to billions)",
                "Not handling spider traps (infinite URL generation)",
            ],
            followUpTriggers: [
                { condition: "Candidate doesn't mention politeness", question: "If your crawler sends 1000 requests per second to the same website, what would happen?" },
                { condition: "Candidate doesn't discuss deduplication", question: "How do you avoid re-crawling pages you've already visited? Can you do this efficiently for billions of URLs?" },
                { condition: "Candidate doesn't mention prioritization", question: "Should you crawl every page with equal priority? How would you decide which pages to crawl first?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "Multiple crawler workers pull URLs from a distributed URL frontier (priority queue in Redis/Kafka). The frontier is segmented by domain for politeness enforcement. Each worker: resolve DNS (cached), fetch page (respecting robots.txt), parse content, extract links, check against a Bloom filter for deduplication, and add new URLs to the frontier. Store raw pages in HDFS/S3. A separate indexing pipeline processes stored pages. Use consistent hashing to assign domain ownership to crawler instances. Priority based on PageRank, freshness, and domain authority.",
            scoringDimensions: [
                { name: "Architecture", weight: 25, criteria: "Distributed crawler design with proper separation of concerns" },
                { name: "URL Management", weight: 25, criteria: "Frontier design, deduplication, and prioritization strategy" },
                { name: "Politeness", weight: 20, criteria: "Rate limiting per domain, robots.txt compliance" },
                { name: "Scalability", weight: 20, criteria: "Horizontal scaling, handling billions of URLs" },
                { name: "Fault Tolerance", weight: 10, criteria: "Handling failures, checkpointing, resume capability" },
            ],
        },
        hints: [
            "Think about the URL frontier as more than just a queue — it needs to support priorities and per-domain rate limiting.",
            "Storing billions of URLs for deduplication is expensive. A Bloom filter can tell you if a URL has probably been seen using very little memory.",
            "How do you prevent your crawler from getting stuck in a spider trap (e.g., a calendar page with infinite future dates)?",
        ],
        followUpQuestions: [
            "How would you detect and handle duplicate content (same content at different URLs)?",
            "How would you decide when to recrawl a page (freshness)?",
            "How would you extend this to handle JavaScript-rendered pages (SPAs)?",
        ],
    },

    // ─── 9. Ride-Sharing Service ───
    {
        slug: "ride-sharing",
        title: "Ride-Sharing Service",
        difficulty: "Hard",
        problemStatement: `Design a ride-sharing service like Uber or Lyft.

**Functional Requirements:**
- Riders can request rides by specifying pickup and drop-off locations
- Match riders with nearby available drivers
- Real-time location tracking for both riders and drivers
- Fare estimation before ride confirmation
- Payment processing after ride completion
- Rating system for riders and drivers

**Non-Functional Requirements:**
- Match rider to driver within 30 seconds
- Real-time location updates every 3–5 seconds
- Support for surge pricing during high demand
- Handle millions of concurrent rides

**Scale:**
- 50M riders, 5M drivers
- 15M rides per day
- Need to match riders within a few-kilometer radius in real-time`,
        rubricLite: {
            requiredComponents: [
                "Location Service (real-time driver position tracking)",
                "Matching/Dispatch Service (find nearest available drivers)",
                "Geospatial Index (QuadTree, GeoHash, or S2 cells for proximity queries)",
                "Trip Service (ride lifecycle management)",
                "Pricing/Fare Service (dynamic pricing engine)",
                "Payment Service",
                "Notification Service (push notifications for ride updates)",
            ],
            keyTradeoffs: [
                "QuadTree vs GeoHash vs S2 cells for spatial indexing",
                "Push vs pull model for driver location updates",
                "Surge pricing algorithms (market-based vs rule-based)",
                "In-memory spatial index (fast) vs database geospatial queries (persistent)",
            ],
            antiPatterns: [
                "Computing distance between rider and all drivers (O(n) per request)",
                "Using SQL LIKE queries for location matching",
                "Not handling the 'thundering herd' problem (all drivers notified for one ride)",
                "Tight coupling between matching and payment services",
            ],
            followUpTriggers: [
                { condition: "Candidate doesn't mention spatial indexing", question: "You have 5 million drivers. How do you efficiently find the 10 nearest ones to a rider without checking all 5 million?" },
                { condition: "Candidate doesn't discuss driver location updates", question: "Drivers are constantly moving. How do you keep their locations up-to-date in your system?" },
                { condition: "Candidate doesn't mention surge pricing", question: "During New Year's Eve, demand spikes 10x. How do you handle pricing and still ensure riders can get rides?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "Drivers send GPS updates every 4 seconds via WebSocket to a Location Service that updates an in-memory geospatial index (GeoHash-based grid). When a rider requests a ride, the Dispatch Service queries the index for available drivers within expanding radius, ranks by ETA (using a map/routing API), and sends ride offers to the top-3 drivers. First to accept gets matched. Trip Service manages ride lifecycle (REQUESTED→MATCHED→EN_ROUTE→IN_RIDE→COMPLETED). Fare calculated using distance + time + surge multiplier. Use Kafka for event streaming between services. Payment processed asynchronously after ride completion.",
            scoringDimensions: [
                { name: "Location Tracking", weight: 20, criteria: "Efficient real-time driver location tracking and spatial indexing" },
                { name: "Matching Algorithm", weight: 25, criteria: "Fast proximity search with proper ranking and ETA estimation" },
                { name: "Ride Lifecycle", weight: 20, criteria: "Clear state machine for ride flows and edge cases" },
                { name: "Pricing", weight: 15, criteria: "Dynamic pricing with surge model and fare estimation" },
                { name: "Scalability", weight: 20, criteria: "Handling millions of concurrent location updates and ride requests" },
            ],
        },
        hints: [
            "Think about spatial data structures that let you query 'find all points within X km of this location' efficiently.",
            "Driver locations change every few seconds. Where do you store that data, and how do you keep it current?",
            "The matching problem is time-sensitive — you want to minimize rider wait time. How do you rank nearby drivers?",
        ],
        followUpQuestions: [
            "How would you implement ride pooling (shared rides with multiple passengers)?",
            "How would you handle a scenario where the driver's app crashes mid-ride?",
            "How would you design the surge pricing algorithm?",
        ],
    },

    // ─── 10. Content Delivery Network ───
    {
        slug: "content-delivery-network",
        title: "Content Delivery Network (CDN)",
        difficulty: "Medium",
        problemStatement: `Design a Content Delivery Network (CDN) that serves static and dynamic content with low latency globally.

**Functional Requirements:**
- Cache and serve static content (images, CSS, JS, videos) from edge servers
- Origin pull: fetch from origin server on cache miss
- Cache invalidation / purging
- Support for custom domains and SSL certificates
- Analytics: hit rate, bandwidth, latency per edge location

**Non-Functional Requirements:**
- Sub-100ms response time for cached content globally
- 99.99% availability
- Support for terabytes of cached content per edge node
- Handle traffic spikes (e.g., viral content)

**Scale:**
- 200+ edge locations worldwide
- 10M requests per second globally
- Petabytes of content served daily`,
        rubricLite: {
            requiredComponents: [
                "Edge servers / Points of Presence (PoPs) globally distributed",
                "DNS-based or Anycast routing to nearest edge",
                "Origin servers (customer's web servers)",
                "Cache management layer (LRU/LFU eviction)",
                "Health monitoring and failover",
                "SSL/TLS termination at edge",
            ],
            keyTradeoffs: [
                "Push vs pull caching (pre-populate vs cache on first request)",
                "DNS-based vs Anycast vs HTTP redirect routing",
                "Cache consistency vs performance (TTL-based vs purge-based invalidation)",
                "Edge compute vs origin compute for dynamic content",
            ],
            antiPatterns: [
                "No cache hierarchy (every miss goes directly to origin)",
                "Long TTLs with no invalidation mechanism (serving stale content)",
                "Single origin server (bottleneck and SPOF)",
                "Not handling cache stampede (thundering herd on cache miss)",
            ],
            followUpTriggers: [
                { condition: "Candidate doesn't mention routing", question: "How does a user's request get routed to the nearest edge server?" },
                { condition: "Candidate doesn't discuss cache invalidation", question: "A customer deploys a new version of their website. How do you ensure all edge servers serve the new content?" },
                { condition: "Candidate doesn't mention cache hierarchy", question: "If an edge server has a cache miss, should it go directly to the origin? What if 100 edge servers have the same miss simultaneously?" },
            ],
        },
        rubricFull: {
            sampleAnswer: "Users are routed to the nearest PoP via Anycast or GeoDNS. Each edge server checks its local cache first. On miss, it checks a regional/shield cache (mid-tier) before going to origin — this tiered approach prevents origin overload. Cache keys include URL + relevant headers (Accept-Encoding, etc.). Use consistent hashing within each PoP to distribute cached content across servers. Invalidation via purge API that cascades through the hierarchy. SSL termination at edge with certificate management via Let's Encrypt or customer-uploaded certs. Monitor with real-time analytics on hit rates, latency percentiles, and error rates.",
            scoringDimensions: [
                { name: "Routing", weight: 20, criteria: "DNS/Anycast-based routing to nearest edge location" },
                { name: "Caching Architecture", weight: 30, criteria: "Multi-tier cache hierarchy, eviction policies, cache key design" },
                { name: "Cache Invalidation", weight: 20, criteria: "TTL-based and purge-based invalidation, consistency guarantees" },
                { name: "Scalability", weight: 20, criteria: "Handling traffic spikes, distributed architecture" },
                { name: "Operations", weight: 10, criteria: "Health checks, failover, monitoring, SSL management" },
            ],
        },
        hints: [
            "Think about how a user's HTTP request gets routed to a server that's geographically close to them. DNS plays a key role here.",
            "Consider a multi-tier cache: edge → regional shield → origin. This prevents the 'cache stampede' problem.",
            "How do you invalidate cached content? There's a famous quote: 'There are only two hard things in CS: cache invalidation and naming things.'",
        ],
        followUpQuestions: [
            "How would you handle video streaming (large files, seek support, adaptive bitrate)?",
            "How would you implement edge computing for dynamic content personalization?",
            "How would you protect against DDoS attacks at the edge?",
        ],
    },
];

// ── Main ───────────────────────────────────────────────────────
async function main() {
    console.log("[Seed] Connecting to MongoDB...");
    console.log(`[Seed] URI: ${MONGODB_URI.replace(/\/\/[^@]+@/, "//***@")}`);

    await mongoose.connect(MONGODB_URI, { dbName: "mockr_questions" });
    console.log("[Seed] Connected!\n");

    // Check existing documents
    const existingCount = await SystemDesignQuestion.countDocuments();
    console.log(`[Seed] Existing documents in collection: ${existingCount}`);

    let inserted = 0;
    let skipped = 0;

    for (const q of questions) {
        const exists = await SystemDesignQuestion.findOne({ slug: q.slug });
        if (exists) {
            console.log(`  ⏭  Skipping "${q.title}" (slug "${q.slug}" already exists)`);
            skipped++;
            continue;
        }

        await SystemDesignQuestion.create(q);
        console.log(`  ✅ Inserted "${q.title}" (${q.difficulty})`);
        inserted++;
    }

    console.log(`\n[Seed] Done! Inserted: ${inserted}, Skipped: ${skipped}`);
    console.log(`[Seed] Total documents now: ${await SystemDesignQuestion.countDocuments()}`);

    await mongoose.disconnect();
    console.log("[Seed] Disconnected.");
}

main().catch((err) => {
    console.error("[Seed] Fatal error:", err);
    process.exit(1);
});
