FROM node:22-slim
WORKDIR /app
COPY package.json server.js backup.js backup-now.mjs restore.mjs ./
COPY public ./public
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/tasbeeh.db
EXPOSE 8080
CMD ["node", "--no-warnings", "server.js"]
