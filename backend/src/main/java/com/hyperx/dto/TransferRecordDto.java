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
public class TransferRecordDto {
    private UUID id;
    private UUID senderId;
    private String senderFullName;
    private String fileName;
    private Long fileSize;
    private String checksum;
    private String status;
    private Instant createdAt;
    private Instant completedAt;
}
