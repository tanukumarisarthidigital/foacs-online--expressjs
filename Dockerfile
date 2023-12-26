FROM node:21

WORKDIR /app

# Update npm
RUN npm install -g npm@latest

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "controller.js"]
