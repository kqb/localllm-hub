/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0d1117',
        'bg-2': '#161b22',
        'bg-3': '#21262d',
        border: '#30363d',
        text: '#e6edf3',
        'text-2': '#8b949e',
        accent: '#58a6ff',
        green: '#3fb950',
        red: '#f85149',
        yellow: '#d29922',
        purple: '#bc8cff',
        orange: '#f0883e',
      },
      borderRadius: {
        DEFAULT: '8px',
      },
      boxShadow: {
        DEFAULT: '0 1px 3px rgba(0,0,0,.3)',
      },
    },
  },
  plugins: [],
};
