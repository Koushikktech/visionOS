/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.VISIONOS_BUILD_DIR || '.next',
  reactStrictMode: false,
  webpack: (config, { webpack, isServer }) => {
    if (!isServer) {
      // PptxGenJS has guarded Node-only dynamic imports, but Webpack still
      // parses the `node:` scheme before consulting the package browser map.
      // Normalize only the client graph so its existing fallbacks can omit
      // those Node modules without changing server-side Node behavior.
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:(fs|https)$/, (resource) => {
        resource.request = resource.request.replace(/^node:/, '');
      }));
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        https: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;

