FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]