# GPT provider

The backend exposes an internal `GptProvider` Spring bean for future features. It sends text requests to the OpenAI Responses API. There is no public GPT endpoint or frontend API key.

Configure the backend environment:

```dotenv
APP_GPT_ENABLED=true
OPENAI_API_KEY=your-server-side-key
APP_GPT_MODEL=gpt-6-luna
```

The production Compose configurations disable the provider by default. The provider fails if enabled without a key. `APP_GPT_BASE_URL` (default `https://api.openai.com/v1`), `APP_GPT_CONNECT_TIMEOUT` (default `5s`) and `APP_GPT_READ_TIMEOUT` (default `60s`) are optional. Keep the key in the deployment environment or secret store; never put it in a frontend variable or commit it.

For this project's production server, edit `/opt/company-shop-repo/.env.production` as the deployment user and add the three variables above with the real key. Both the legacy production Compose file and the blue/green app Compose file pass them to the backend. Compose reads the environment when a container is created: a plain restart does not apply a changed key. Deploy a new revision (the blue/green rollout creates a fresh backend) or recreate the active backend container using its current image and slot settings. Never print `docker compose config` or `docker inspect` environment output while troubleshooting, because they contain the key.

Inject `GptProvider` into a backend service and call:

```java
GptResult result = gptProvider.generate(
        new GptRequest("product_summary", "Answer briefly in Russian.", userInput, 1024));
String answer = result.text();
```

`feature` is a stable name for the calling function (up to 100 characters), used for future analytics. `GptResult` also contains the response ID and input/output token counts. The provider sends `store: false`, collects text from all message output items, and raises `GptProviderException` for unavailable, failed, incomplete, or empty responses. Feature services should decide their own prompts, limits, access checks, and handling of provider errors.

Every attempted API call creates a row in `gpt_api_usage`. Rows contain the response ID (when available), feature, actual model, response status, HTTP status (when known), input/output/total tokens, cached input and cache-write tokens, reasoning output tokens, duration, and creation time. Missing API usage remains `NULL`, not zero. Cached tokens are already included in input tokens, and reasoning tokens in output tokens; do not add them again to totals. No prompts, generated text, or API keys are stored. Usage is written in a separate transaction so later feature rollbacks do not erase the accounting record.
