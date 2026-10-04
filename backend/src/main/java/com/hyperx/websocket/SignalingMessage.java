package com.hyperx.websocket;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class SignalingMessage {
    private String type;
    private String workspaceId;
    private String peerId;
    private String peerName;
    private String targetPeerId;
    private String senderPeerId;
    private String senderName;
    private Object payload;
    private Object sdp;
    private Object candidate;
    private String text;
    private Long timestamp;

    // File transfer metadata
    private String fileId;
    private String fileName;
    private Long fileSize;
    private Integer chunkCount;
    private String checksum;
}
