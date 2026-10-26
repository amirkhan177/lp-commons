# Build context: apps/linkedin-agent. Image version must match the playwright package version.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
RUN npm install -g pnpm@12.14.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY src ./src
ENV NODE_ENV=production
USER pwuser
CMD ["node_modules/.bin/tsx", "src/server.ts"]
