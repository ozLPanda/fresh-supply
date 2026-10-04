package kz.company.shop.search;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.embeddings")
public class EmbeddingProperties {
    private boolean enabled;
    private String url = "http://localhost:8000";
    private String model = "intfloat/multilingual-e5-base";
    private int dimensions = 768;
    private int backfillBatchSize = 50;
    private double searchMaxDistance = 0.205;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public int getDimensions() {
        return dimensions;
    }

    public void setDimensions(int dimensions) {
        this.dimensions = dimensions;
    }

    public int getBackfillBatchSize() {
        return backfillBatchSize;
    }

    public void setBackfillBatchSize(int backfillBatchSize) {
        this.backfillBatchSize = backfillBatchSize;
    }

    public double getSearchMaxDistance() {
        return searchMaxDistance;
    }

    public void setSearchMaxDistance(double searchMaxDistance) {
        this.searchMaxDistance = searchMaxDistance;
    }
}
