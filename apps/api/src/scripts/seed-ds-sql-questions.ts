// ============================================
// Seed: Data Science SQL Questions (10 questions)
// ============================================
// Run with: npx tsx src/scripts/seed-ds-sql-questions.ts
// DO NOT RUN until instructed.

import mongoose from "mongoose";
import { DSSQLQuestion } from "../models/DSSQLQuestion.js";
import * as dotenv from "dotenv";
dotenv.config();

const QUESTIONS = [
    {
        title: "First Purchase Within 7 Days",
        domain: "ecommerce",
        difficulty: "Hard",
        problemStatement: `Find all users who made their first purchase within 7 days of signup AND had at least 2 subsequent orders in the next 30 days. Return user_id, first_purchase_value, and avg_subsequent_order_value.`,
        schema: [
            {
                tableName: "users",
                rowCountHint: "~2M rows",
                ddl: `CREATE TABLE users (
  user_id VARCHAR(36) PRIMARY KEY,
  signup_date DATE NOT NULL,
  country VARCHAR(3)
);`,
                columns: [
                    { name: "user_id", type: "VARCHAR(36)", nullable: false },
                    { name: "signup_date", type: "DATE", nullable: false },
                    { name: "country", type: "VARCHAR(3)", nullable: true },
                ],
            },
            {
                tableName: "orders",
                rowCountHint: "~50M rows",
                ddl: `CREATE TABLE orders (
  order_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  order_date DATE NOT NULL,
  order_value DECIMAL(10,2) NOT NULL
);`,
                columns: [
                    { name: "order_id", type: "VARCHAR(36)", nullable: false },
                    { name: "user_id", type: "VARCHAR(36)", nullable: false },
                    { name: "order_date", type: "DATE", nullable: false },
                    { name: "order_value", type: "DECIMAL(10,2)", nullable: false },
                ],
            },
        ],
        sampleSolution: `WITH first_orders AS (
  SELECT o.user_id,
         MIN(o.order_date) AS first_order_date,
         MIN(o.order_value) AS first_purchase_value
  FROM orders o
  JOIN users u ON o.user_id = u.user_id
  WHERE o.order_date <= u.signup_date + INTERVAL '7 days'
  GROUP BY o.user_id
),
subsequent AS (
  SELECT o.user_id,
         COUNT(*) AS subsequent_count,
         AVG(o.order_value) AS avg_subsequent_order_value
  FROM orders o
  JOIN first_orders f ON o.user_id = f.user_id
  WHERE o.order_date > f.first_order_date
    AND o.order_date <= f.first_order_date + INTERVAL '30 days'
  GROUP BY o.user_id
)
SELECT f.user_id, f.first_purchase_value, s.avg_subsequent_order_value
FROM first_orders f
JOIN subsequent s ON f.user_id = s.user_id
WHERE s.subsequent_count >= 2;`,
        followUpQuestions: [
            "How would you optimize this for a 500M row orders table?",
            "What if order_date has NULLs — does your query handle that?",
            "Could you rewrite the subsequent orders subquery using a window function?",
        ],
        evaluationCriteria: "Correct JOIN logic for first purchase within 7 days; correct counting of subsequent orders within 30 days of first order; window function use is a bonus; mention of index on (user_id, order_date).",
    },
    {
        title: "Weekly Retention Cohort",
        domain: "saas",
        difficulty: "Hard",
        problemStatement: `For each weekly signup cohort, calculate the retention rate at week 1, week 2, and week 4. A user is retained in week N if they logged in at least once during that week after signup. Return cohort_week, week1_retention, week2_retention, week4_retention as percentages.`,
        schema: [
            {
                tableName: "users",
                rowCountHint: "~500K rows",
                ddl: `CREATE TABLE users (
  user_id INT PRIMARY KEY,
  signup_date DATE NOT NULL
);`,
                columns: [
                    { name: "user_id", type: "INT", nullable: false },
                    { name: "signup_date", type: "DATE", nullable: false },
                ],
            },
            {
                tableName: "logins",
                rowCountHint: "~20M rows",
                ddl: `CREATE TABLE logins (
  user_id INT NOT NULL,
  login_date DATE NOT NULL
);`,
                columns: [
                    { name: "user_id", type: "INT", nullable: false },
                    { name: "login_date", type: "DATE", nullable: false },
                ],
            },
        ],
        sampleSolution: `WITH cohorts AS (
  SELECT user_id,
         DATE_TRUNC('week', signup_date) AS cohort_week
  FROM users
),
retention AS (
  SELECT c.cohort_week,
         COUNT(DISTINCT c.user_id) AS cohort_size,
         COUNT(DISTINCT CASE WHEN l.login_date BETWEEN c.cohort_week + 7 AND c.cohort_week + 13 THEN c.user_id END) AS w1,
         COUNT(DISTINCT CASE WHEN l.login_date BETWEEN c.cohort_week + 14 AND c.cohort_week + 20 THEN c.user_id END) AS w2,
         COUNT(DISTINCT CASE WHEN l.login_date BETWEEN c.cohort_week + 28 AND c.cohort_week + 34 THEN c.user_id END) AS w4
  FROM cohorts c
  LEFT JOIN logins l ON c.user_id = l.user_id
  GROUP BY c.cohort_week
)
SELECT cohort_week,
       ROUND(100.0 * w1 / cohort_size, 1) AS week1_retention,
       ROUND(100.0 * w2 / cohort_size, 1) AS week2_retention,
       ROUND(100.0 * w4 / cohort_size, 1) AS week4_retention
FROM retention
ORDER BY cohort_week;`,
        followUpQuestions: [
            "Why did you use LEFT JOIN instead of INNER JOIN here?",
            "How does DATE_TRUNC differ across PostgreSQL and BigQuery?",
            "How would you add a 'churned' flag for users with 0 logins after week 2?",
        ],
        evaluationCriteria: "Correct cohort bucketing with DATE_TRUNC; correct week offset arithmetic; CASE WHEN for conditional aggregation; handles users with no logins gracefully via LEFT JOIN.",
    },
    {
        title: "Top Revenue Products by Category",
        domain: "ecommerce",
        difficulty: "Medium",
        problemStatement: `Find the top 3 products by total revenue within each category. Include product_name, category, total_revenue, and rank. Exclude categories with fewer than 5 distinct products.`,
        schema: [
            {
                tableName: "products",
                rowCountHint: "~100K rows",
                ddl: `CREATE TABLE products (
  product_id INT PRIMARY KEY,
  product_name VARCHAR(255),
  category VARCHAR(100)
);`,
                columns: [
                    { name: "product_id", type: "INT", nullable: false },
                    { name: "product_name", type: "VARCHAR(255)", nullable: true },
                    { name: "category", type: "VARCHAR(100)", nullable: true },
                ],
            },
            {
                tableName: "order_items",
                rowCountHint: "~200M rows",
                ddl: `CREATE TABLE order_items (
  item_id INT PRIMARY KEY,
  order_id INT,
  product_id INT,
  quantity INT,
  unit_price DECIMAL(10,2)
);`,
                columns: [
                    { name: "item_id", type: "INT", nullable: false },
                    { name: "order_id", type: "INT", nullable: false },
                    { name: "product_id", type: "INT", nullable: false },
                    { name: "quantity", type: "INT", nullable: false },
                    { name: "unit_price", type: "DECIMAL(10,2)", nullable: false },
                ],
            },
        ],
        sampleSolution: `WITH revenue AS (
  SELECT p.product_id, p.product_name, p.category,
         SUM(oi.quantity * oi.unit_price) AS total_revenue
  FROM products p
  JOIN order_items oi ON p.product_id = oi.product_id
  GROUP BY p.product_id, p.product_name, p.category
),
cat_counts AS (
  SELECT category FROM products
  GROUP BY category HAVING COUNT(DISTINCT product_id) >= 5
),
ranked AS (
  SELECT r.*, RANK() OVER (PARTITION BY r.category ORDER BY r.total_revenue DESC) AS rnk
  FROM revenue r
  WHERE r.category IN (SELECT category FROM cat_counts)
)
SELECT product_name, category, total_revenue, rnk AS rank
FROM ranked WHERE rnk <= 3
ORDER BY category, rank;`,
        followUpQuestions: [
            "What's the difference between RANK(), DENSE_RANK(), and ROW_NUMBER() here?",
            "How would you handle ties in revenue for the 3rd spot?",
        ],
        evaluationCriteria: "Correct window function partitioning; HAVING clause for category filter; proper revenue calculation as quantity * unit_price.",
    },
    {
        title: "Month-over-Month Revenue Growth",
        domain: "saas",
        difficulty: "Medium",
        problemStatement: `Calculate month-over-month revenue growth percentage for each month in the last 12 months. Return month, total_revenue, prev_month_revenue, and growth_pct. Flag any month with a decline greater than 10%.`,
        schema: [
            {
                tableName: "subscriptions",
                rowCountHint: "~5M rows",
                ddl: `CREATE TABLE subscriptions (
  subscription_id INT PRIMARY KEY,
  user_id INT,
  plan VARCHAR(50),
  amount DECIMAL(10,2),
  billing_date DATE
);`,
                columns: [
                    { name: "subscription_id", type: "INT", nullable: false },
                    { name: "user_id", type: "INT", nullable: false },
                    { name: "plan", type: "VARCHAR(50)", nullable: true },
                    { name: "amount", type: "DECIMAL(10,2)", nullable: false },
                    { name: "billing_date", type: "DATE", nullable: false },
                ],
            },
        ],
        sampleSolution: `WITH monthly AS (
  SELECT DATE_TRUNC('month', billing_date) AS month,
         SUM(amount) AS total_revenue
  FROM subscriptions
  WHERE billing_date >= CURRENT_DATE - INTERVAL '12 months'
  GROUP BY 1
),
with_lag AS (
  SELECT month, total_revenue,
         LAG(total_revenue) OVER (ORDER BY month) AS prev_month_revenue
  FROM monthly
)
SELECT month, total_revenue, prev_month_revenue,
       ROUND(100.0 * (total_revenue - prev_month_revenue) / NULLIF(prev_month_revenue, 0), 2) AS growth_pct,
       CASE WHEN (total_revenue - prev_month_revenue) / NULLIF(prev_month_revenue, 0) < -0.10 THEN TRUE ELSE FALSE END AS decline_flag
FROM with_lag
ORDER BY month;`,
        followUpQuestions: [
            "Why NULLIF(prev_month_revenue, 0) instead of just dividing directly?",
            "How would you handle missing months (months with zero revenue)?",
        ],
        evaluationCriteria: "LAG window function; NULLIF for division safety; correct 12-month filter; decline flag logic.",
    },
    {
        title: "Funnel Drop-off Analysis",
        domain: "saas",
        difficulty: "Medium",
        problemStatement: `Given a user event log, calculate the conversion funnel: signup → onboarding → first_feature_use → subscription. Return each stage name, user_count, and drop_off_rate from the previous stage.`,
        schema: [
            {
                tableName: "events",
                rowCountHint: "~100M rows",
                ddl: `CREATE TABLE events (
  event_id BIGINT PRIMARY KEY,
  user_id INT,
  event_type VARCHAR(100),
  event_time TIMESTAMP
);`,
                columns: [
                    { name: "event_id", type: "BIGINT", nullable: false },
                    { name: "user_id", type: "INT", nullable: false },
                    { name: "event_type", type: "VARCHAR(100)", nullable: false, description: "Values: signup, onboarding, first_feature_use, subscription" },
                    { name: "event_time", type: "TIMESTAMP", nullable: false },
                ],
            },
        ],
        sampleSolution: `WITH stage_counts AS (
  SELECT
    COUNT(DISTINCT CASE WHEN event_type = 'signup' THEN user_id END) AS signup_count,
    COUNT(DISTINCT CASE WHEN event_type = 'onboarding' THEN user_id END) AS onboarding_count,
    COUNT(DISTINCT CASE WHEN event_type = 'first_feature_use' THEN user_id END) AS feature_count,
    COUNT(DISTINCT CASE WHEN event_type = 'subscription' THEN user_id END) AS subscription_count
  FROM events
)
SELECT 'signup' AS stage, signup_count AS user_count, NULL AS drop_off_rate FROM stage_counts
UNION ALL
SELECT 'onboarding', onboarding_count, ROUND(100.0 * (signup_count - onboarding_count) / NULLIF(signup_count,0), 1) FROM stage_counts
UNION ALL
SELECT 'first_feature_use', feature_count, ROUND(100.0 * (onboarding_count - feature_count) / NULLIF(onboarding_count,0), 1) FROM stage_counts
UNION ALL
SELECT 'subscription', subscription_count, ROUND(100.0 * (feature_count - subscription_count) / NULLIF(feature_count,0), 1) FROM stage_counts;`,
        followUpQuestions: [
            "How would you enforce ordering — only count a user in stage N if they also completed stage N-1?",
            "How would you segment this funnel by acquisition channel?",
        ],
        evaluationCriteria: "CASE WHEN for conditional counting; correct drop-off rate formula; NULLIF for safety; ordered funnel interpretation.",
    },
    {
        title: "Delivery SLA Breach Analysis",
        domain: "logistics",
        difficulty: "Medium",
        problemStatement: `Find all orders where delivery exceeded the promised SLA by more than 2 days. Return order_id, carrier, promised_days, actual_days, breach_days, and bucket the breach severity as 'Minor' (3–5 days late), 'Major' (6–10), 'Critical' (>10).`,
        schema: [
            {
                tableName: "shipments",
                rowCountHint: "~30M rows",
                ddl: `CREATE TABLE shipments (
  order_id VARCHAR(36) PRIMARY KEY,
  carrier VARCHAR(100),
  ship_date DATE,
  delivery_date DATE,
  promised_days INT
);`,
                columns: [
                    { name: "order_id", type: "VARCHAR(36)", nullable: false },
                    { name: "carrier", type: "VARCHAR(100)", nullable: true },
                    { name: "ship_date", type: "DATE", nullable: false },
                    { name: "delivery_date", type: "DATE", nullable: true, description: "NULL if not yet delivered" },
                    { name: "promised_days", type: "INT", nullable: false },
                ],
            },
        ],
        sampleSolution: `SELECT order_id, carrier, promised_days,
       delivery_date - ship_date AS actual_days,
       (delivery_date - ship_date) - promised_days AS breach_days,
       CASE
         WHEN (delivery_date - ship_date) - promised_days BETWEEN 3 AND 5 THEN 'Minor'
         WHEN (delivery_date - ship_date) - promised_days BETWEEN 6 AND 10 THEN 'Major'
         WHEN (delivery_date - ship_date) - promised_days > 10 THEN 'Critical'
       END AS severity
FROM shipments
WHERE delivery_date IS NOT NULL
  AND (delivery_date - ship_date) - promised_days > 2
ORDER BY breach_days DESC;`,
        followUpQuestions: [
            "How would you aggregate breach rate by carrier?",
            "What happens to orders where delivery_date is NULL in your query?",
        ],
        evaluationCriteria: "Correct date arithmetic; NULL handling for undelivered orders; CASE WHEN bucketing; WHERE clause filtering > 2 days.",
    },
    {
        title: "Customer Lifetime Value by Segment",
        domain: "ecommerce",
        difficulty: "Hard",
        problemStatement: `Calculate 12-month LTV for each customer segment (defined by first purchase category). Return segment, customer_count, avg_ltv, median_ltv, and top_decile_ltv (90th percentile).`,
        schema: [
            {
                tableName: "orders",
                rowCountHint: "~80M rows",
                ddl: `CREATE TABLE orders (
  order_id VARCHAR(36) PRIMARY KEY,
  user_id INT,
  category VARCHAR(100),
  order_date DATE,
  order_value DECIMAL(10,2)
);`,
                columns: [
                    { name: "order_id", type: "VARCHAR(36)", nullable: false },
                    { name: "user_id", type: "INT", nullable: false },
                    { name: "category", type: "VARCHAR(100)", nullable: true },
                    { name: "order_date", type: "DATE", nullable: false },
                    { name: "order_value", type: "DECIMAL(10,2)", nullable: false },
                ],
            },
        ],
        sampleSolution: `WITH first_category AS (
  SELECT user_id,
         FIRST_VALUE(category) OVER (PARTITION BY user_id ORDER BY order_date) AS segment,
         MIN(order_date) OVER (PARTITION BY user_id) AS first_order_date
  FROM orders
),
ltv AS (
  SELECT o.user_id, fc.segment,
         SUM(o.order_value) AS ltv_12m
  FROM orders o
  JOIN (SELECT DISTINCT user_id, segment, first_order_date FROM first_category) fc ON o.user_id = fc.user_id
  WHERE o.order_date <= fc.first_order_date + INTERVAL '365 days'
  GROUP BY o.user_id, fc.segment
)
SELECT segment,
       COUNT(*) AS customer_count,
       ROUND(AVG(ltv_12m), 2) AS avg_ltv,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ltv_12m) AS median_ltv,
       PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ltv_12m) AS top_decile_ltv
FROM ltv
GROUP BY segment
ORDER BY avg_ltv DESC;`,
        followUpQuestions: [
            "What does PERCENTILE_CONT vs PERCENTILE_DISC return?",
            "Why FIRST_VALUE instead of a MIN subquery for the segment?",
        ],
        evaluationCriteria: "FIRST_VALUE or subquery for segment assignment; correct 12-month window from first purchase; PERCENTILE_CONT for median/p90.",
    },
    {
        title: "Duplicate Transaction Detection",
        domain: "fintech",
        difficulty: "Medium",
        problemStatement: `Find all suspected duplicate transactions: same user_id, same amount, within 5 minutes of each other. Return user_id, amount, first_txn_time, duplicate_txn_time, and minutes_apart.`,
        schema: [
            {
                tableName: "transactions",
                rowCountHint: "~500M rows",
                ddl: `CREATE TABLE transactions (
  txn_id BIGINT PRIMARY KEY,
  user_id INT,
  amount DECIMAL(12,2),
  txn_time TIMESTAMP,
  status VARCHAR(20)
);`,
                columns: [
                    { name: "txn_id", type: "BIGINT", nullable: false },
                    { name: "user_id", type: "INT", nullable: false },
                    { name: "amount", type: "DECIMAL(12,2)", nullable: false },
                    { name: "txn_time", type: "TIMESTAMP", nullable: false },
                    { name: "status", type: "VARCHAR(20)", nullable: true, description: "pending, completed, failed" },
                ],
            },
        ],
        sampleSolution: `SELECT a.user_id, a.amount,
       a.txn_time AS first_txn_time,
       b.txn_time AS duplicate_txn_time,
       ROUND(EXTRACT(EPOCH FROM (b.txn_time - a.txn_time)) / 60.0, 2) AS minutes_apart
FROM transactions a
JOIN transactions b
  ON a.user_id = b.user_id
  AND a.amount = b.amount
  AND b.txn_time > a.txn_time
  AND b.txn_time <= a.txn_time + INTERVAL '5 minutes'
WHERE a.status != 'failed'
  AND b.status != 'failed'
ORDER BY a.user_id, a.txn_time;`,
        followUpQuestions: [
            "How would this self-join perform on 500M rows — what index would you add?",
            "How would you handle floating-point amount comparisons?",
        ],
        evaluationCriteria: "Self-join on user_id + amount; correct 5-minute window; b.txn_time > a.txn_time avoids symmetric duplicates; status filter.",
    },
    {
        title: "Patient Readmission Rate",
        domain: "healthcare",
        difficulty: "Hard",
        problemStatement: `Calculate the 30-day readmission rate per hospital department. A readmission is any hospital visit within 30 days of a prior discharge for the same patient. Return department, total_discharges, readmissions, and readmission_rate_pct.`,
        schema: [
            {
                tableName: "visits",
                rowCountHint: "~10M rows",
                ddl: `CREATE TABLE visits (
  visit_id INT PRIMARY KEY,
  patient_id INT,
  department VARCHAR(100),
  admission_date DATE,
  discharge_date DATE
);`,
                columns: [
                    { name: "visit_id", type: "INT", nullable: false },
                    { name: "patient_id", type: "INT", nullable: false },
                    { name: "department", type: "VARCHAR(100)", nullable: false },
                    { name: "admission_date", type: "DATE", nullable: false },
                    { name: "discharge_date", type: "DATE", nullable: true, description: "NULL if still admitted" },
                ],
            },
        ],
        sampleSolution: `WITH completed AS (
  SELECT visit_id, patient_id, department, discharge_date
  FROM visits WHERE discharge_date IS NOT NULL
),
readmits AS (
  SELECT a.visit_id, a.department,
         CASE WHEN b.visit_id IS NOT NULL THEN 1 ELSE 0 END AS is_readmit
  FROM completed a
  LEFT JOIN visits b
    ON a.patient_id = b.patient_id
    AND b.admission_date > a.discharge_date
    AND b.admission_date <= a.discharge_date + 30
    AND b.visit_id != a.visit_id
)
SELECT department,
       COUNT(*) AS total_discharges,
       SUM(is_readmit) AS readmissions,
       ROUND(100.0 * SUM(is_readmit) / COUNT(*), 2) AS readmission_rate_pct
FROM readmits
GROUP BY department
ORDER BY readmission_rate_pct DESC;`,
        followUpQuestions: [
            "How does your query handle patients still admitted (NULL discharge_date)?",
            "If the same patient is readmitted twice in 30 days, how many readmissions does your query count?",
        ],
        evaluationCriteria: "NULL discharge_date filtering; correct 30-day window join; LEFT JOIN for non-readmitted; rate calculation.",
    },
    {
        title: "Session-Level Engagement Score",
        domain: "saas",
        difficulty: "Medium",
        problemStatement: `For each user, calculate their average session duration and session engagement score. A session = events by the same user within a 30-minute inactivity window. Engagement score = (pages_viewed * 2 + actions_taken * 5) / session_duration_minutes. Return user_id, session_count, avg_duration_minutes, avg_engagement_score.`,
        schema: [
            {
                tableName: "page_events",
                rowCountHint: "~500M rows",
                ddl: `CREATE TABLE page_events (
  event_id BIGINT PRIMARY KEY,
  user_id INT,
  event_type VARCHAR(50),
  page VARCHAR(200),
  event_time TIMESTAMP
);`,
                columns: [
                    { name: "event_id", type: "BIGINT", nullable: false },
                    { name: "user_id", type: "INT", nullable: false },
                    { name: "event_type", type: "VARCHAR(50)", nullable: false, description: "page_view or action" },
                    { name: "page", type: "VARCHAR(200)", nullable: true },
                    { name: "event_time", type: "TIMESTAMP", nullable: false },
                ],
            },
        ],
        sampleSolution: `WITH lagged AS (
  SELECT user_id, event_type, event_time,
         LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) AS prev_time
  FROM page_events
),
sessioned AS (
  SELECT user_id, event_type, event_time,
         SUM(CASE WHEN prev_time IS NULL OR event_time - prev_time > INTERVAL '30 minutes' THEN 1 ELSE 0 END)
           OVER (PARTITION BY user_id ORDER BY event_time) AS session_id
  FROM lagged
),
session_stats AS (
  SELECT user_id, session_id,
         EXTRACT(EPOCH FROM (MAX(event_time) - MIN(event_time))) / 60.0 AS duration_minutes,
         SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS pages_viewed,
         SUM(CASE WHEN event_type = 'action' THEN 1 ELSE 0 END) AS actions_taken
  FROM sessioned
  GROUP BY user_id, session_id
)
SELECT user_id,
       COUNT(*) AS session_count,
       ROUND(AVG(duration_minutes), 2) AS avg_duration_minutes,
       ROUND(AVG(CASE WHEN duration_minutes > 0
                 THEN (pages_viewed * 2.0 + actions_taken * 5.0) / duration_minutes
                 ELSE 0 END), 3) AS avg_engagement_score
FROM session_stats
GROUP BY user_id
ORDER BY avg_engagement_score DESC;`,
        followUpQuestions: [
            "What happens for single-event sessions where duration = 0?",
            "How does SUM with a CASE WHEN create the session boundaries?",
        ],
        evaluationCriteria: "Session boundary detection via 30-min LAG gap; running SUM for session ID; correct engagement score formula; zero-duration handling.",
    },
];

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI not set in .env");

    await mongoose.connect(uri);
    console.log("Connected to MongoDB");

    let inserted = 0;
    let skipped = 0;

    for (const q of QUESTIONS) {
        try {
            await DSSQLQuestion.create(q);
            inserted++;
            console.log(`✅ Inserted: ${q.title}`);
        } catch (err: any) {
            if (err.code === 11000) {
                skipped++;
                console.log(`⏭  Skipped (duplicate): ${q.title}`);
            } else {
                throw err;
            }
        }
    }

    console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}`);
    await mongoose.disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
