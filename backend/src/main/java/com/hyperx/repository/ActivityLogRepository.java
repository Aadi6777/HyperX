package com.hyperx.repository;

import com.hyperx.model.ActivityLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ActivityLogRepository extends JpaRepository<ActivityLog, UUID> {
    List<ActivityLog> findTop50ByWorkspaceIdOrderByCreatedAtDesc(UUID workspaceId);
}
