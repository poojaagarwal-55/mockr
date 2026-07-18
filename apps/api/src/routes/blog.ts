import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
  getPublicBlogFallbackPost,
  publicBlogFallbackPosts,
} from "../lib/public-blog-fallback.js";
import { checkRateLimit } from "../lib/rate-limiter.js";
import { uploadToR2BlogImage } from "../lib/r2.js";

const BLOG_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const blogImageMimeValues = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const declaredBlogImageMimeValues = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"] as const;
type BlogImageMime = typeof blogImageMimeValues[number];

const blogImageMetadataSchema = z.object({
  filename: z.string().min(1).max(255),
  mimetype: z.enum(declaredBlogImageMimeValues),
});

const blogImageUploadSchema = z.object({
  size: z.number().int().positive().max(BLOG_IMAGE_MAX_BYTES),
  declaredMime: z.enum(declaredBlogImageMimeValues),
  detectedMime: z.enum(blogImageMimeValues),
}).refine((data) => normalizeImageMime(data.declaredMime) === data.detectedMime, {
  message: "Declared file type does not match image content",
});

function normalizeImageMime(mime: string): BlogImageMime | null {
  if (mime === "image/jpg") return "image/jpeg";
  return blogImageMimeValues.includes(mime as BlogImageMime) ? (mime as BlogImageMime) : null;
}

function detectImageMime(buffer: Buffer): BlogImageMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }

  if (buffer.length >= 6) {
    const gifHeader = buffer.subarray(0, 6).toString("ascii");
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
      return "image/gif";
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function getImageExtension(mime: BlogImageMime): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
  }
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "blog-post";
}

async function getUniqueBlogSlug(title: string, excludeId?: string): Promise<string> {
  const baseSlug = slugifyTitle(title);
  let candidate = baseSlug;
  let suffix = 2;

  while (true) {
    const existing = await prisma.blog_posts.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!existing || existing.id === excludeId) {
      return candidate;
    }

    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

type BlogAuthor = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
};

