FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV DATA_DIR=/app/data
ENV TARGETS_FILE=/app/data/targets.json
RUN mkdir -p /app/data
CMD ["node", "src/index.js"]
