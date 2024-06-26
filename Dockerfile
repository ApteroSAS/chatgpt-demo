FROM node:18.17-alpine as builder
WORKDIR /usr/src
RUN npm install -g pnpm@9.1.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install
COPY . .
RUN pnpm run build

FROM node:18.17-alpine
WORKDIR /usr/src
RUN npm install -g pnpm@9.1.0
COPY --from=builder /usr/src/dist ./dist
COPY --from=builder /usr/src/hack ./
COPY package.json pnpm-lock.yaml ./
RUN pnpm install
ENV HOST=0.0.0.0 PORT=80 NODE_ENV=production
EXPOSE $PORT
CMD ["/bin/sh", "docker-entrypoint.sh"]
