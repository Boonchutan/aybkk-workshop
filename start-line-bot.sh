#!/bin/bash
# Start AYBKK LINE Student Bot
# Usage: ./start-line-bot.sh

export NODE_ENV=production
export PORT=3001
export NEO4J_URI=${NEO4J_URI:-bolt://localhost:7687}
export NEO4J_USER=${NEO4J_USER:-neo4j}
export NEO4J_PASSWORD=${NEO4J_PASSWORD:-poinefth水下123}

# LINE credentials (set in environment or .env file)
export LINE_CHANNEL_ACCESS_TOKEN=${LINE_CHANNEL_ACCESS_TOKEN}
export LINE_CHANNEL_SECRET=${LINE_CHANNEL_SECRET}
export LINE_WEBHOOK_VERIFY_TOKEN=${LINE_WEBHOOK_VERIFY_TOKEN:-aybkk-line-verify-token}

echo "[LINE Bot] Starting..."
echo "[LINE Bot] Port: $PORT"
echo "[LINE Bot] Neo4j: $NEO4J_URI"

cd "$(dirname "$0")"
node line-student-bot.js
