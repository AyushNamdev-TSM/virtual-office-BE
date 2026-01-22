# ============================================
# Auto-generated Dockerfile by MCP Analyzer
# Stack: TypeScript / NestJS
# ============================================

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for building (if needed)

# Copy dependency files
COPY package*.json ./

# Install all dependencies (including dev for building)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app


# Copy dependency files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

CMD ["node", "dist/main.js"]
