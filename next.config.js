/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow longer serverless function timeout for multi-lens batch runs
  experimental: {
    serverComponentsExternalPackages: ["@anthropic-ai/sdk"],
  },
};

module.exports = nextConfig;
