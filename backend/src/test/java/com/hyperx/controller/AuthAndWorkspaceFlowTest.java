package com.hyperx.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hyperx.dto.CreateWorkspaceRequest;
import com.hyperx.dto.LoginRequest;
import com.hyperx.dto.RegisterRequest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
public class AuthAndWorkspaceFlowTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    public void testCompleteAuthAndWorkspaceLifecycle() throws Exception {
        String email = "alice@hyperx.io";
        String password = "StrongPassword2026!";
        String fullName = "Alice Engineer";

        // 1. Register User
        RegisterRequest registerReq = new RegisterRequest(email, password, fullName);

        MvcResult regResult = mockMvc.perform(post("/api/v1/auth/register")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(registerReq)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.token").isString())
            .andExpect(jsonPath("$.user.email").value(email))
            .andReturn();

        // 2. Login User
        LoginRequest loginReq = new LoginRequest(email, password);

        MvcResult loginResult = mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(loginReq)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.token").isString())
            .andReturn();

        String responseBody = loginResult.getResponse().getContentAsString();
        String token = objectMapper.readTree(responseBody).get("token").asText();

        // 3. Check /me with Bearer token
        mockMvc.perform(get("/api/v1/auth/me")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value(email))
            .andExpect(jsonPath("$.fullName").value(fullName));

        // 4. Create Custom Workspace
        CreateWorkspaceRequest wsReq = new CreateWorkspaceRequest("HyperX Core Cluster", "hyperx-core-cluster");

        mockMvc.perform(post("/api/v1/workspaces")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(wsReq)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.slug").value("hyperx-core-cluster"))
            .andExpect(jsonPath("$.name").value("HyperX Core Cluster"));

        // 5. List Workspaces (Should contain default personal workspace + created workspace)
        mockMvc.perform(get("/api/v1/workspaces")
                .header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray());
    }
}
