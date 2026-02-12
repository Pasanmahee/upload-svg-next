/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    proxyClientMaxBodySize: '25mb', // e.g. '25mb' or '50mb' for local dev
  },
};

export default nextConfig;
