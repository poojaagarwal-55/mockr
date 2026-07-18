import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Turbopack from treating the home directory as the repo root.
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  transpilePackages: ["@interviewforge/shared"],
  async redirects() {
    if (process.env.NODE_ENV !== "development") return [];

    return [
      {
        source: "/companies/:path*",
        destination: "http://localhost:3003/companies/:path*",
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "fastly.picsum.photos",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
    ],
  },
};

export default nextConfig;
