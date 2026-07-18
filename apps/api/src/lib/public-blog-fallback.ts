export type PublicBlogPost = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  coverImage: string | null;
  content: string;
  authorId: string;
  author: {
    id: string;
    name: string;
    avatar: string | null;
  };
  status: "published";
  publishedAt: string;
  readTimeMinutes: number;
  views: number;
  tags: string[];
  featured: boolean;
  showAuthorName: boolean;
  createdAt: string;
  updatedAt: string;
};

const practersAuthor = {
  id: "practers-team",
  name: "Practers team",
  avatar: "/logo_small.svg",
};

export const publicBlogFallbackPosts: PublicBlogPost[] = [
  {
    id: "fallback-ai-mock-interview-platform-guide",
    slug: "how-to-choose-an-ai-mock-interview-platform",
    title: "How to Choose an AI Mock Interview Platform: A Practical Guide for Job Seekers",
    subtitle: "A no-fluff checklist for picking a practice tool that actually helps you answer better, not just feel productive.",
    coverImage: "/blog1.png",
    content: [
      "<p>Choosing an AI mock interview platform is less about chasing the flashiest demo and more about finding a tool that helps you practice the way real interviews feel.</p>",
      "<p>Look for realistic prompts, voice-based answers, role-specific practice, structured feedback, and progress tracking. A good platform should help you notice patterns in your answers, not just hand you a score.</p>",
      "<p>Before committing, try one complete session. Check whether the feedback tells you what to improve next, whether the questions match your target role, and whether the product makes it easy to repeat practice without friction.</p>",
    ].join(""),
    authorId: practersAuthor.id,
    author: practersAuthor,
    status: "published",
    publishedAt: "2026-06-02T00:00:00.000Z",
    readTimeMinutes: 21,
    views: 9,
    tags: ["AI Mock Interview"],
    featured: true,
    showAuthorName: true,
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  },
  {
    id: "fallback-role-of-ai-interview-preparation",
    slug: "role-of-ai-in-interview-preparation",
    title: "Role of AI in interview preparation",
    subtitle: "A complete guide to help you land your dream job",
    coverImage: "/blog2.png",
    content: [
      "<p>AI is changing interview preparation because it gives candidates a way to practice more often, with less dependency on another person being available.</p>",
      "<p>The biggest benefit is repetition with feedback. When you answer out loud, review your score, and try again, you build clarity and confidence faster than by only reading notes.</p>",
      "<p>AI should not replace human judgment. It works best as a practice layer that helps you prepare sharper examples before you speak to recruiters, peers, or hiring managers.</p>",
    ].join(""),
    authorId: practersAuthor.id,
    author: practersAuthor,
    status: "published",
    publishedAt: "2026-05-26T00:00:00.000Z",
    readTimeMinutes: 10,
    views: 32,
    tags: ["AI interview"],
    featured: false,
    showAuthorName: true,
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
  },
  {
    id: "fallback-ai-mock-interview-questions-practice",
    slug: "ai-mock-interview-questions-practice-guide",
    title: "AI Mock Interview Questions: How to Practice Without Memorizing Answers",
    subtitle: "A practical guide to using interview questions for stronger examples, clearer structure, and better spoken answers.",
    coverImage: "/blog3.jpg",
    content: [
      "<p>Good AI mock interview questions are not scripts to memorize. They are prompts that help you build a repeatable thinking process.</p>",
      "<p>For behavioral questions, prepare stories with context, action, and impact. For technical questions, explain trade-offs and assumptions before jumping to the answer.</p>",
      "<p>The goal is to sound prepared without sounding rehearsed. Practice enough that your structure becomes natural, then keep your examples specific to the role you want.</p>",
    ].join(""),
    authorId: practersAuthor.id,
    author: practersAuthor,
    status: "published",
    publishedAt: "2026-06-04T00:00:00.000Z",
    readTimeMinutes: 14,
    views: 0,
    tags: ["AI Mock Interview Questions"],
    featured: false,
    showAuthorName: true,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  },
];

export function getPublicBlogFallbackPost(slug: string) {
  return publicBlogFallbackPosts.find((post) => post.slug === slug) || null;
}
