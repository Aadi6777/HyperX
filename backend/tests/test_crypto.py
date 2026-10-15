import pytest
from app.p2p.crypto import (
    derive_key_from_secret,
    encrypt_chunk,
    decrypt_chunk,
    compute_sha256,
    compute_manifest_root_hash,
    generate_secure_passphrase
)

def test_key_derivation():
    secret = "TestPassword123!"
    key1 = derive_key_from_secret(secret)
    key2 = derive_key_from_secret(secret)
    assert len(key1) == 32
    assert key1 == key2

def test_encrypt_decrypt_chunk():
    key = derive_key_from_secret("SecretKeyForChunk")
    plaintext = b"HyperX P2P Zero-RAM Browser Streaming Payload"
    
    iv, ciphertext = encrypt_chunk(plaintext, key)
    assert len(iv) == 12
    assert ciphertext != plaintext
    
    decrypted = decrypt_chunk(ciphertext, iv, key)
    assert decrypted == plaintext

def test_sha256_and_merkle():
    data = b"chunk-data-1"
    h1 = compute_sha256(data)
    assert len(h1) == 64
    
    root_hash = compute_manifest_root_hash([h1, compute_sha256(b"chunk-data-2")])
    assert len(root_hash) == 64

def test_passphrase_format():
    passphrase = generate_secure_passphrase()
    # Format: XXXX-XXXX-XXXX-XXXX
    parts = passphrase.split("-")
    assert len(parts) == 4
    for part in parts:
        assert len(part) == 4
