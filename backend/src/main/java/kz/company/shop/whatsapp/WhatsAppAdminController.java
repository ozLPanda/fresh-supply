package kz.company.shop.whatsapp;

import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/whatsapp")
public class WhatsAppAdminController {
    private final WhatsAppInboxService inbox;
    private final AuthContext auth;

    public WhatsAppAdminController(WhatsAppInboxService inbox, AuthContext auth) {
        this.inbox = inbox;
        this.auth = auth;
    }

    @GetMapping("/status")
    public ApiResponse<WhatsAppStatusDto> status() {
        auth.require("whatsapp.read");
        return ApiResponse.ok(inbox.status());
    }

    @GetMapping("/contacts")
    public ApiResponse<WhatsAppPageDto<WhatsAppContactDto>> contacts(
            @RequestParam(required = false) String query,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "30") int size) {
        auth.require("whatsapp.read");
        return ApiResponse.ok(inbox.contacts(query, page, size));
    }

    @GetMapping("/contacts/{id}/messages")
    public ApiResponse<WhatsAppPageDto<WhatsAppMessageDto>> messages(
            @PathVariable long id,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        auth.require("whatsapp.read");
        return ApiResponse.ok(inbox.messages(id, page, size));
    }
}
