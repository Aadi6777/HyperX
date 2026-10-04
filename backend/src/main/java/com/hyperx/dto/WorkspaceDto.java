package com.hyperx.dto;

import com.hyperx.model.WorkspaceRole;
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
public class WorkspaceDto {
    private UUID id;
    private String name;
    private String slug;
    private UUID ownerId;
    private String ownerName;
    private WorkspaceRole currentUserRole;
    private int memberCount;
    private Instant createdAt;
}
