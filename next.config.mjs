/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "redmoon.world" }],
        destination: "https://www.redmoon.world/:path*",
        permanent: true,
      },
    ]
  },
}

//hee

export default nextConfig
