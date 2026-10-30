package com.hyperx.service;

import com.hyperx.dto.*;
import com.hyperx.model.*;
import com.hyperx.repository.*;
import com.hyperx.security.UserPrincipal;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class WorkspaceService {

    private final WorkspaceRepository workspaceRepository;
    private final MemberRepository memberRepository;
    private final UserRepository userRepository;
    private final ActivityLogRepository activityLogRepository;
    private final TransferRecordRepository transferRecordRepository;

    @Transactional
    public WorkspaceDto createWorkspace(UserPrincipal principal, CreateWorkspaceRequest request) {
        User user = userRepository.findById(principal.getId())
            .orElseThrow(() -> new IllegalStateException("User not found"));

        String slug = request.getSlug();
        if (slug == null || slug.isBlank()) {
            slug = request.getName().toLowerCase().replaceAll("[^a-z0-9]", "-");
        }
        slug = slug.toLowerCase().trim();

        if (workspaceRepository.existsBySlug(slug)) {
            slug = slug + "-" + UUID.randomUUID().toString().substring(0, 6);
        }

        Workspace workspace = Workspace.builder()
            .name(request.getName().trim())
            .slug(slug)
            .owner(user)
            .build();
        Workspace saved = workspaceRepository.save(workspace);

        Member member = Member.builder()
            .workspace(saved)
            .user(user)
            .role(WorkspaceRole.OWNER)
            .build();
        memberRepository.save(member);

        logActivity(saved, user, "WORKSPACE_CREATED", "Workspace created: " + saved.getName());

        return toDto(saved, WorkspaceRole.OWNER, 1);
    }

    @Transactional(readOnly = true)
    public List<WorkspaceDto> getUserWorkspaces(UserPrincipal principal) {
        List<Member> memberships = memberRepository.findByUserId(principal.getId());
        return memberships.stream().map(m -> {
            Workspace ws = m.getWorkspace();
            int count = memberRepository.findByWorkspaceId(ws.getId()).size();
            return toDto(ws, m.getRole(), count);
        }).collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public WorkspaceDto getWorkspaceBySlug(UserPrincipal principal, String slug) {
        Workspace ws = workspaceRepository.findBySlug(slug)
            .orElseThrow(() -> new NoSuchElementException("Workspace not found with slug: " + slug));

        Member member = memberRepository.findByWorkspaceIdAndUserId(ws.getId(), principal.getId())
            .orElseThrow(() -> new AccessDeniedException("You are not a member of this workspace"));

        int count = memberRepository.findByWorkspaceId(ws.getId()).size();
        return toDto(ws, member.getRole(), count);
    }

    @Transactional(readOnly = true)
    public List<MemberDto> getWorkspaceMembers(UserPrincipal principal, UUID workspaceId) {
        ensureMembership(principal, workspaceId);
        List<Member> members = memberRepository.findByWorkspaceId(workspaceId);
        return members.stream().map(this::toMemberDto).collect(Collectors.toList());
    }

    @Transactional
    public MemberDto addMember(UserPrincipal principal, UUID workspaceId, AddMemberRequest request) {
        Member caller = ensureRole(principal, workspaceId, EnumSet.of(WorkspaceRole.OWNER, WorkspaceRole.ADMIN));

        User targetUser = userRepository.findByEmail(request.getEmail().toLowerCase().trim())
            .orElseThrow(() -> new NoSuchElementException("No registered user found with email: " + request.getEmail()));

        if (memberRepository.existsByWorkspaceIdAndUserId(workspaceId, targetUser.getId())) {
            throw new IllegalArgumentException("User is already a member of this workspace");
        }

        Member member = Member.builder()
            .workspace(caller.getWorkspace())
            .user(targetUser)
            .role(request.getRole() != null ? request.getRole() : WorkspaceRole.MEMBER)
            .build();
        Member saved = memberRepository.save(member);

        logActivity(caller.getWorkspace(), caller.getUser(), "MEMBER_ADDED",
            "Added " + targetUser.getEmail() + " as " + saved.getRole());

        return toMemberDto(saved);
    }

    @Transactional
    public void recordTransfer(UserPrincipal principal, UUID workspaceId, RecordTransferRequest request) {
        Member member = ensureMembership(principal, workspaceId);

        TransferRecord record = TransferRecord.builder()
            .workspace(member.getWorkspace())
            .sender(member.getUser())
            .fileName(request.getFileName())
            .fileSize(request.getFileSize())
            .checksum(request.getChecksum())
            .status(request.getStatus())
            .completedAt(Instant.now())
            .build();

        transferRecordRepository.save(record);

        logActivity(member.getWorkspace(), member.getUser(), "FILE_STREAMED",
            String.format("Streamed file %s (%d bytes)", request.getFileName(), request.getFileSize()));
    }

    @Transactional(readOnly = true)
    public List<TransferRecordDto> getTransferRecords(UserPrincipal principal, UUID workspaceId) {
        ensureMembership(principal, workspaceId);
        return transferRecordRepository.findTop50ByWorkspaceIdOrderByCreatedAtDesc(workspaceId).stream()
            .map(this::toTransferDto)
            .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<ActivityLogDto> getActivityLogs(UserPrincipal principal, UUID workspaceId) {
        ensureMembership(principal, workspaceId);
        return activityLogRepository.findTop50ByWorkspaceIdOrderByCreatedAtDesc(workspaceId).stream()
            .map(this::toActivityLogDto)
            .collect(Collectors.toList());
    }

    private Member ensureMembership(UserPrincipal principal, UUID workspaceId) {
        return memberRepository.findByWorkspaceIdAndUserId(workspaceId, principal.getId())
            .orElseThrow(() -> new AccessDeniedException("Access denied: Not a member of this workspace"));
    }

    private Member ensureRole(UserPrincipal principal, UUID workspaceId, Set<WorkspaceRole> allowedRoles) {
        Member member = ensureMembership(principal, workspaceId);
        if (!allowedRoles.contains(member.getRole())) {
            throw new AccessDeniedException("Action requires one of the roles: " + allowedRoles);
        }
        return member;
    }

    private void logActivity(Workspace workspace, User user, String action, String details) {
        ActivityLog logItem = ActivityLog.builder()
            .workspace(workspace)
            .user(user)
            .action(action)
            .details(details)
            .build();
        activityLogRepository.save(logItem);
    }

    private WorkspaceDto toDto(Workspace ws, WorkspaceRole role, int count) {
        return WorkspaceDto.builder()
            .id(ws.getId())
            .name(ws.getName())
            .slug(ws.getSlug())
            .ownerId(ws.getOwner().getId())
            .ownerName(ws.getOwner().getFullName())
            .currentUserRole(role)
            .memberCount(count)
            .createdAt(ws.getCreatedAt())
            .build();
    }

    private MemberDto toMemberDto(Member member) {
        return MemberDto.builder()
            .id(member.getId())
            .userId(member.getUser().getId())
            .email(member.getUser().getEmail())
            .fullName(member.getUser().getFullName())
            .role(member.getRole())
            .joinedAt(member.getJoinedAt())
            .build();
    }

    private ActivityLogDto toActivityLogDto(ActivityLog logItem) {
        return ActivityLogDto.builder()
            .id(logItem.getId())
            .userFullName(logItem.getUser() != null ? logItem.getUser().getFullName() : "System")
            .userEmail(logItem.getUser() != null ? logItem.getUser().getEmail() : "system@hyperx.local")
            .action(logItem.getAction())
            .details(logItem.getDetails())
            .createdAt(logItem.getCreatedAt())
            .build();
    }

    private TransferRecordDto toTransferDto(TransferRecord tr) {
        return TransferRecordDto.builder()
            .id(tr.getId())
            .senderId(tr.getSender() != null ? tr.getSender().getId() : null)
            .senderFullName(tr.getSender() != null ? tr.getSender().getFullName() : "Anonymous Peer")
            .fileName(tr.getFileName())
            .fileSize(tr.getFileSize())
            .checksum(tr.getChecksum())
            .status(tr.getStatus())
            .createdAt(tr.getCreatedAt())
            .completedAt(tr.getCompletedAt())
            .build();
    }
}
