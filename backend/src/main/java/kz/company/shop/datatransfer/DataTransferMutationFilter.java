package kz.company.shop.datatransfer;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.Set;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.ApiResponse;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

public class DataTransferMutationFilter extends OncePerRequestFilter {
    private final DataTransferBarrier barrier;
    private final ObjectMapper mapper;

    public DataTransferMutationFilter(DataTransferBarrier barrier, ObjectMapper mapper) {
        this.barrier = barrier;
        this.mapper = mapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/")
                || Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        DataTransferBarrier.Lease lease;
        try {
            lease = barrier.mutation();
        } catch (AppExceptions.BadRequest ex) {
            response.setStatus(503);
            response.setHeader("Retry-After", "3");
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            mapper.writeValue(
                    response.getOutputStream(), ApiResponse.error(ex.getMessage(), Map.of()));
            return;
        }
        try (lease) {
            chain.doFilter(request, response);
        }
    }
}
