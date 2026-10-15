#!/bin/bash
# HyperX Supabase Launch Script (Python / FastAPI Backend)
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR/backend"

if [ -z "$1" ] && [ -z "$SUPABASE_DB_PASSWORD" ] && [ -z "$DATABASE_PASSWORD" ]; then
    echo "=========================================================="
    echo "⚡ HyperX Supabase Launcher (Python / FastAPI)"
    echo "=========================================================="
    echo "Please provide your Supabase database password:"
    read -s -p "Enter Supabase DB Password: " DB_PASS
    echo ""
    export SUPABASE_DB_PASSWORD="$DB_PASS"
elif [ -n "$1" ]; then
    export SUPABASE_DB_PASSWORD="$1"
else
    export SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:-$DATABASE_PASSWORD}"
fi

export DB_USER="postgres.okidlmhurydwefmxihbm"
export DB_HOST="aws-0-ap-south-1.pooler.supabase.com"
export DB_PORT="6543"
export DB_NAME="postgres"

export DATABASE_URL="postgresql+asyncpg://${DB_USER}:${SUPABASE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?ssl=require"

echo "=========================================================="
echo "🚀 Connecting HyperX Python Backend to Supabase (ap-south-1)..."
echo "Host: ${DB_HOST}:${DB_PORT}"
echo "User: ${DB_USER}"
echo "=========================================================="

python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
