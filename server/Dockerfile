FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3 pkg-config libsqlite3-dev sqlite3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --build-from-source; \
    else \
      npm install --omit=dev --build-from-source; \
    fi

COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
