-- Create blog_posts table
CREATE TABLE IF NOT EXISTS blog_posts (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    content TEXT NOT NULL,
    cover_image TEXT,
    author_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    published_at TIMESTAMP(3),
    read_time_minutes INTEGER NOT NULL DEFAULT 5,
    views INTEGER NOT NULL DEFAULT 0,
    tags JSONB NOT NULL DEFAULT '[]',
    featured BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT blog_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create indexes for blog_posts
CREATE INDEX IF NOT EXISTS blog_posts_slug_idx ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS blog_posts_author_id_idx ON blog_posts(author_id);
CREATE INDEX IF NOT EXISTS blog_posts_status_published_at_idx ON blog_posts(status, published_at);
CREATE INDEX IF NOT EXISTS blog_posts_featured_status_idx ON blog_posts(featured, status);

-- Create blog_comments table
CREATE TABLE IF NOT EXISTS blog_comments (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT blog_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT blog_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create indexes for blog_comments
CREATE INDEX IF NOT EXISTS blog_comments_post_id_created_at_idx ON blog_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS blog_comments_user_id_idx ON blog_comments(user_id);

-- Insert dummy blog posts
DO $$
DECLARE
    v_user_id TEXT;
BEGIN
    -- Get the first user ID
    SELECT id INTO v_user_id FROM users LIMIT 1;
    
    IF v_user_id IS NOT NULL THEN
        -- Insert blog post 1
        INSERT INTO blog_posts (id, slug, title, subtitle, content, cover_image, author_id, status, published_at, read_time_minutes, views, tags, featured)
        VALUES (
            gen_random_uuid()::text,
            'master-technical-interviews-with-ai',
            'Master Technical Interviews with AI: The Complete Guide',
            'Discover how AI-powered interview practice is revolutionizing the way candidates prepare for technical interviews.',
            '<p>Technical interviews can be daunting, but with the right preparation and tools, you can ace them with confidence. In this comprehensive guide, we''ll explore how AI-powered interview practice is changing the game for job seekers.</p><h2>Why AI-Powered Practice?</h2><p>Traditional interview preparation methods often fall short because they lack real-time feedback and personalized coaching. AI changes this by providing instant analysis of your performance, identifying weak spots, and offering targeted improvements.</p><h2>Key Benefits</h2><ul><li>Real-time feedback on your answers</li><li>Personalized coaching based on your performance</li><li>Practice anytime, anywhere</li><li>Build confidence through repetition</li></ul><h2>Getting Started</h2><p>Start by identifying your target role and the types of questions you''re likely to face. Then, use AI-powered tools to practice regularly, focusing on areas where you need the most improvement.</p>',
            '/bloghero.png',
            v_user_id,
            'published',
            CURRENT_TIMESTAMP,
            12,
            3200,
            '["Interview Tips", "AI Technology"]'::jsonb,
            true
        ) ON CONFLICT (slug) DO NOTHING;

        -- Insert blog post 2
        INSERT INTO blog_posts (id, slug, title, subtitle, content, cover_image, author_id, status, published_at, read_time_minutes, views, tags, featured)
        VALUES (
            gen_random_uuid()::text,
            'common-coding-interview-mistakes',
            '5 Common Coding Interview Mistakes and How to Avoid Them',
            'Learn from the most common pitfalls candidates face during coding interviews.',
            '<p>Coding interviews are challenging, and even experienced developers make mistakes. Here are the five most common errors and how to avoid them.</p><h2>1. Not Asking Clarifying Questions</h2><p>Many candidates jump straight into coding without fully understanding the problem. Always ask questions to clarify requirements, edge cases, and constraints.</p><h2>2. Poor Time Management</h2><p>Spending too much time on one approach can leave you without time to complete the solution. Practice time management and know when to pivot.</p><h2>3. Ignoring Edge Cases</h2><p>Don''t forget to consider edge cases like empty inputs, null values, and boundary conditions. Discuss these with your interviewer.</p><h2>4. Not Communicating Your Thought Process</h2><p>Interviewers want to understand how you think. Talk through your approach, explain your reasoning, and discuss trade-offs.</p><h2>5. Giving Up Too Quickly</h2><p>If you''re stuck, don''t panic. Take a step back, consider alternative approaches, and ask for hints if needed.</p>',
            '/blog1.png',
            v_user_id,
            'published',
            CURRENT_TIMESTAMP - INTERVAL '3 days',
            8,
            2800,
            '["Interview Tips", "Coding"]'::jsonb,
            false
        ) ON CONFLICT (slug) DO NOTHING;

        -- Insert blog post 3
        INSERT INTO blog_posts (id, slug, title, subtitle, content, cover_image, author_id, status, published_at, read_time_minutes, views, tags, featured)
        VALUES (
            gen_random_uuid()::text,
            'ai-feedback-accelerates-preparation',
            'How AI Feedback Accelerates Your Interview Preparation',
            'Explore how real-time AI analysis helps you identify weak spots and improve faster.',
            '<p>The traditional way of preparing for interviews involves practicing with friends, recording yourself, or hiring expensive coaches. AI feedback changes this paradigm entirely.</p><h2>Instant Analysis</h2><p>AI can analyze your responses in real-time, providing immediate feedback on your communication style, technical accuracy, and problem-solving approach.</p><h2>Personalized Learning Path</h2><p>Based on your performance, AI creates a personalized learning path that focuses on your weaknesses while reinforcing your strengths.</p><h2>Data-Driven Insights</h2><p>Track your progress over time with detailed analytics. See how you''re improving in specific areas and where you need more practice.</p><h2>24/7 Availability</h2><p>Unlike human coaches, AI is available whenever you need it. Practice at 2 AM or during your lunch break - the choice is yours.</p>',
            '/blog2.png',
            v_user_id,
            'published',
            CURRENT_TIMESTAMP - INTERVAL '5 days',
            7,
            3100,
            '["AI Technology", "Practice Strategies"]'::jsonb,
            false
        ) ON CONFLICT (slug) DO NOTHING;

        -- Insert blog post 4
        INSERT INTO blog_posts (id, slug, title, subtitle, content, cover_image, author_id, status, published_at, read_time_minutes, views, tags, featured)
        VALUES (
            gen_random_uuid()::text,
            'system-design-interview-guide',
            'System Design Interviews: A Step-by-Step Preparation Guide',
            'Master the art of system design interviews with our comprehensive guide.',
            '<p>System design interviews are often the most challenging part of the technical interview process. They require you to demonstrate not just coding skills, but also architectural thinking and communication abilities.</p><h2>Understanding the Basics</h2><p>Before diving into complex systems, make sure you understand fundamental concepts like load balancing, caching, databases, and microservices.</p><h2>The Framework</h2><p>Follow a structured approach: clarify requirements, estimate scale, design high-level architecture, dive into components, and discuss trade-offs.</p><h2>Common Patterns</h2><p>Learn common design patterns like database sharding, CDN usage, message queues, and rate limiting. These patterns appear frequently in interviews.</p><h2>Practice Makes Perfect</h2><p>Practice designing real-world systems like Twitter, Uber, or Netflix. Focus on explaining your decisions and handling follow-up questions.</p>',
            '/blog3.jpg',
            v_user_id,
            'published',
            CURRENT_TIMESTAMP - INTERVAL '7 days',
            9,
            4500,
            '["Interview Tips", "System Design"]'::jsonb,
            false
        ) ON CONFLICT (slug) DO NOTHING;

        -- Insert blog post 5
        INSERT INTO blog_posts (id, slug, title, subtitle, content, cover_image, author_id, status, published_at, read_time_minutes, views, tags, featured)
        VALUES (
            gen_random_uuid()::text,
            'interview-success-stories',
            'From Nervous to Confident: Real Interview Success Stories',
            'Read inspiring stories from candidates who transformed their interview performance.',
            '<p>Nothing is more motivating than hearing real success stories from people who''ve been in your shoes. Here are three inspiring journeys of candidates who went from nervous to confident.</p><h2>Sarah''s Story: From 10 Rejections to Dream Job</h2><p>Sarah failed her first 10 technical interviews. Instead of giving up, she used AI-powered practice to identify her weaknesses. Six months later, she landed her dream job at a top tech company.</p><h2>Michael''s Journey: Overcoming Interview Anxiety</h2><p>Michael struggled with interview anxiety that affected his performance. Through consistent practice and AI feedback, he learned to manage his nerves and communicate effectively.</p><h2>Priya''s Transformation: From Junior to Senior</h2><p>Priya wanted to level up from junior to senior developer. She used structured practice to improve her system design skills and successfully made the transition.</p><h2>Key Takeaways</h2><p>All three candidates shared common traits: persistence, structured practice, and willingness to learn from feedback.</p>',
            '/blog4.jpg',
            v_user_id,
            'published',
            CURRENT_TIMESTAMP - INTERVAL '10 days',
            6,
            2300,
            '["Success Stories", "Career Growth"]'::jsonb,
            false
        ) ON CONFLICT (slug) DO NOTHING;
    END IF;
END $$;
