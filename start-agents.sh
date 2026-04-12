#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/agents.json"

if [ ! -f "$CONFIG" ]; then
    echo "Error: agents.json not found at $CONFIG"
    exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "Error: python3 required"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "Error: jq required (brew install jq)"; exit 1; }

# Load .env so ANTHROPIC_API_KEY (and any other vars) reach the Python servers
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/.env"
    set +a
fi

PIDS=()
cleanup() {
    echo ""
    echo "Stopping all agent servers..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
    echo "All servers stopped."
}
trap cleanup EXIT INT TERM

# Activate A2A venv if present
A2A_VENV="$SCRIPT_DIR/external/a2a/.venv/bin/activate"
CREWAI_VENV="$SCRIPT_DIR/external/crewai/.venv/bin/activate"

# Start CrewAI server on port 8000
echo "Starting CrewAI server on port 8000..."
(
    if [ -f "$CREWAI_VENV" ]; then source "$CREWAI_VENV"; fi
    cd "$SCRIPT_DIR/external/crewai"
    python3 -m uvicorn app.main:app --port 8000 --log-level warning
) &
PIDS+=($!)

# Start A2A servers (one per agent from config)
AGENT_COUNT=$(jq '.agents | length' "$CONFIG")
for i in $(seq 0 $((AGENT_COUNT - 1))); do
    NAME=$(jq -r ".agents[$i].name" "$CONFIG")
    SKILLS=$(jq -r ".agents[$i].skills | join(\",\")" "$CONFIG")
    PORT=$(jq -r ".agents[$i].a2a.port" "$CONFIG")

    echo "Starting A2A agent '$NAME' on port $PORT..."
    (
        if [ -f "$A2A_VENV" ]; then source "$A2A_VENV"; fi
        cd "$SCRIPT_DIR/external/a2a"
        AGENT_NAME="$NAME" \
        AGENT_SKILLS="$SKILLS" \
        AGENT_PORT="$PORT" \
        python3 -m uvicorn agent_server.main:app --port "$PORT" --log-level warning
    ) &
    PIDS+=($!)
done

echo ""
echo "All servers started:"
echo "  CrewAI:  http://localhost:8000"
for i in $(seq 0 $((AGENT_COUNT - 1))); do
    NAME=$(jq -r ".agents[$i].name" "$CONFIG")
    PORT=$(jq -r ".agents[$i].a2a.port" "$CONFIG")
    echo "  A2A ($NAME): http://localhost:$PORT"
done
echo ""
echo "Press Ctrl+C to stop all servers."

wait
