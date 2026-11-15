#!/bin/bash
# Start AYBKK LINE Student Bot
# Usage: ./start-line-bot.sh

export NODE_ENV=production
export PORT=3001
export NEO4J_URI=${NEO4J_URI:-bolt://localhost:7687}
export NEO4J_USER=${NEO4J_USER:-neo4j}

# Passwords and LINE credentials come from the environment or .env (line-student-bot.js loads it)

echo "[LINE Bot] Starting..."
echo "[LINE Bot] Port: $PORT"
echo "[LINE Bot] Neo4j: $NEO4J_URI"

cd "$(dirname "$0")"
node line-student-bot.js
