/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile workspace packages so they're picked up by Next's bundler.
  transpilePackages: ['@pcs/db', '@pcs/core', '@pcs/connectors'],
  experimental: {
    // We hit Prisma from server components / route handlers; mark it external so
    // Next doesn't try to bundle the engine binary.
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
};

export default nextConfig;
