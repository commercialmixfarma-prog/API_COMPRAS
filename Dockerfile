FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production TZ=America/Fortaleza
RUN apk add --no-cache tzdata \
    && mkdir -p /app/logs && chown node:node /app/logs
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const r=require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>{r.resume();process.exit(r.statusCode===200?0:1)});r.setTimeout(4000,()=>{r.destroy();process.exit(1)});r.on('error',()=>process.exit(1))"
CMD ["node", "src/app.js"]
