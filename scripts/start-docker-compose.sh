#!/bin/bash
# Docker 소켓이 준비될 때까지 대기
until docker info > /dev/null 2>&1; do
    sleep 2
done

cd /Users/calmonion/Project/PortfoliOn/.claude/worktrees/docker-infra-migration
docker compose up -d
