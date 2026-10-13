package kz.company.shop.datatransfer;

import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Reuses the per-backend-launch native control secret; never exposed to the frontend. */
@RestController
@Profile("desktop")
public class DataTransferReconciliationController {
    private final byte[] token;
    private final DataTransferReconciliationService service;
    private final DataTransferBarrier barrier;
    public DataTransferReconciliationController(@Value("${app.desktop.control-token}") String token,
            DataTransferReconciliationService service,DataTransferBarrier barrier) {
        if(token==null||token.length()<32)throw new IllegalStateException("Invalid desktop control token");
        this.token=token.getBytes(StandardCharsets.UTF_8);this.service=service;this.barrier=barrier;
    }
    @PostMapping("/__desktop/data-merge/preflight")
    public ResponseEntity<DataTransferReconciliationService.PreflightResult> preflight(HttpServletRequest request,
            @RequestHeader(value="X-Ovoshi-Control",required=false) String provided,
            @RequestBody DataTransferReconciliationService.PreflightRequest body) {
        if(!allowed(request,provided))return ResponseEntity.status(403).build();
        try(var ignored=barrier.snapshot()){return ResponseEntity.ok(service.preflight(body));}
    }
    @PostMapping("/__desktop/data-merge/apply")
    public ResponseEntity<DataTransferReconciliationService.ApplyResult> apply(HttpServletRequest request,
            @RequestHeader(value="X-Ovoshi-Control",required=false) String provided,
            @RequestBody DataTransferReconciliationService.ApplyRequest body) {
        if(!allowed(request,provided))return ResponseEntity.status(403).build();
        try(var ignored=barrier.snapshot()){return ResponseEntity.ok(service.apply(body));}
    }
    private boolean allowed(HttpServletRequest request,String provided) {
        if(provided==null||!MessageDigest.isEqual(token,provided.getBytes(StandardCharsets.UTF_8)))return false;
        if(request.getRemoteAddr()==null||request.getRemoteAddr().isBlank())return false;
        try{return InetAddress.getByName(request.getRemoteAddr()).isLoopbackAddress();}
        catch(Exception ignored){return false;}
    }
}
