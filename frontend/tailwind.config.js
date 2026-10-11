/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic tokens driven by CSS variables (see index.css data-theme).
        app: "rgb(var(--color-bg) / <alpha-value>)",
        panel: "rgb(var(--color-panel) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        border: {
          DEFAULT: "rgb(var(--color-border) / <alpha-value>)",
        },
        ink: "rgb(var(--color-fg) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          dark: "rgb(var(--color-accent-bright) / <alpha-value>)",
        },
        "list-selected": "rgb(var(--color-list-selected) / <alpha-value>)",
        "list-hover": "rgb(var(--color-list-hover) / <alpha-value>)",
        input: "rgb(var(--color-input-bg) / <alpha-value>)",
      },
      borderRadius: {
        ui: "6px",
        listItem: "0",
        card: "6px",
      },
    },
  },
  plugins: [],
};
