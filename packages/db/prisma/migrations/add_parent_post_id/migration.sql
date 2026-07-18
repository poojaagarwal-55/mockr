-- Add parent_post_id field to blog_posts table for versioning
ALTER TABLE "blog_posts" ADD COLUMN "parent_post_id" TEXT;

-- Add foreign key constraint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_parent_post_id_fkey" 
  FOREIGN KEY ("parent_post_id") REFERENCES "blog_posts"("id") ON DELETE CASCADE;

-- Add index for performance
CREATE INDEX "blog_posts_parent_post_id_idx" ON "blog_posts"("parent_post_id");
