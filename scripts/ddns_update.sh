#!/bin/bash
# scripts/ddns_update.sh
# Cloudflare DDNS auto-update for portfolion.taebro.com
#
# Usage:
#   export CF_ZONE_ID="your_cloudflare_zone_id"
#   export CF_RECORD_ID="your_dns_a_record_id"
#   export CF_API_TOKEN="your_cloudflare_api_token"
#   ./scripts/ddns_update.sh
#
# Setup:
#   1. Get ZONE_ID from Cloudflare dashboard (Zone Overview, right panel)
#   2. Get RECORD_ID: curl -s -X GET https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records \
#      -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | select(.name=="portfolion.taebro.com") | .id'
#   3. Cron (every 5 min): */5 * * * * /path/to/ddns_update.sh

set -euo pipefail

ZONE_ID="${CF_ZONE_ID:-}"
RECORD_ID="${CF_RECORD_ID:-}"
API_TOKEN="${CF_API_TOKEN:-}"
DOMAIN="portfolion.taebro.com"
IP_CACHE="/tmp/ddns_last_ip"

if [ -z "$ZONE_ID" ] || [ -z "$RECORD_ID" ] || [ -z "$API_TOKEN" ]; then
    echo "Error: Missing Cloudflare credentials"
    echo "Set CF_ZONE_ID, CF_RECORD_ID, CF_API_TOKEN environment variables"
    exit 1
fi

CURRENT_IP=$(curl -s https://api.ipify.org)
STORED_IP=$(cat "$IP_CACHE" 2>/dev/null || echo "")

if [ "$CURRENT_IP" != "$STORED_IP" ]; then
    RESPONSE=$(curl -s -X PATCH \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
        -H "Authorization: Bearer $API_TOKEN" \
        -H "Content-Type: application/json" \
        --data "{\"content\":\"$CURRENT_IP\",\"name\":\"$DOMAIN\",\"type\":\"A\",\"ttl\":60}")

    if echo "$RESPONSE" | grep -q '"success":true'; then
        echo "$CURRENT_IP" > "$IP_CACHE"
        echo "$(date '+%Y-%m-%d %H:%M:%S'): IP updated to $CURRENT_IP"
    else
        echo "$(date '+%Y-%m-%d %H:%M:%S'): DDNS update failed: $RESPONSE" >&2
        exit 1
    fi
else
    echo "$(date '+%Y-%m-%d %H:%M:%S'): IP unchanged ($CURRENT_IP)"
fi
