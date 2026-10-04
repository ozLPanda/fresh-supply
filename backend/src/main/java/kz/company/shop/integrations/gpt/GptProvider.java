package kz.company.shop.integrations.gpt;

/** Internal entry point for features that need GPT text generation. */
public interface GptProvider {
    GptResult generate(GptRequest request);

    default GptResult generateImages(GptImageRequest request) {
        throw new UnsupportedOperationException("Image input is not supported");
    }
}