function getBlogTeamAuthorEmails() {
  return new Set(
    (process.env.BLOG_TEAM_AUTHOR_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getBlogTeamDisplayName() {
  return process.env.BLOG_TEAM_DISPLAY_NAME?.trim() || "Practers team";
}

function getBlogTeamAvatarUrl() {
  return process.env.BLOG_TEAM_AVATAR_URL?.trim() || "/logo_small.svg";
}

function getPublicAuthor(authorId: string, authors: Map<string, BlogAuthor>) {
  const author = authors.get(authorId);
  const teamAuthorEmails = getBlogTeamAuthorEmails();
  const isTeamAuthor = Boolean(author?.email && teamAuthorEmails.has(author.email.toLowerCase()));

  if (isTeamAuthor) {
    return {
      id: author?.id || authorId,
      name: getBlogTeamDisplayName(),
      avatar: getBlogTeamAvatarUrl(),
    };
  }

  return {
    id: author?.id || authorId,
    name: author?.fullName || "Practers team",
    avatar: author?.avatarUrl || "/logo_small.svg",
  };
}

async function getAuthorsById(authorIds: string[]) {
  const uniqueAuthorIds = Array.from(new Set(authorIds.filter(Boolean)));
  if (uniqueAuthorIds.length === 0) return new Map<string, BlogAuthor>();

  const authors = await prisma.user.findMany({
    where: { id: { in: uniqueAuthorIds } },
    select: {
      id: true,
      fullName: true,
      email: true,
      avatarUrl: true,
    },
  });

  return new Map(authors.map((author) => [author.id, author]));
}

const blogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/images", { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;

    const rl = checkRateLimit(`blog-image-upload:${userId}`, 20, 600_000);
    if (!rl.allowed) {
      return reply.status(429).send({
        error: "Too Many Requests",
        message: `Image upload limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before uploading again.`,
      });
    }

    let data;
    try {
      data = await request.file();
    } catch (error) {
      fastify.log.warn(error, "Failed to read blog image upload");
      return reply.status(400).send({
        error: "Invalid upload",
        message: "Please upload an image under 5MB.",
      });
    }

    if (!data) {
      return reply.status(400).send({
        error: "No file provided",
        message: "Please upload an image file.",
      });
    }

    const metadata = blogImageMetadataSchema.safeParse({
      filename: data.filename,
      mimetype: data.mimetype,
    });

    if (!metadata.success) {
      return reply.status(400).send({
        error: "Invalid file type",
        message: "Only JPEG, PNG, GIF, and WebP images are allowed.",
      });
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;

    try {
      for await (const chunk of data.file) {
        totalSize += chunk.length;
        if (totalSize > BLOG_IMAGE_MAX_BYTES) {
          return reply.status(400).send({
            error: "File too large",
            message: "Image must be under 5MB.",
          });
        }
        chunks.push(chunk);
      }
    } catch (error) {
      fastify.log.warn(error, "Failed to stream blog image upload");
      return reply.status(400).send({
        error: "Invalid upload",
        message: "Please upload an image under 5MB.",
      });
    }

    const buffer = Buffer.concat(chunks);
    const detectedMime = detectImageMime(buffer);

    if (!detectedMime) {
      return reply.status(400).send({
        error: "Invalid file content",
        message: "The uploaded file is not a supported image.",
      });
    }

    const uploadValidation = blogImageUploadSchema.safeParse({
      size: buffer.length,
      declaredMime: metadata.data.mimetype,
      detectedMime,
    });

    if (!uploadValidation.success) {
      return reply.status(400).send({
        error: "Invalid image",
        message: "The uploaded file type could not be verified.",
      });
    }

    const key = `blog/${randomUUID()}.${getImageExtension(uploadValidation.data.detectedMime)}`;

    try {
      const url = await uploadToR2BlogImage(key, buffer, uploadValidation.data.detectedMime);
      return reply.status(201).send({ url });
    } catch (error) {
      fastify.log.error(error, "Failed to upload blog image to R2");
      return reply.status(500).send({
        error: "Upload Error",
        message: "Failed to upload the image. Please try again.",
      });
    }
  });

  // Get all published blog posts
  fastify.get("/posts", async (request, reply) => {
    try {
      const posts = await prisma.blog_posts.findMany({
        where: { status: "published" },
        orderBy: { published_at: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          subtitle: true,
          cover_image: true,
          content: true,
          author_id: true,
          status: true,
          published_at: true,
          read_time_minutes: true,
          views: true,
          tags: true,
          featured: true,
          show_author_name: true,
          created_at: true,
          updated_at: true,
        },
      });
      const authors = await getAuthorsById(posts.map((post) => post.author_id));

      return posts.map((post) => ({
        id: post.id,
        slug: post.slug,
        title: post.title,
        subtitle: post.subtitle,
        coverImage: post.cover_image,
        content: post.content,
        authorId: post.author_id,
        author: getPublicAuthor(post.author_id, authors),
        status: post.status,
        publishedAt: post.published_at,
        readTimeMinutes: post.read_time_minutes,
        views: post.views,
        tags: post.tags,
        featured: post.featured,
        showAuthorName: post.show_author_name,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
      }));
    } catch (error: any) {
      fastify.log.error(error);
      reply.header("x-practers-fallback", "public-blog-posts");
      return reply.send(publicBlogFallbackPosts);
    }
  });

  // Get metadata for a single published blog post without incrementing views
  fastify.get("/posts/:slug/metadata", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    try {
      const post = await prisma.blog_posts.findFirst({
        where: { slug, status: "published" },
        select: {
          slug: true,
          title: true,
          subtitle: true,
          cover_image: true,
          author_id: true,
          published_at: true,
          read_time_minutes: true,
          tags: true,
        },
      });

      if (!post) {
        return reply.status(404).send({ error: "Blog post not found" });
      }

      const authors = await getAuthorsById([post.author_id]);
      const author = getPublicAuthor(post.author_id, authors);

      return {
        slug: post.slug,
        title: post.title,
        subtitle: post.subtitle,
        coverImage: post.cover_image,
        publishedAt: post.published_at,
        readTimeMinutes: post.read_time_minutes,
        tags: post.tags,
        author: {
          name: author.name,
          avatar: author.avatar,
        },
      };
    } catch (error: any) {
      fastify.log.error(error);
      const fallbackPost = getPublicBlogFallbackPost(slug);
      if (!fallbackPost) {
        return reply.status(404).send({ error: "Blog post not found" });
      }

      reply.header("x-practers-fallback", "public-blog-post");
      return {
        slug: fallbackPost.slug,
        title: fallbackPost.title,
        subtitle: fallbackPost.subtitle,
        coverImage: fallbackPost.coverImage,
        publishedAt: fallbackPost.publishedAt,
        readTimeMinutes: fallbackPost.readTimeMinutes,
        tags: fallbackPost.tags,
        author: {
          name: fallbackPost.author.name,
          avatar: fallbackPost.author.avatar,
        },
      };
    }
  });

  // Get single blog post by slug
  fastify.get("/posts/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    try {
      const post = await prisma.blog_posts.findUnique({
        where: { slug },
        select: {
          id: true,
          slug: true,
          title: true,
          subtitle: true,
          cover_image: true,
          content: true,
          author_id: true,
          status: true,
          published_at: true,
          read_time_minutes: true,
          views: true,
          tags: true,
          featured: true,
          show_author_name: true,
          created_at: true,
          updated_at: true,
        },
      });

      if (!post) {
        return reply.status(404).send({ error: "Blog post not found" });
      }

      // Increment views
      await prisma.blog_posts.update({
        where: { id: post.id },
        data: { views: post.views + 1 },
      });
      const authors = await getAuthorsById([post.author_id]);

      return {
        id: post.id,
        slug: post.slug,
        title: post.title,
        subtitle: post.subtitle,
        coverImage: post.cover_image,
        content: post.content,
        authorId: post.author_id,
        author: getPublicAuthor(post.author_id, authors),
        status: post.status,
        publishedAt: post.published_at,
        readTimeMinutes: post.read_time_minutes,
        views: post.views + 1,
        tags: post.tags,
        featured: post.featured,
        showAuthorName: post.show_author_name,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
      };
    } catch (error: any) {
      fastify.log.error(error);
      const fallbackPost = getPublicBlogFallbackPost(slug);
      if (!fallbackPost) {
        return reply.status(404).send({ error: "Blog post not found" });
      }

      reply.header("x-practers-fallback", "public-blog-post");
      return fallbackPost;
    }
  });

  // Get user's drafts (authenticated)
  fastify.get("/drafts", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    try {
      const drafts = await prisma.blog_posts.findMany({
        where: {
          author_id: request.user.id,
          status: "draft",
        },
        orderBy: { updated_at: "desc" },
      });

      return drafts.map((post) => ({
        id: post.id,
        slug: post.slug,
        title: post.title,
        subtitle: post.subtitle,
        coverImage: post.cover_image,
        content: post.content,
        status: post.status,
        tags: post.tags,
        showAuthorName: post.show_author_name,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
      }));
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch drafts" });
    }
  });

  // Get all user's posts (both drafts and published) (authenticated)
  fastify.get("/my-posts", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    try {
      const posts = await prisma.blog_posts.findMany({
        where: {
          author_id: request.user.id,
          parent_post_id: null, // Only get parent posts, not draft versions
        },
        include: {
          draft_versions: {
            where: { status: "draft" },
            orderBy: { updated_at: "desc" },
            take: 1,
          },
        },
        orderBy: { updated_at: "desc" },
      });

      return posts.map((post) => ({
        id: post.id,
        slug: post.slug,
        title: post.title,
        subtitle: post.subtitle,
        coverImage: post.cover_image,
        content: post.content,
        status: post.status,
        tags: post.tags,
        publishedAt: post.published_at,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        hasDraftVersion: post.draft_versions.length > 0,
        draftVersionId: post.draft_versions.length > 0 ? post.draft_versions[0].id : null,
        showAuthorName: post.show_author_name,
      }));
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch posts" });
    }
  });

  // Get single draft by ID (authenticated)
  fastify.get("/drafts/:id", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { id } = request.params as { id: string };

    try {
      const post = await prisma.blog_posts.findUnique({
        where: { id },
        include: {
          draft_versions: {
            where: { status: "draft" },
            orderBy: { updated_at: "desc" },
            take: 1,
          },
        },
      });

      if (!post) {
        return reply.status(404).send({ error: "Post not found" });
      }

      // Verify ownership
      if (post.author_id !== request.user.id) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      // If this is a published post with a draft version, return the draft version
      if (post.status === "published" && post.draft_versions.length > 0) {
        const draftVersion = post.draft_versions[0];
        return {
          id: draftVersion.id,
          slug: draftVersion.slug,
          title: draftVersion.title,
          subtitle: draftVersion.subtitle,
          coverImage: draftVersion.cover_image,
          content: draftVersion.content,
          status: draftVersion.status,
          tags: draftVersion.tags,
          showAuthorName: draftVersion.show_author_name,
          parentPostId: draftVersion.parent_post_id || undefined,
          createdAt: draftVersion.created_at,
          updatedAt: draftVersion.updated_at,
        };
      }

      return {
        id: post.id,
        slug: post.slug,
        title: post.title,
        subtitle: post.subtitle,
        coverImage: post.cover_image,
        content: post.content,
        status: post.status,
        tags: post.tags,
        showAuthorName: post.show_author_name,
        parentPostId: post.parent_post_id || undefined,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
      };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch post" });
    }
  });

  // Create or update draft (authenticated)
  fastify.post("/drafts", { preHandler: fastify.authenticate, bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const schema = z.object({
      id: z.string().optional(),
      title: z.string().min(1).max(200),
      subtitle: z.string().max(300).optional(),
      content: z.string(),
      coverImage: z.string().optional(),
      tags: z.array(z.string()).optional(),
      showAuthorName: z.boolean().optional(),
    });

    try {
      const data = schema.parse(request.body);

      // Generate slug from title
      const slug = data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      // Calculate read time (rough estimate: 200 words per minute)
      const wordCount = data.content.split(/\s+/).length;
      const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

      if (data.id) {
        // Check if this is a published post or a draft
        const existingPost = await prisma.blog_posts.findUnique({
          where: { id: data.id },
          select: { status: true, author_id: true, parent_post_id: true },
        });

        if (!existingPost) {
          return reply.status(404).send({ error: "Post not found" });
        }

        if (existingPost.author_id !== request.user.id) {
          return reply.status(403).send({ error: "Forbidden" });
        }

        // If editing a published post, create/update a draft version
        if (existingPost.status === "published" && !existingPost.parent_post_id) {
          // Check if a draft version already exists
          const existingDraft = await prisma.blog_posts.findFirst({
            where: {
              parent_post_id: data.id,
              status: "draft",
            },
          });

          if (existingDraft) {
            // Update existing draft version
            const updated = await prisma.blog_posts.update({
              where: { id: existingDraft.id },
              data: {
                title: data.title,
                subtitle: data.subtitle || null,
                content: data.content,
                cover_image: data.coverImage || null,
                tags: data.tags || [],
                show_author_name: data.showAuthorName ?? true,
                read_time_minutes: readTimeMinutes,
                slug: `${slug}-draft-${Date.now()}`,
              },
            });

            return {
              id: updated.id,
              slug: updated.slug,
              title: updated.title,
              subtitle: updated.subtitle,
              content: updated.content,
              coverImage: updated.cover_image,
              tags: updated.tags,
              showAuthorName: updated.show_author_name,
              status: updated.status,
              parentPostId: updated.parent_post_id,
              updatedAt: updated.updated_at,
            };
          } else {
            // Create new draft version
            const draftVersion = await prisma.blog_posts.create({
              data: {
                author_id: request.user.id,
                title: data.title,
                subtitle: data.subtitle || null,
                content: data.content,
                cover_image: data.coverImage || null,
                tags: data.tags || [],
                show_author_name: data.showAuthorName ?? true,
                slug: `${slug}-draft-${Date.now()}`,
                read_time_minutes: readTimeMinutes,
                status: "draft",
                parent_post_id: data.id,
              },
            });

            return {
              id: draftVersion.id,
              slug: draftVersion.slug,
              title: draftVersion.title,
              subtitle: draftVersion.subtitle,
              content: draftVersion.content,
              coverImage: draftVersion.cover_image,
              tags: draftVersion.tags,
              showAuthorName: draftVersion.show_author_name,
              status: draftVersion.status,
              parentPostId: draftVersion.parent_post_id,
              createdAt: draftVersion.created_at,
            };
          }
        } else {
          // Update existing draft (not a published post)
          const updated = await prisma.blog_posts.update({
            where: { id: data.id },
            data: {
              title: data.title,
              subtitle: data.subtitle || null,
              content: data.content,
              cover_image: data.coverImage || null,
              tags: data.tags || [],
              show_author_name: data.showAuthorName ?? true,
              read_time_minutes: readTimeMinutes,
              slug: `${slug}-${Date.now()}`,
            },
          });

          return {
            id: updated.id,
            slug: updated.slug,
            title: updated.title,
            subtitle: updated.subtitle,
            content: updated.content,
            coverImage: updated.cover_image,
            tags: updated.tags,
            showAuthorName: updated.show_author_name,
            status: updated.status,
            parentPostId: updated.parent_post_id,
            updatedAt: updated.updated_at,
          };
        }
      } else {
        // Create new draft
        const created = await prisma.blog_posts.create({
          data: {
            author_id: request.user.id,
            title: data.title,
            subtitle: data.subtitle || null,
            content: data.content,
            cover_image: data.coverImage || null,
            tags: data.tags || [],
            show_author_name: data.showAuthorName ?? true,
            slug: `${slug}-${Date.now()}`,
            read_time_minutes: readTimeMinutes,
            status: "draft",
          },
        });

        return {
          id: created.id,
          slug: created.slug,
          title: created.title,
          subtitle: created.subtitle,
          content: created.content,
          coverImage: created.cover_image,
          tags: created.tags,
          showAuthorName: created.show_author_name,
          status: created.status,
          parentPostId: created.parent_post_id,
          createdAt: created.created_at,
        };
      }
    } catch (error: any) {
      fastify.log.error(error);
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: "Invalid request data", details: error.errors });
      }
      return reply.status(500).send({ error: "Failed to save draft" });
    }
  });

  // Publish blog post (authenticated)
  fastify.post("/publish", { preHandler: fastify.authenticate, bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const schema = z.object({
      id: z.string().optional(),
      title: z.string().min(1).max(200),
      subtitle: z.string().max(300).optional(),
      content: z.string().min(100),
      coverImage: z.string().optional(),
      tags: z.array(z.string()).min(1).max(5),
      showAuthorName: z.boolean().optional(),
    });

    try {
      const data = schema.parse(request.body);

      // Calculate read time
      const wordCount = data.content.split(/\s+/).length;
      const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

      if (data.id) {
        const existingPost = await prisma.blog_posts.findUnique({
          where: { id: data.id },
          select: { author_id: true },
        });

        if (!existingPost) {
          return reply.status(404).send({ error: "Post not found" });
        }

        if (existingPost.author_id !== request.user.id) {
          return reply.status(403).send({ error: "Forbidden" });
        }

        const slug = await getUniqueBlogSlug(data.title, data.id);

        // Update and publish existing draft
        const updated = await prisma.blog_posts.update({
          where: { id: data.id },
          data: {
            title: data.title,
            subtitle: data.subtitle || null,
            content: data.content,
            cover_image: data.coverImage || null,
            tags: data.tags,
            show_author_name: data.showAuthorName ?? true,
            slug,
            read_time_minutes: readTimeMinutes,
            status: "published",
            published_at: new Date(),
          },
        });

        return {
          id: updated.id,
          slug: updated.slug,
          message: "Blog post published successfully",
        };
      } else {
        const slug = await getUniqueBlogSlug(data.title);

        // Create and publish new post
        const created = await prisma.blog_posts.create({
          data: {
            author_id: request.user.id,
            title: data.title,
            subtitle: data.subtitle || null,
            content: data.content,
            cover_image: data.coverImage || null,
            tags: data.tags,
            show_author_name: data.showAuthorName ?? true,
            slug,
            read_time_minutes: readTimeMinutes,
            status: "published",
            published_at: new Date(),
          },
        });

        return {
          id: created.id,
          slug: created.slug,
          message: "Blog post published successfully",
        };
      }
    } catch (error: any) {
      fastify.log.error(error);
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: "Invalid request data", details: error.errors });
      }
      return reply.status(500).send({ error: "Failed to publish blog post" });
    }
  });

  // Republish: Apply draft changes to published post (authenticated)
  fastify.post("/republish", { preHandler: fastify.authenticate, bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const schema = z.object({
      draftId: z.string().optional(),
      parentPostId: z.string().optional(),
      title: z.string().min(1).max(200).optional(),
      subtitle: z.string().max(300).optional(),
      content: z.string().min(100).optional(),
      coverImage: z.string().optional(),
      tags: z.array(z.string()).min(1).max(5).optional(),
      showAuthorName: z.boolean().optional(),
    }).refine((data) => data.draftId || data.parentPostId, {
      message: "draftId or parentPostId is required",
    });

    try {
      const data = schema.parse(request.body);

      const sourcePostId = data.draftId || data.parentPostId!;

      // Get either the draft version or the published parent post.
      const sourcePost = await prisma.blog_posts.findUnique({
        where: { id: sourcePostId },
        select: {
          id: true,
          title: true,
          subtitle: true,
          content: true,
          cover_image: true,
          tags: true,
          show_author_name: true,
          read_time_minutes: true,
          parent_post_id: true,
          author_id: true,
          status: true,
        },
      });

      if (!sourcePost) {
        return reply.status(404).send({ error: "Post not found" });
      }

      if (sourcePost.author_id !== request.user.id) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const targetPostId = sourcePost.parent_post_id || (sourcePost.status === "published" ? sourcePost.id : data.parentPostId);
      const draftToDeleteId = sourcePost.parent_post_id ? sourcePost.id : null;

      if (!targetPostId) {
        return reply.status(400).send({ error: "This is not a draft version or published post" });
      }

      const targetPost = await prisma.blog_posts.findUnique({
        where: { id: targetPostId },
        select: { author_id: true, status: true, title: true, slug: true },
      });

      if (!targetPost) {
        return reply.status(404).send({ error: "Published post not found" });
      }

      if (targetPost.author_id !== request.user.id) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      if (targetPost.status !== "published") {
        return reply.status(400).send({ error: "Target post is not published" });
      }

      const sourceTitle = data.title?.trim() || sourcePost.title;
      const sourceContent = data.content || sourcePost.content;
      const sourceSubtitle = data.subtitle !== undefined ? data.subtitle || null : sourcePost.subtitle;
      const sourceCoverImage = data.coverImage !== undefined ? data.coverImage || null : sourcePost.cover_image;
      const sourceTags = data.tags && data.tags.length > 0 ? data.tags : sourcePost.tags;
      const sourceShowAuthorName = data.showAuthorName ?? sourcePost.show_author_name;
      const readTimeMinutes = Math.max(1, Math.ceil(sourceContent.split(/\s+/).filter(Boolean).length / 200));

      const slug =
        sourceTitle.trim() === targetPost.title
          ? targetPost.slug
          : await getUniqueBlogSlug(sourceTitle, targetPostId);

      // Update the published post with draft content
      const updated = await prisma.blog_posts.update({
        where: { id: targetPostId },
        data: {
          title: sourceTitle,
          subtitle: sourceSubtitle,
          content: sourceContent,
          cover_image: sourceCoverImage,
          tags: sourceTags,
          show_author_name: sourceShowAuthorName,
          slug,
          read_time_minutes: readTimeMinutes,
          updated_at: new Date(),
        },
      });

      if (draftToDeleteId) {
        await prisma.blog_posts.delete({
          where: { id: draftToDeleteId },
        });
      }

      return {
        id: updated.id,
        slug: updated.slug,
        message: "Blog post republished successfully",
      };
    } catch (error: any) {
      fastify.log.error(error);
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: "Invalid request data", details: error.errors });
      }
      return reply.status(500).send({ error: "Failed to republish blog post" });
    }
  });

  // Delete draft (authenticated)
  fastify.delete("/drafts/:id", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { id } = request.params as { id: string };

    try {
      // Verify ownership
      const post = await prisma.blog_posts.findUnique({
        where: { id },
        select: { author_id: true, status: true },
      });

      if (!post) {
        return reply.status(404).send({ error: "Post not found" });
      }

      if (post.author_id !== request.user.id) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      await prisma.blog_posts.delete({ where: { id } });

      return { message: "Post deleted successfully" };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to delete post" });
    }
  });

  // Set blog post as featured (editor's pick) - admin only
  fastify.patch("/posts/:slug/featured", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!request.user || request.user.email !== "fahadcontroller@practers.com") {
      return reply.status(403).send({ error: "Forbidden: Admin access required" });
    }

    const { slug } = request.params as { slug: string };

    try {
      const post = await prisma.blog_posts.findUnique({
        where: { slug },
      });

      if (!post) {
        return reply.status(404).send({ error: "Blog post not found" });
      }

      // Start a transaction to ensure only one featured post
      await prisma.$transaction([
        // Unfeature all posts
        prisma.blog_posts.updateMany({
          where: { featured: true },
          data: { featured: false },
        }),
        // Feature this post
        prisma.blog_posts.update({
          where: { id: post.id },
          data: { featured: true },
        }),
      ]);

      return { success: true, message: "Blog post marked as Editor's Pick" };
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to update Editor's Pick" });
    }
  });

  // Get comments for a blog post
  fastify.get("/posts/:slug/comments", async (request, reply) => {
    const { slug } = request.params as { slug: string };

    try {
      const post = await prisma.blog_posts.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!post) {
        return reply.status(404).send({ error: "Blog post not found" });
      }

      const comments = await prisma.blog_comments.findMany({
        where: { post_id: post.id },
        orderBy: { created_at: "desc" },
        include: {
          users: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      });

      return comments.map((comment) => ({
        id: comment.id,
        content: comment.content,
        createdAt: comment.created_at,
        user: {
          id: comment.users.id,
          name: comment.users.fullName,
          avatar: comment.users.avatarUrl,
        },
      }));
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch comments" });
    }
  });

  // Post a comment (authenticated)
  fastify.post("/posts/:slug/comments", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { slug } = request.params as { slug: string };
    const schema = z.object({
      content: z.string().min(1).max(1000),
    });

    try {
      const data = schema.parse(request.body);

      const post = await prisma.blog_posts.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!post) {
        return reply.status(404).send({ error: "Blog post not found" });
      }

      const comment = await prisma.blog_comments.create({
        data: {
          post_id: post.id,
          user_id: request.user.id,
          content: data.content,
        },
        include: {
          users: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      });

      return {
        id: comment.id,
        content: comment.content,
        createdAt: comment.created_at,
        user: {
          id: comment.users.id,
          name: comment.users.fullName,
          avatar: comment.users.avatarUrl,
        },
      };
    } catch (error: any) {
      fastify.log.error(error);
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: "Invalid request data", details: error.errors });
      }
      return reply.status(500).send({ error: "Failed to post comment" });
    }
  });

  // Get reactions for a blog post
  fastify.get("/posts/:slug/reactions", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const userId = request.user?.id;

    try {
      const post = await prisma.blog_posts.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!post) {
        return reply.status(404).send({ error: "Blog post not found" });
      }

      // Get all reactions for this post
      const reactions = await prisma.blog_reactions.findMany({
        where: { post_id: post.id },
        select: {
          reaction: true,
          user_id: true,
        },
      });

      // Count reactions by type
      const reactionCounts: Record<string, number> = {};
      const userReactions = new Set<string>();

      reactions.forEach((r) => {
        reactionCounts[r.reaction] = (reactionCounts[r.reaction] || 0) + 1;
        if (userId && r.user_id === userId) {
          userReactions.add(r.reaction);
        }
      });

      // Return all reaction types with counts
      const reactionTypes = ["like", "love", "insightful", "celebrate"];
      return reactionTypes.map((type) => ({
        reaction: type,
        count: reactionCounts[type] || 0,
        userReacted: userReactions.has(type),
      }));
    } catch (error: any) {
      fastify.log.error(error);
      return reply.status(500).send({ error: "Failed to fetch reactions" });
    }
  });

  // Toggle reaction (authenticated)
  fastify.post("/posts/:slug/reactions", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { slug } = request.params as { slug: string };
    const schema = z.object({
      reaction: z.enum(["like", "love", "insightful", "celebrate"]),
    });

    try {
      const data = schema.parse(request.body);

      const post = await prisma.blog_posts.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!post) {
        return reply.status(404).send({ error: "Blog post not found" });
      }

      // Check if user already reacted with this type
      const existingReaction = await prisma.blog_reactions.findUnique({
        where: {
          post_id_user_id: {
            post_id: post.id,
            user_id: request.user.id,
          },
        },
      });

      if (existingReaction) {
        if (existingReaction.reaction === data.reaction) {
          // Remove reaction if clicking the same one
          await prisma.blog_reactions.delete({
            where: {
              post_id_user_id: {
                post_id: post.id,
                user_id: request.user.id,
              },
            },
          });
          return { action: "removed", reaction: data.reaction };
        } else {
          // Update to new reaction type
          await prisma.blog_reactions.update({
            where: {
              post_id_user_id: {
                post_id: post.id,
                user_id: request.user.id,
              },
            },
            data: { reaction: data.reaction },
          });
          return { action: "updated", reaction: data.reaction };
        }
      } else {
        // Create new reaction
        await prisma.blog_reactions.create({
          data: {
            post_id: post.id,
            user_id: request.user.id,
            reaction: data.reaction,
          },
        });
        return { action: "added", reaction: data.reaction };
      }
    } catch (error: any) {
      fastify.log.error(error);
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: "Invalid request data", details: error.errors });
      }
      return reply.status(500).send({ error: "Failed to toggle reaction" });
    }
  });
};

export default blogRoutes;
