FROM python:3.12-slim

ENV MODEL_NAME=intfloat/multilingual-e5-base
ENV MODEL_DIR=/models/multilingual-e5-base
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${MODEL_NAME}').save('${MODEL_DIR}')"

COPY app.py .

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
