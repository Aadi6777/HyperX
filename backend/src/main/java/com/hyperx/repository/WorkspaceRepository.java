package com.hyperx.repository;

import com.hyperx.model.Workspace;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface WorkspaceRepository extends JpaRepository<Workspace, UUID> {
    Optional<Workspace> findBySlug(String slug);
    boolean existsBySlug(String slug);
    List<Workspace> findByOwnerId(UUID ownerId);
}
