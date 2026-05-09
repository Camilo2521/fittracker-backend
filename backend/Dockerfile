FROM node:20-slim

WORKDIR /app

# Dependencias del sistema para better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

EXPOSE 3001
CMD ["node", "src/app.js"]
