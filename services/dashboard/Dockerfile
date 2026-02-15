FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.js"]
