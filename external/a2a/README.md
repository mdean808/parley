# A2A Agent Servers

A2A-compliant agent servers for the benchmark system. The TypeScript adapter (`protocols/src/a2a/`) calls these servers via the A2A protocol (JSON-RPC over HTTP).

## What is A2A?

[A2A (Agent-to-Agent)](https://a2aproject.github.io/A2A/) is an open protocol by Google for agent-to-agent communication over HTTP. Agents expose an agent card for discovery and accept JSON-RPC requests for message exchange.

## Architecture

Three separate agent servers, one per benchmark persona:

| Agent | Port | Skills | Env Var |
|-------|------|--------|---------|
| Atlas - Research | 8001 | general-knowledge, research | `A2A_ATLAS_URL` |
| Sage - Creative | 8002 | creative-writing, brainstorming | `A2A_SAGE_URL` |
| Bolt - Technical | 8003 | coding, technical | `A2A_BOLT_URL` |

## Prerequisites

- Python 3.11+
- An LLM API key (ANTHROPIC_API_KEY or similar, depending on your agent implementation)

## Setup

```bash
cd external/a2a
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running

Start all 3 agents (in separate terminals or use a process manager):

```bash
AGENT_NAME="Atlas - Research" AGENT_SKILLS="general-knowledge,research" AGENT_PORT=8001 \
  uvicorn agent_server.main:app --port 8001

AGENT_NAME="Sage - Creative" AGENT_SKILLS="creative-writing,brainstorming" AGENT_PORT=8002 \
  uvicorn agent_server.main:app --port 8002

AGENT_NAME="Bolt - Technical" AGENT_SKILLS="coding,technical" AGENT_PORT=8003 \
  uvicorn agent_server.main:app --port 8003
```

The benchmark adapter expects these at `http://localhost:800{1,2,3}` by default. Override with env vars:

```bash
export A2A_ATLAS_URL=http://localhost:8001
export A2A_SAGE_URL=http://localhost:8002
export A2A_BOLT_URL=http://localhost:8003
```

## Implementing Agent Logic

Edit `agent_server/main.py`, specifically the `handle_send_message()` function. Replace the placeholder with actual agent logic using any of:

- **Google ADK** (`google-adk`): Google's Agent Development Kit
- **LangGraph** / **LangChain**: Popular agent frameworks
- **Direct Claude calls**: Use the Anthropic Python SDK directly
- **A2A Python SDK** (`a2a-sdk`): Official A2A server utilities

### Token Usage Metadata

The benchmark adapter reads custom metadata from the task response for accurate metrics. Include this in your response:

```python
"metadata": {
    "usage": {"input_tokens": 1200, "output_tokens": 340},
    "model": "claude-sonnet-4-5-20250929",
    "duration_ms": 2340.0,
}
```

If omitted, the adapter falls back to local timing (no token data).

### Using the A2A Python SDK

For a more robust implementation, use the official A2A Python SDK instead of raw JSON-RPC handling:

```bash
pip install a2a-sdk
```

See the [a2a-python samples](https://github.com/a2aproject/a2a-python/tree/main/samples) for reference implementations.

## A2A Protocol Details

### Agent Card (`GET /.well-known/agent-card.json`)

```json
{
    "name": "Atlas - Research",
    "url": "http://localhost:8001",
    "capabilities": {"streaming": false, "pushNotifications": false},
    "skills": [{"id": "general-knowledge", "name": "general-knowledge"}],
    "defaultInputModes": ["text/plain"],
    "defaultOutputModes": ["text/plain"]
}
```

### Send Message (`POST /` with JSON-RPC)

Request:
```json
{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
        "message": {
            "messageId": "uuid",
            "role": "user",
            "kind": "message",
            "parts": [{"kind": "text", "text": "What caused the French Revolution?"}],
            "contextId": "optional-context-uuid"
        }
    },
    "id": "request-uuid"
}
```

Response (Task):
```json
{
    "jsonrpc": "2.0",
    "result": {
        "kind": "task",
        "id": "task-uuid",
        "contextId": "context-uuid",
        "status": {"state": "completed"},
        "artifacts": [
            {
                "artifactId": "artifact-uuid",
                "parts": [{"kind": "text", "text": "The response..."}]
            }
        ],
        "metadata": {
            "usage": {"input_tokens": 1200, "output_tokens": 340},
            "model": "claude-sonnet-4-5-20250929"
        }
    },
    "id": "request-uuid"
}
```

## Testing with curl

```bash
# Agent card
curl http://localhost:8001/.well-known/agent-card.json

# Send message
curl -X POST http://localhost:8001/ \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
        "message": {
            "messageId": "test-1",
            "role": "user",
            "kind": "message",
            "parts": [{"kind": "text", "text": "Hello"}]
        }
    },
    "id": "req-1"
  }'
```
