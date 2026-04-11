# CrewAI Benchmark Wrapper

FastAPI wrapper that runs CrewAI agents for the benchmark system. The TypeScript adapter (`protocols/src/crewai/`) calls this service via HTTP.

## Prerequisites

- Python 3.11+
- An LLM API key (ANTHROPIC_API_KEY or OPENAI_API_KEY depending on your CrewAI LLM config)

## Setup

```bash
cd external/crewai
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running

```bash
uvicorn app.main:app --port 8000
```

The benchmark adapter expects this at `http://localhost:8000` by default. Override with the `CREWAI_URL` env var.

## Implementing the Crew

Edit `app/crew.py` to implement the two functions:

### `run_single_agent(agent_name, system_prompt, message)`

Runs a single CrewAI Agent + Task + Crew. Called once per persona in "single" mode.
The three personas are:

| Name | Skills |
|------|--------|
| Atlas - Research | general-knowledge, research |
| Sage - Creative | creative-writing, brainstorming |
| Bolt - Technical | coding, technical |

Must return a dict:

```python
{
    "response_text": "The agent's response...",
    "usage": {"input_tokens": 1200, "output_tokens": 340},  # or None
    "model": "claude-sonnet-4-5-20250929",  # or None
    "duration_ms": 2340.0,  # or None (wrapper will measure)
}
```

### `run_full_crew(message)`

Runs all 3 agents as a single collaborative crew. Called once in "crew" mode.
Must return a list of dicts (same shape as above, plus `agent_name`):

```python
[
    {"agent_name": "Atlas - Research", "response_text": "...", ...},
    {"agent_name": "Sage - Creative", "response_text": "...", ...},
    {"agent_name": "Bolt - Technical", "response_text": "...", ...},
]
```

## Modes

The TypeScript adapter supports two modes, controlled by `CREWAI_MODE` env var:

- **`single`** (default): Calls `POST /run-single` three times in parallel (one per agent). Best for per-agent metrics comparability.
- **`crew`**: Calls `POST /run-crew` once. Lets CrewAI agents collaborate within a single crew. More idiomatic CrewAI.

## JSON Contract

### `GET /health`

```json
{"status": "ok", "agents": ["Atlas - Research", "Sage - Creative", "Bolt - Technical"]}
```

### `POST /run-single`

Request:
```json
{
    "agent_name": "Atlas - Research",
    "message": "What caused the French Revolution?",
    "system_prompt": "You are Atlas, a research assistant...",
    "chain_id": "optional-uuid"
}
```

Response:
```json
{
    "agent_name": "Atlas - Research",
    "response_text": "The French Revolution was caused by...",
    "usage": {"input_tokens": 1200, "output_tokens": 340},
    "model": "claude-sonnet-4-5-20250929",
    "duration_ms": 2340.0,
    "error": null
}
```

### `POST /run-crew`

Request:
```json
{"message": "What caused the French Revolution?", "chain_id": "optional-uuid"}
```

Response:
```json
{
    "results": [
        {"agent_name": "Atlas - Research", "response_text": "...", ...},
        {"agent_name": "Sage - Creative", "response_text": "...", ...},
        {"agent_name": "Bolt - Technical", "response_text": "...", ...}
    ],
    "total_duration_ms": 5200.0,
    "error": null
}
```

## Testing with curl

```bash
# Health check
curl http://localhost:8000/health

# Single agent
curl -X POST http://localhost:8000/run-single \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "Atlas - Research", "message": "Hello", "system_prompt": "You are Atlas."}'

# Full crew
curl -X POST http://localhost:8000/run-crew \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```
