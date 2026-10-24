FROM node:22-alpine

ENV NODE_ENV=production
ENV WS_HOST=0.0.0.0
ENV WS_PORT=8080

WORKDIR /app

COPY ws-relay/package.json ws-relay/package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY Server.cjs ./Server.cjs

USER node

EXPOSE 8080

CMD ["node", "Server.cjs"]
