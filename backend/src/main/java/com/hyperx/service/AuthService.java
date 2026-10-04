package com.hyperx.service;

import com.hyperx.dto.*;
import com.hyperx.model.Member;
import com.hyperx.model.User;
import com.hyperx.model.UserRole;
import com.hyperx.model.Workspace;
import com.hyperx.model.WorkspaceRole;
import com.hyperx.repository.MemberRepository;
import com.hyperx.repository.UserRepository;
import com.hyperx.repository.WorkspaceRepository;
import com.hyperx.security.JwtTokenProvider;
import com.hyperx.security.UserPrincipal;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final WorkspaceRepository workspaceRepository;
    private final MemberRepository memberRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final JwtTokenProvider tokenProvider;

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new IllegalArgumentException("Email is already registered: " + request.getEmail());
        }

        User user = User.builder()
            .email(request.getEmail().toLowerCase().trim())
            .fullName(request.getFullName().trim())
            .passwordHash(passwordEncoder.encode(request.getPassword()))
            .role(UserRole.MEMBER)
            .build();

        User savedUser = userRepository.save(user);

        // Auto-provision initial personal workspace for immediate P2P sharing
        String baseSlug = savedUser.getEmail().split("@")[0].replaceAll("[^a-z0-9]", "-").toLowerCase();
        String slug = baseSlug + "-workspace";
        int suffix = 1;
        while (workspaceRepository.existsBySlug(slug)) {
            slug = baseSlug + "-" + suffix++;
        }

        Workspace defaultWorkspace = Workspace.builder()
            .name(savedUser.getFullName() + "'s Workspace")
            .slug(slug)
            .owner(savedUser)
            .build();
        workspaceRepository.save(defaultWorkspace);

        Member member = Member.builder()
            .workspace(defaultWorkspace)
            .user(savedUser)
            .role(WorkspaceRole.OWNER)
            .build();
        memberRepository.save(member);

        String token = tokenProvider.generateTokenFromUserId(savedUser.getId(), savedUser.getEmail());

        log.info("User registered successfully: {} (ID: {})", savedUser.getEmail(), savedUser.getId());

        return AuthResponse.builder()
            .token(token)
            .tokenType("Bearer")
            .user(mapToUserDto(savedUser))
            .build();
    }

    public AuthResponse login(LoginRequest request) {
        Authentication authentication = authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(
                request.getEmail().toLowerCase().trim(),
                request.getPassword()
            )
        );

        SecurityContextHolder.getContext().setAuthentication(authentication);
        UserPrincipal principal = (UserPrincipal) authentication.getPrincipal();
        String token = tokenProvider.generateToken(authentication);

        User user = userRepository.findById(principal.getId())
            .orElseThrow(() -> new IllegalStateException("User not found"));

        log.info("User logged in successfully: {}", user.getEmail());

        return AuthResponse.builder()
            .token(token)
            .tokenType("Bearer")
            .user(mapToUserDto(user))
            .build();
    }

    @Transactional(readOnly = true)
    public UserDto getCurrentUser(UserPrincipal principal) {
        User user = userRepository.findById(principal.getId())
            .orElseThrow(() -> new IllegalStateException("User not found"));
        return mapToUserDto(user);
    }

    public UserDto mapToUserDto(User user) {
        return UserDto.builder()
            .id(user.getId())
            .email(user.getEmail())
            .fullName(user.getFullName())
            .role(user.getRole())
            .createdAt(user.getCreatedAt())
            .build();
    }
}
