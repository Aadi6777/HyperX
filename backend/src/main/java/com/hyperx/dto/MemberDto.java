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
public class MemberDto {
    private UUID id;
    private UUID userId;
    private String email;
    private String fullName;
    private WorkspaceRole role;
    private Instant joinedAt;
}
