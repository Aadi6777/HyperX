package com.hyperx.controller;

import com.hyperx.dto.*;
import com.hyperx.security.UserPrincipal;
import com.hyperx.service.WorkspaceService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/workspaces")
@RequiredArgsConstructor
public class WorkspaceController {

    private final WorkspaceService workspaceService;

    @PostMapping
    public ResponseEntity<WorkspaceDto> createWorkspace(
        @AuthenticationPrincipal UserPrincipal principal,
        @Valid @RequestBody CreateWorkspaceRequest request
    ) {
        WorkspaceDto dto = workspaceService.createWorkspace(principal, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(dto);
    }

    @GetMapping
    public ResponseEntity<List<WorkspaceDto>> listWorkspaces(
        @AuthenticationPrincipal UserPrincipal principal
    ) {
        List<WorkspaceDto> list = workspaceService.getUserWorkspaces(principal);
        return ResponseEntity.ok(list);
    }

    @GetMapping("/{slug}")
    public ResponseEntity<WorkspaceDto> getWorkspace(
        @AuthenticationPrincipal UserPrincipal principal,
        @PathVariable String slug
    ) {
        WorkspaceDto dto = workspaceService.getWorkspaceBySlug(principal, slug);
        return ResponseEntity.ok(dto);
    }

    @GetMapping("/{id}/members")
    public ResponseEntity<List<MemberDto>> getMembers(
        @AuthenticationPrincipal UserPrincipal principal,
        @PathVariable UUID id
    ) {
        List<MemberDto> members = workspaceService.getWorkspaceMembers(principal, id);
        return ResponseEntity.ok(members);
    }

    @PostMapping("/{id}/members")
    public ResponseEntity<MemberDto> addMember(
        @AuthenticationPrincipal UserPrincipal principal,
        @PathVariable UUID id,
        @Valid @RequestBody AddMemberRequest request
    ) {
        MemberDto member = workspaceService.addMember(principal, id, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(member);
    }

    @GetMapping("/{id}/activities")
    public ResponseEntity<List<ActivityLogDto>> getActivities(
        @AuthenticationPrincipal UserPrincipal principal,
        @PathVariable UUID id
    ) {
        List<ActivityLogDto> logs = workspaceService.getActivityLogs(principal, id);
        return ResponseEntity.ok(logs);
    }

    @PostMapping("/{id}/transfers")
    public ResponseEntity<Void> recordTransfer(
        @AuthenticationPrincipal UserPrincipal principal,
        @PathVariable UUID id,
        @Valid @RequestBody RecordTransferRequest request
    ) {
        workspaceService.recordTransfer(principal, id, request);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @GetMapping("/{id}/transfers")
    public ResponseEntity<List<TransferRecordDto>> getTransfers(
        @AuthenticationPrincipal UserPrincipal principal,
        @PathVariable UUID id
    ) {
        List<TransferRecordDto> transfers = workspaceService.getTransferRecords(principal, id);
        return ResponseEntity.ok(transfers);
    }
}
