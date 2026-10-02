-- HyperX Phase 1 Development Seed Data
-- Passwords hashed using standard BCrypt ($2a$10$wT8f...) for 'Password123!'

INSERT INTO users (id, email, password_hash, full_name, role)
VALUES 
    ('a0000000-0000-0000-0000-000000000001', 'admin@hyperx.io', '$2a$10$EblZqNptyYvcLm/VwDCVAuBjzZOI7khzdyGPBr08PpIi0na624b8.', 'HyperX Root Admin', 'ADMIN'),
    ('a0000000-0000-0000-0000-000000000002', 'peer.alice@hyperx.io', '$2a$10$EblZqNptyYvcLm/VwDCVAuBjzZOI7khzdyGPBr08PpIi0na624b8.', 'Alice Engineer', 'MEMBER')
ON CONFLICT (email) DO NOTHING;

INSERT INTO workspaces (id, name, slug, owner_id)
VALUES 
    ('b0000000-0000-0000-0000-000000000001', 'Primary Stream Lab', 'primary-stream-lab', 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO members (workspace_id, user_id, role)
VALUES 
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'OWNER'),
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'MEMBER')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
