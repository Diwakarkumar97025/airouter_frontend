# Build stage
FROM node:18-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install


COPY . .


RUN npm run build

# Serve stage
FROM nginx:alpine
WORKDIR /usr/share/nginx/html


COPY --from=builder /app/dist .

EXPOSE 80
