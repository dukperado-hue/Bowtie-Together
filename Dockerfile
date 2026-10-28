FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY public ./public
COPY server ./server
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=3000 BOWTIE_DATA_DIR=/app/data
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node","server/index.js"]
