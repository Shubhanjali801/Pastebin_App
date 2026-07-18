# ---- build stage: compile TypeScript -> JavaScript ----
FROM node:22-alpine AS build
WORKDIR /app

# Prisma's query engine links against libssl; Alpine needs it installed explicitly.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: only prod deps + compiled output ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# libssl must be present at runtime too, for the Prisma engine to load.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist

# Local blob store lives here in dev/self-host. For durability, mount a volume or
# (better) point BLOB_DIR at object storage via an S3BlobStore in production.
ENV BLOB_DIR=/app/data/blobs
RUN mkdir -p /app/data/blobs

EXPOSE 3000

# Apply migrations, then start.
CMD ["npm", "run", "start:prod"]
