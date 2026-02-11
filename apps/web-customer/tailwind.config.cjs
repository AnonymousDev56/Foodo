/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe7ff",
          200: "#bfd3ff",
          300: "#93b5ff",
          400: "#5f8dff",
          500: "#3b6cff",
          600: "#2751f2",
          700: "#2341de",
          800: "#2437b4",
          900: "#243588"
        },
        accent: {
          50: "#fff1f4",
          100: "#ffe4ea",
          200: "#ffcad7",
          300: "#ffa4bb",
          400: "#ff7095",
          500: "#fb3f73",
          600: "#e81d5d",
          700: "#c40f4e",
          800: "#a31145",
          900: "#88133f"
        }
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"]
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem"
      },
      boxShadow: {
        card: "0 12px 34px -18px rgba(15, 23, 42, 0.35)",
        glass: "0 8px 30px -20px rgba(15, 23, 42, 0.45)",
        float: "0 24px 60px -28px rgba(37, 99, 235, 0.35)"
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        },
        shimmer: {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(220%)" }
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.65" },
          "50%": { opacity: "1" }
        }
      },
      animation: {
        "fade-in-soft": "fadeIn 420ms ease-out both",
        "fade-in": "fadeInUp 500ms ease-out both",
        "fade-in-delayed": "fadeInUp 700ms ease-out both",
        shimmer: "shimmer 1.7s ease-in-out infinite",
        "pulse-soft": "pulseSoft 1.8s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
