import pytest

@pytest.mark.asyncio
async def test_complete_auth_and_workspace_lifecycle(client):
    email = "alice@hyperx.io"
    password = "StrongPassword2026!"
    full_name = "Alice Engineer"

    # 1. Register User
    register_payload = {
        "email": email,
        "password": password,
        "fullName": full_name
    }
    reg_res = await client.post("/api/v1/auth/register", json=register_payload)
    assert reg_res.status_code == 201, reg_res.text
    reg_data = reg_res.json()
    assert "token" in reg_data
    assert reg_data["user"]["email"] == email
    assert reg_data["user"]["fullName"] == full_name
    token = reg_data["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1b. Duplicate Registration check
    dup_res = await client.post("/api/v1/auth/register", json=register_payload)
    assert dup_res.status_code == 400

    # 2. Login User
    login_payload = {
        "email": email,
        "password": password
    }
    login_res = await client.post("/api/v1/auth/login", json=login_payload)
    assert login_res.status_code == 200
    login_data = login_res.json()
    assert "token" in login_data
    assert login_data["user"]["email"] == email

    # 2b. Invalid Password Login check
    bad_login_res = await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong"})
    assert bad_login_res.status_code == 401

    # 3. Check /me with Bearer token
    me_res = await client.get("/api/v1/auth/me", headers=headers)
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["email"] == email
    assert me_data["fullName"] == full_name

    # 4. Create Custom Workspace
    create_ws_payload = {
        "name": "HyperX Core Cluster",
        "slug": "hyperx-core-cluster"
    }
    create_ws_res = await client.post("/api/v1/workspaces", json=create_ws_payload, headers=headers)
    assert create_ws_res.status_code == 201
    ws_data = create_ws_res.json()
    assert ws_data["name"] == "HyperX Core Cluster"
    assert ws_data["slug"] == "hyperx-core-cluster"
    workspace_id = ws_data["id"]

    # 5. List Workspaces
    list_ws_res = await client.get("/api/v1/workspaces", headers=headers)
    assert list_ws_res.status_code == 200
    workspaces = list_ws_res.json()
    assert len(workspaces) >= 2  # default personal workspace + created one
    slugs = [w["slug"] for w in workspaces]
    assert "hyperx-core-cluster" in slugs

    # 6. Get Workspace by slug
    get_ws_res = await client.get("/api/v1/workspaces/hyperx-core-cluster", headers=headers)
    assert get_ws_res.status_code == 200
    assert get_ws_res.json()["id"] == workspace_id

    # 7. Register a second user to add as member
    bob_reg = await client.post("/api/v1/auth/register", json={
        "email": "bob@hyperx.io",
        "password": "StrongPassword2026!",
        "fullName": "Bob Peer"
    })
    assert bob_reg.status_code == 201

    # 8. Add Bob as member
    add_mem_res = await client.post(
        f"/api/v1/workspaces/{workspace_id}/members",
        json={"email": "bob@hyperx.io", "role": "MEMBER"},
        headers=headers
    )
    assert add_mem_res.status_code == 201
    mem_data = add_mem_res.json()
    assert mem_data["email"] == "bob@hyperx.io"
    assert mem_data["role"] == "MEMBER"

    # 9. List Workspace Members
    members_res = await client.get(f"/api/v1/workspaces/{workspace_id}/members", headers=headers)
    assert members_res.status_code == 200
    members = members_res.json()
    assert len(members) == 2

    # 10. Record Transfer
    transfer_payload = {
        "fileName": "large_dataset.bin",
        "fileSize": 104857600,
        "checksum": "sha256_mock_test_hash",
        "status": "COMPLETED"
    }
    tx_res = await client.post(
        f"/api/v1/workspaces/{workspace_id}/transfers",
        json=transfer_payload,
        headers=headers
    )
    assert tx_res.status_code == 201

    # 11. Get Transfers
    get_tx_res = await client.get(f"/api/v1/workspaces/{workspace_id}/transfers", headers=headers)
    assert get_tx_res.status_code == 200
    tx_list = get_tx_res.json()
    assert len(tx_list) >= 1
    assert tx_list[0]["fileName"] == "large_dataset.bin"
    assert tx_list[0]["fileSize"] == 104857600

    # 12. Get Activities
    act_res = await client.get(f"/api/v1/workspaces/{workspace_id}/activities", headers=headers)
    assert act_res.status_code == 200
    act_list = act_res.json()
    assert len(act_list) >= 1

    # 13. Get Workspace by UUID (test both slug and UUID support)
    get_by_uuid_res = await client.get(f"/api/v1/workspaces/{workspace_id}", headers=headers)
    assert get_by_uuid_res.status_code == 200
    assert get_by_uuid_res.json()["slug"] == "hyperx-core-cluster"

    # 14. Non-existent Workspace returns 404
    not_found_res = await client.get("/api/v1/workspaces/non-existent-workspace-xyz", headers=headers)
    assert not_found_res.status_code == 404

    # 15. Bob (role MEMBER) cannot add members -> 403 FORBIDDEN
    bob_login = await client.post("/api/v1/auth/login", json={"email": "bob@hyperx.io", "password": "StrongPassword2026!"})
    bob_token = bob_login.json()["token"]
    bob_headers = {"Authorization": f"Bearer {bob_token}"}
    bob_add_res = await client.post(
        f"/api/v1/workspaces/{workspace_id}/members",
        json={"email": "alice@hyperx.io", "role": "MEMBER"},
        headers=bob_headers
    )
    assert bob_add_res.status_code == 403

    # 16. Adding non-existent user returns 404
    non_user_res = await client.post(
        f"/api/v1/workspaces/{workspace_id}/members",
        json={"email": "doesnotexist@hyperx.io", "role": "MEMBER"},
        headers=headers
    )
    assert non_user_res.status_code == 404

    # 17. Adding existing member returns 400
    dup_member_res = await client.post(
        f"/api/v1/workspaces/{workspace_id}/members",
        json={"email": "bob@hyperx.io", "role": "MEMBER"},
        headers=headers
    )
    assert dup_member_res.status_code == 400

    # 18. Outsider user Charlie cannot access workspace members/activities/transfers -> 403
    charlie_reg = await client.post("/api/v1/auth/register", json={
        "email": "charlie@hyperx.io",
        "password": "StrongPassword2026!",
        "fullName": "Charlie Outsider"
    })
    charlie_token = charlie_reg.json()["token"]
    charlie_headers = {"Authorization": f"Bearer {charlie_token}"}

    charlie_act = await client.get(f"/api/v1/workspaces/{workspace_id}/activities", headers=charlie_headers)
    assert charlie_act.status_code == 403
    charlie_mem = await client.get(f"/api/v1/workspaces/{workspace_id}/members", headers=charlie_headers)
    assert charlie_mem.status_code == 403
    charlie_tx = await client.get(f"/api/v1/workspaces/{workspace_id}/transfers", headers=charlie_headers)
    assert charlie_tx.status_code == 403

