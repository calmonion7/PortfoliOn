#!/bin/bash
# C3 — uat311 회귀 가드: FAIL 0 · 단언 총계 ≥ 49 · baseline 47태그(승인된 2건 제외) 전부 생존
cd /Users/calmonion/Project/PortfoliOn
out=$(node scripts/uat311-tech15-visual.mjs 2>&1); ec=$?
fail=$(echo "$out" | grep -c '✗')
total=$(echo "$out" | grep -oE '단언 총계: [0-9]+' | grep -oE '[0-9]+')
echo "$out" | grep -oE '[✓✗] [a-zA-Z0-9:/_-]+' | awk '{print $2}' | sort -u > /tmp/uat311-tags-now.txt
# S1이 다시 쓰기로 승인된 2개 축은 하한에서 면제한다
grep -vE '^(identity:unpublished-exists|m278/detail:hscroll-set-is-baseline)$' scripts/uat311-baseline-tags.txt | sort -u > /tmp/uat311-tags-floor.txt
lost=$(comm -23 /tmp/uat311-tags-floor.txt /tmp/uat311-tags-now.txt)
echo "exit=$ec FAIL=$fail 단언총계=$total(하한 49) 유실태그=$(echo -n "$lost" | grep -c . )"
[ -n "$lost" ] && { echo "유실:"; echo "$lost"; }
[ "$fail" = "0" ] && [ -n "$total" ] && [ "$total" -ge 49 ] && [ -z "$lost" ] && echo "C3: PASS" || echo "C3: FAIL"
