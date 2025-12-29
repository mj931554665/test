# Base image with Node.js and Playwright browsers
FROM mcr.microsoft.com/playwright:v1.56.1-noble

# Set working directory
WORKDIR /app

# Install dependencies first (for caching)
COPY package.json ./
RUN npm install --production

# Copy source code (respects .dockerignore)
COPY . .

# Environment variables
ENV NODE_ENV=production
ENV PORT=11415

# Expose port
EXPOSE 11415

# Start command
CMD ["npm", "start"]
