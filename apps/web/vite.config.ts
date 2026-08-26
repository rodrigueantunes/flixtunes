import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "FlixTunes",
        short_name: "FlixTunes",
        description: "Votre cinéma local, fluide sur tous vos écrans.",
        theme_color: "#080b12",
        background_color: "#080b12",
        display: "standalone",
        // La langue déclarée doit être celle de l'interface, sinon un lecteur d'écran installé
        // depuis l'écran d'accueil annonce les libellés français avec une prononciation anglaise.
        lang: "fr",
        // Les tailles annoncées ici sont vérifiées par `budgets.test.ts` contre les fichiers réels :
        // une déclaration fausse fait choisir la mauvaise icône, ou la fait rejeter.
        icons: [
          { src: "/brand/favicon.png", sizes: "64x64", type: "image/png", purpose: "any" },
          { src: "/brand/flixtunes-logo.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    proxy: { "/api": "http://localhost:4000" },
  },
});
