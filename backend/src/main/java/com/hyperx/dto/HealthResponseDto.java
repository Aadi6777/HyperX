package com.hyperx.dto;

import java.time.Instant;

/**
 * Diagnostic health status response DTO.
 * Provides system availability, service identification, and database connectivity.
 */
public class HealthResponseDto {
    private String status;
    private String service;
    private String version;
    private String database;
    private Instant timestamp;

    public HealthResponseDto() {
    }

    public HealthResponseDto(String status, String service, String version, String database, Instant timestamp) {
        this.status = status;
        this.service = service;
        this.version = version;
        this.database = database;
        this.timestamp = timestamp;
    }

    public static Builder builder() {
        return new Builder();
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getService() {
        return service;
    }

    public void setService(String service) {
        this.service = service;
    }

    public String getVersion() {
        return version;
    }

    public void setVersion(String version) {
        this.version = version;
    }

    public String getDatabase() {
        return database;
    }

    public void setDatabase(String database) {
        this.database = database;
    }

    public Instant getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(Instant timestamp) {
        this.timestamp = timestamp;
    }

    public static class Builder {
        private String status;
        private String service;
        private String version;
        private String database;
        private Instant timestamp;

        public Builder status(String status) {
            this.status = status;
            return this;
        }

        public Builder service(String service) {
            this.service = service;
            return this;
        }

        public Builder version(String version) {
            this.version = version;
            return this;
        }

        public Builder database(String database) {
            this.database = database;
            return this;
        }

        public Builder timestamp(Instant timestamp) {
            this.timestamp = timestamp;
            return this;
        }

        public HealthResponseDto build() {
            return new HealthResponseDto(status, service, version, database, timestamp);
        }
    }
}
