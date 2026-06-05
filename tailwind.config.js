/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      colors: {
        enigma: {
          verified: "#10b981", // green-500
          warning: "#f59e0b", // amber-500
          flag: "#ef4444", // red-500
          uncertain: "#9ca3af", // gray-400
          accent: "#7c6fe0", // purple-ish (ENIGMA brand)
        },
      },
    },
  },
  plugins: [],
};
