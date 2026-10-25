# Seerah Quest: no npm dependencies, so the image is just Node plus the app.
FROM node:22-slim
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/durood.db UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts/backup.mjs scripts/make-admin.mjs ./scripts/
# /data is the persistent volume (database, photos, backups); the app runs as an unprivileged user who can't rewrite its own code
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "--max-old-space-size=160", "server/index.js"]
