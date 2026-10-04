package kz.company.shop.deployments;

import java.io.IOException;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/deployments")
public class DeploymentStatusController {
    private final DeploymentStatusService service;
    private final AuthContext auth;

    public DeploymentStatusController(DeploymentStatusService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping("/status")
    @PreAuthorize("hasAuthority('deployments.read')")
    public ResponseEntity<ApiResponse<DeploymentStatusService.DeploymentStatus>> status() {
        auth.require("deployments.read");
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ApiResponse.ok(service.get()));
    }

    @GetMapping("/logs/{attemptId}")
    @PreAuthorize("hasAuthority('deployments.read')")
    public ResponseEntity<ApiResponse<DeploymentStatusService.LogTail>> log(
            @PathVariable String attemptId) throws IOException {
        auth.require("deployments.read");
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ApiResponse.ok(service.getLog(attemptId)));
    }
}
