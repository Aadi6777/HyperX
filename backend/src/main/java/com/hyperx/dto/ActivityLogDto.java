package com.hyperx.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ActivityLogDto {
    private UUID id;
    private String userFullName;
    private String userEmail;
    private String action;
    private String details;
    private Instant createdAt;
}
