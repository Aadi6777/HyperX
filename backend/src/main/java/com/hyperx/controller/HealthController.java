package com.hyperx.controller;

import com.hyperx.dto.HealthResponseDto;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.sql.Connection;
import java.time.Instant;

/**
 * Controller exposing health and diagnostic telemetry for HyperX.
 * Endpoint: /api/v1/health
 */
@RestController
@RequestMapping("/api/v1")
public class HealthController {

    private final DataSource dataSource;

    @Autowired(required = false)
    public HealthController(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GetMapping("/health")
    public ResponseEntity<HealthResponseDto> getHealth() {
        String dbStatus = checkDatabaseHealth();

        HealthResponseDto response = HealthResponseDto.builder()
                .status("UP")
                .service("HyperX Backend")
                .version("1.0.0")
                .database(dbStatus)
                .timestamp(Instant.now())
                .build();

        return ResponseEntity.ok(response);
    }

    private String checkDatabaseHealth() {
        if (dataSource == null) {
            return "NOT_CONFIGURED";
        }

        try (Connection connection = dataSource.getConnection()) {
            if (connection.isValid(2)) {
                return "CONNECTED";
            }
            return "DEGRADED";
        } catch (Exception ex) {
            return "DISCONNECTED: " + ex.getMessage();
        }
    }
}
