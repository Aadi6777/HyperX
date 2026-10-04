package com.hyperx.repository;

import com.hyperx.model.TransferRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface TransferRecordRepository extends JpaRepository<TransferRecord, UUID> {
    List<TransferRecord> findTop50ByWorkspaceIdOrderByCreatedAtDesc(UUID workspaceId);
}
