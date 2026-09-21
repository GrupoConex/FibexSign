/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class", '[data-theme="opensigndark"]'],
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Nunito", "sans-serif"]
      },
      colors: {
        gray: {
          25: "#fcfcfd",
          50: "#f9fafb",
          100: "#f2f4f7",
          200: "#e4e7ec",
          300: "#d0d5dd",
          400: "#98a2b3",
          500: "#667085",
          600: "#475467",
          700: "#344054",
          800: "#1d2939",
          900: "#101828",
          950: "#0c111d"
        },
        "success-scale": {
          25: "#f6fef9",
          50: "#ecfdf3",
          100: "#d1fadf",
          200: "#a6f4c5",
          300: "#6ce9a6",
          400: "#32d583",
          500: "#12b76a",
          600: "#039855",
          700: "#027a48",
          800: "#05603a",
          900: "#054f31",
          950: "#053321"
        },
        "error-scale": {
          25: "#fffbfa",
          50: "#fef3f2",
          100: "#fee4e2",
          200: "#fecdca",
          300: "#fda29b",
          400: "#f97066",
          500: "#f04438",
          600: "#d92d20",
          700: "#b42318",
          800: "#912018",
          900: "#7a271a",
          950: "#55160c"
        },
        "warning-scale": {
          25: "#fffcf5",
          50: "#fffaeb",
          100: "#fef0c7",
          200: "#fedf89",
          300: "#fec84b",
          400: "#fdb022",
          500: "#f79009",
          600: "#dc6803",
          700: "#b54708",
          800: "#93370d",
          900: "#7a2e0e",
          950: "#4e1d09"
        },
        "blue-light": {
          25: "#f5fbff",
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#b9e6fe",
          300: "#7cd4fd",
          400: "#36bffa",
          500: "#0ba5ec",
          600: "#0086c9",
          700: "#026aa2",
          800: "#065986",
          900: "#0b4a6f",
          950: "#062c41"
        },
        royal: {
          25: "#f5f8ff",
          50: "#eff4fe",
          100: "#dbe6fe",
          200: "#bfd3fd",
          300: "#93b5fc",
          400: "#6090f7",
          500: "#1d4ed8", // Azul rey mate
          600: "#1e40af",
          700: "#1e3a8a",
          800: "#172554",
          900: "#0f172a",
          950: "#020617"
        },
        ice: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#b9e6fe"
        },
        night: {
          800: "#1c2a47",
          900: "#18233a",
          950: "#121b2d"
        },
        peach: {
          light: "#eff6ff",
          dark: "#1e293b"
        },
        pink: {
          500: "#ee46bc"
        },
        purple: {
          500: "#7a5af8"
        }
      }
    }
  },
  plugins: [
    require("daisyui"),
    function ({ addUtilities, addVariant }) {
      // ✅ Variants that match html[data-theme="..."] (or any ancestor with data-theme)
      addVariant("opensigncss", '[data-theme="opensigncss"] &');
      addVariant("opensigndark", '[data-theme="opensigndark"] &');

      addUtilities({
        // Prevent iOS long-press popup
        ".touch-callout-none": {
          "-webkit-touch-callout": "none"
        },
        // VS Code-style disabled button for all themes
        ".op-btn-vscode-disabled": {
          "background-color": "#3C3C3C !important",
          color: "#CCCCCC !important",
          "border-color": "#565656 !important",
          cursor: "not-allowed !important",
          opacity: "1 !important",
          "&:hover": {
            "background-color": "#3C3C3C !important",
            color: "#CCCCCC !important",
            "border-color": "#565656 !important",
            transform: "none !important"
          }
        },
        // Dark mode icon improvements using DaisyUI theme detection
        '[data-theme="opensigndark"] .icon-improved': {
          color: "#CCCCCC !important"
        },
        '[data-theme="opensigndark"] .icon-muted': {
          color: "#999999 !important"
        },
        '[data-theme="opensigndark"] .icon-disabled': {
          color: "#858585 !important"
        },
        // Gray text improvements for dark mode
        '[data-theme="opensigndark"] .text-gray-500': {
          color: "#CCCCCC !important"
        },
        '[data-theme="opensigndark"] .text-gray-400': {
          color: "#999999 !important"
        },
        '[data-theme="opensigndark"] .text-gray-600': {
          color: "#CCCCCC !important"
        },
        // CSS variable utilities that work with arbitrary values
        ".icon-themed": {
          color: "var(--icon-color)"
        },
        ".icon-themed-muted": {
          color: "var(--icon-color-muted)"
        },
        ".icon-themed-disabled": {
          color: "var(--icon-color-disabled)"
        },
        ".btn-themed-disabled": {
          "background-color": "var(--btn-disabled-bg)",
          color: "var(--btn-disabled-color)",
          "border-color": "var(--btn-disabled-border)",
          cursor: "not-allowed",
          "&:hover": {
            "background-color": "var(--btn-disabled-bg)",
            color: "var(--btn-disabled-color)",
            "border-color": "var(--btn-disabled-border)",
            transform: "none"
          }
        }
      });
    }
  ],
  daisyui: {
    // themes: true,
    themes: [
      {
        opensigndark: {
          primary: "#ffffff", // Blanco mate en dark mode
          "primary-content": "#0f172a", // Texto oscuro para contraste óptimo

          secondary: "#1e293b", // Slate oscuro
          "secondary-content": "#93c5fd", // Azul claro

          accent: "#3b82f6", // Azul
          "accent-content": "#FFFFFF",

          neutral: "#1d2939", // gray-800 border
          "neutral-content": "#98a2b3", // gray-400 text

          "base-100": "#101828", // gray-900 app background
          "base-200": "#1a2231", // gray-dark elevation (cards)
          "base-300": "#18233a", // night-900 further elevated panels
          "base-content": "#e6e8eb", // white/90 main text color

          info: "#0ba5ec", // blue-light-500
          "info-content": "#FFFFFF",
          success: "#12b76a",
          "success-content": "#FFFFFF",
          warning: "#f79009",
          "warning-content": "#FFFFFF",
          error: "#f04438",
          "error-content": "#FFFFFF",

          "--rounded-box": "0.875rem", // 14px para contenedores, modales y tarjetas
          "--rounded-btn": "0.75rem", // 12px para botones, inputs y menús (redondeo pronunciado pero moderno)
          "--rounded-badge": "0.5rem",
          "--tab-border": "2px",
          "--tab-radius": "0.625rem",

          // Custom CSS variables for icon and button states
          "--icon-color": "#CCCCCC",
          "--icon-color-muted": "#999999",
          "--icon-color-disabled": "#858585",
          "--btn-disabled-bg": "#3C3C3C",
          "--btn-disabled-color": "#CCCCCC",
          "--btn-disabled-border": "#565656",

          // Optional polish
          "--navbar-padding": "0.8rem",
          "--border-color": "#2C2C2C", // Card/table separation
          "--tooltip-color": "#1F2937"
        }
      },
      {
        opensigncss: {
          primary: "#1d4ed8", // Azul rey mate
          "primary-content": "#ffffff",
          secondary: "#eff6ff", // Azul muy claro mate
          "secondary-content": "#1d4ed8", // Azul rey
          accent: "#2563eb", // Azul acento
          "accent-content": "#ffffff",
          neutral: "#dbeafe", // Borde azul claro suave
          "neutral-content": "#1e3a8a", // Azul oscuro
          "base-100": "#edf4fc", // Fondo azul claro para contrastar con las tarjetas
          "base-200": "#e2eefb", // Azul claro elevación
          "base-300": "#dbeafe", // Azul claro para hovers y selecciones
          "base-content": "#000000", // Letras en NEGRO
          info: "#0ba5ec", // blue-light-500
          "info-content": "#ffffff",
          success: "#12b76a",
          "success-content": "#ffffff",
          warning: "#f79009",
          "warning-content": "#ffffff",
          error: "#f04438",
          "error-content": "#ffffff",
          "--rounded-box": "0.875rem",
          "--rounded-btn": "0.75rem",
          "--rounded-badge": "0.5rem",
          "--tab-border": "2px",
          "--tab-radius": "0.625rem"
        }
      }
    ],
    prefix: "op-"
  }
};
