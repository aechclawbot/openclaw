FROM node:22-alpine
WORKDIR /app

# Install deps first for layer caching
COPY package.json ./
RUN npm install --production

# Copy application code
COPY . .

# Set ownership for security
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
