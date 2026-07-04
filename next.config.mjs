/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    proxyClientMaxBodySize: '25mb', // e.g. '25mb' or '50mb' for local dev
    // Keep build worker count low enough for small VPS/CI environments.
    // Override with NEXT_BUILD_WORKERS=4 or higher on stronger machines.
    cpus: Number.parseInt(process.env.NEXT_BUILD_WORKERS || '2', 10),
  },
};

export default nextConfig;
