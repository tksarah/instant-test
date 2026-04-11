FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 pkg-config libsqlite3-dev sqlite3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --build-from-source

COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
