package kz.company.shop.notifications.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.web-push")
public class WebPushProperties {
    private String publicKey = "";
    private String privateKey = "";
    private String subject = "";

    public String getPublicKey() {
        return publicKey;
    }

    public void setPublicKey(String publicKey) {
        this.publicKey = publicKey;
    }

    public String getPrivateKey() {
        return privateKey;
    }

    public void setPrivateKey(String privateKey) {
        this.privateKey = privateKey;
    }

    public String getSubject() {
        return subject;
    }

    public void setSubject(String subject) {
        this.subject = subject;
    }

    public boolean isConfigured() {
        return !publicKey.isBlank() && !privateKey.isBlank() && !subject.isBlank();
    }
}
