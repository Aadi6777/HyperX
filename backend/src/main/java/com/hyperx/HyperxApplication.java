package com.hyperx;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * HyperX - Enterprise Peer-to-Peer Collaboration & Large File Streaming Platform
 *
 * Spring Boot 3.3 Bootstrap Class providing:
 * - WebSocket signaling for WebRTC peer discovery
 * - Identity and Workspace management
 * - Audit logging and system health diagnostics
 */
@SpringBootApplication
public class HyperxApplication {

    public static void main(String[] args) {
        SpringApplication.run(HyperxApplication.class, args);
    }
}
