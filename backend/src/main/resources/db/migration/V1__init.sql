-- HyperX Phase 1 Database Migration
-- V1__init.sql: Core Identity & Workspace Schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- Table: users
-- Core entity representing registered peer identities in HyperX.
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'MEMBER',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- =============================================================================
-- Table: workspaces
-- Collaboration boundaries where peers share streams, files, and channels.
-- =============================================================================
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug);

-- =============================================================================
-- Table: members
-- Association table mapping users to workspaces with granular roles.
-- =============================================================================
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'MEMBER',
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_workspace_user UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_members_workspace ON members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
