/** @type {import('next').NextConfig} */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "https://api.offensiveconditions.org";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output → minimal Docker runtime image (server.js + deps only).
  output: "standalone",
  // Proxy /api/* to the gateway during local dev so the browser hits one origin
  // and avoids CORS in development. In production the gateway is the origin.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_BASE}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=()",
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.offensiveconditions.org" },
      { protocol: "https", hostname: "avatars.offensiveconditions.org" },
    ],
  },
};

export default nextConfig;
