package kz.company.shop.warehouse.ai;

import java.util.List;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/admin/warehouse/inventory/ai")
public class InventoryAiController {
    private final InventoryAiService service;
    private final AuthContext auth;

    public InventoryAiController(InventoryAiService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @PostMapping(value = "/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<InventoryAiDto.Result> analyze(
            @RequestPart("files") List<MultipartFile> files) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.analyze(files));
    }

    @PostMapping(value = "/clarify", consumes = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("hasAuthority('warehouse.manage')")
    public ApiResponse<InventoryAiDto.Result> clarify(
            @RequestBody InventoryAiDto.ClarifyRequest request) {
        auth.require("warehouse.manage");
        return ApiResponse.ok(service.clarify(request));
    }
}
