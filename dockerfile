FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY index.js ./

RUN mkdir -p /app/data && chown -R node:node /app

CMD ["node", "index.js"]