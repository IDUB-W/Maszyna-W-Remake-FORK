FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=8787

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --chown=node:node . .

USER node

EXPOSE 8787

CMD ["node", "Server.js"]
