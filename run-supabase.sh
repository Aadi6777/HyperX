#!/bin/bash
# HyperX Supabase Launch Script
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR/backend"

if [ -z "$1" ] && [ -z "$SPRING_DATASOURCE_PASSWORD" ]; then
    echo "=========================================================="
    echo "⚡ HyperX Supabase Launcher"
    echo "=========================================================="
    echo "Please provide your Supabase database password:"
    read -s -p "Enter Supabase DB Password: " DB_PASS
    echo ""
    export SPRING_DATASOURCE_PASSWORD="$DB_PASS"
elif [ -n "$1" ]; then
    export SPRING_DATASOURCE_PASSWORD="$1"
fi

export SPRING_DATASOURCE_URL="jdbc:postgresql://aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require&prepareThreshold=0"
export SPRING_DATASOURCE_USERNAME="postgres.okidlmhurydwefmxihbm"

echo "=========================================================="
echo "🚀 Connecting HyperX to Supabase (ap-south-1)..."
echo "Host: aws-0-ap-south-1.pooler.supabase.com:6543"
echo "User: postgres.okidlmhurydwefmxihbm"
echo "=========================================================="

./mvnw spring-boot:run
