import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#08090b",
          900: "#0b0d11",
          850: "#0e1116",
          800: "#12161d",
          750: "#171c25",
          700: "#1d232e",
          600: "#272f3c",
          500: "#3a4454",
          400: "#5c6878",
          300: "#8b95a5",
          200: "#b7bfcb",
          100: "#dfe4ea",
        },
        acid: {
          400: "#7ff3c3",
          500: "#35e0a1",
          600: "#14b87f",
        },
        flare: {
          400: "#ff9f6e",
          500: "#ff7a45",
          600: "#e35a24",
        },
        iris: {
          400: "#9db4ff",
          500: "#6b8cff",
          600: "#4463e8",
        },
        cherry: {
          400: "#ff8095",
          500: "#f4506c",
          600: "#d32c4b",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        card: "10px",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 12px 32px -16px rgba(0,0,0,0.8)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 220ms cubic-bezier(0.22,1,0.36,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
