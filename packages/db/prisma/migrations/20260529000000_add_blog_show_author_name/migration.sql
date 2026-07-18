ALTER TABLE "blog_posts"
ADD COLUMN IF NOT EXISTS "show_author_name" BOOLEAN NOT NULL DEFAULT true;
