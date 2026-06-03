/** @type {import('next').NextConfig} */

// Allow cross-origin dev requests from a LAN device (e.g. testing on a phone) without
// committing a machine-specific IP. Set NEXT_DEV_ORIGIN to your LAN IP when needed.
const devOrigins = process.env.NEXT_DEV_ORIGIN ? [process.env.NEXT_DEV_ORIGIN] : [];

const nextConfig = {
  allowedDevOrigins: devOrigins,
};

export default nextConfig;
