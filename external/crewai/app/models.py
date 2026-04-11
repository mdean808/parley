from pydantic import BaseModel


class UsageInfo(BaseModel):
    input_tokens: int
    output_tokens: int


class SingleRunRequest(BaseModel):
    agent_name: str
    message: str
    system_prompt: str
    chain_id: str | None = None


class SingleRunResponse(BaseModel):
    agent_name: str
    response_text: str
    usage: UsageInfo | None = None
    model: str | None = None
    duration_ms: float | None = None
    error: str | None = None


class CrewRunRequest(BaseModel):
    message: str
    chain_id: str | None = None


class CrewRunResponse(BaseModel):
    results: list[SingleRunResponse]
    total_duration_ms: float
    error: str | None = None


class HealthResponse(BaseModel):
    status: str
    agents: list[str]
