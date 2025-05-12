# Use Node.js LTS version as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install dependencies for node-gyp and other native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies including devDependencies first
RUN npm install

# Copy application code
COPY . .

# Build the application if needed
RUN npm run build --if-present

# Remove development dependencies
RUN npm prune --production

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production

# Start the application
CMD ["node", "server.js"]