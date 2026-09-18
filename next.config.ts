import type { NextConfig } from "next";

// Este app é 100% client-side (lê planilhas locais via File System Access
// API), então sai como export estático — roda em qualquer host estático
// (Cloudflare Workers/Pages, Vercel, Netlify, um servidor de arquivos).
// Nenhum servidor Node.js é necessário em produção.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
