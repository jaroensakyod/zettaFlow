FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production AUTH_MODE=firebase HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server/index.mjs"]
