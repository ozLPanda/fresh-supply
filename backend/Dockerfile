FROM maven:3.9.9-eclipse-temurin-21
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-liberation python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY price-importer/requirements.txt /tmp/price-importer-requirements.txt
RUN python3 -m venv /opt/price-importer-venv \
    && /opt/price-importer-venv/bin/pip install --no-cache-dir -r /tmp/price-importer-requirements.txt
ENV PATH="/opt/price-importer-venv/bin:${PATH}"
WORKDIR /app
EXPOSE 8080
CMD ["mvn", "spring-boot:run"]
