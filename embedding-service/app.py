import os
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer


MODEL_NAME = os.getenv("MODEL_NAME", "intfloat/multilingual-e5-base")
MODEL_DIR = os.getenv("MODEL_DIR", "/models/multilingual-e5-base")

app = FastAPI(title="Company Shop Embedding Service")
model = SentenceTransformer(MODEL_DIR)
dimensions = model.get_sentence_embedding_dimension()


class EmbedRequest(BaseModel):
    inputType: Literal["query", "passage"]
    texts: list[str] = Field(min_length=1, max_length=128)


class EmbedResponse(BaseModel):
    model: str
    dimensions: int
    embeddings: list[list[float]]


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "dimensions": dimensions}


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest):
    prefix = "query: " if request.inputType == "query" else "passage: "
    texts = [text.strip() for text in request.texts]
    if any(not text for text in texts):
        raise HTTPException(status_code=400, detail="texts must not contain blank values")

    prepared = [prefix + text for text in texts]
    vectors = model.encode(prepared, normalize_embeddings=True)
    return {
        "model": MODEL_NAME,
        "dimensions": dimensions,
        "embeddings": vectors.tolist(),
    }
