import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // FP-213: admin URLs renamed (Formation -> Training, Talks -> Sessions). The old URLs
  // redirect (307) so existing bookmarks keep working.
  async redirects() {
    return [
      { source: '/admin/formation', destination: '/admin/training', permanent: false },
      { source: '/admin/formation/:path*', destination: '/admin/training/:path*', permanent: false },
      { source: '/admin/formation-progress', destination: '/admin/training-progress', permanent: false },
      { source: '/admin/formation-progress/:path*', destination: '/admin/training-progress/:path*', permanent: false },
      { source: '/admin/restore/talks', destination: '/admin/restore/sessions', permanent: false },
    ];
  },
};

export default nextConfig;
