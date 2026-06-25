/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.html",
    "./*.js"
  ],
  theme: {
    extend: {
        colors: {
            'primary-green': '#364d14',
            'earth-brown': '#968067',
            'sand-beige': '#d9c7b2',
            'muted-green': '#5c6d4c',
            'bg-soft': '#f8f9fa',
        },
        fontFamily: {
            sans: ['Lato', 'sans-serif'],
            serif: ['Playfair Display', 'serif'],
        }
    }
  },
  plugins: [],
}
