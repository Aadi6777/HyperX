import os
import hashlib
from typing import Tuple, List
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

SALT = b"hyperx-p2p-salt-2026"
ITERATIONS = 100000

def derive_key_from_secret(secret: str, salt: bytes = SALT) -> bytes:
    """Derive 256-bit AES-GCM key from secret matching Web Crypto API."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=ITERATIONS,
    )
    return kdf.derive(secret.encode("utf-8"))

def encrypt_chunk(chunk_bytes: bytes, key_bytes: bytes) -> Tuple[List[int], bytes]:
    """
    Encrypts chunk with AES-256-GCM.
    Returns (12-byte IV list, ciphertext_with_tag).
    """
    aesgcm = AESGCM(key_bytes)
    iv = os.urandom(12)
    # aesgcm.encrypt appends 16-byte authentication tag matching Web Crypto
    encrypted = aesgcm.encrypt(iv, chunk_bytes, None)
    return list(iv), encrypted

def decrypt_chunk(cipher_bytes: bytes, iv_list: List[int], key_bytes: bytes) -> bytes:
    """
    Decrypts chunk with AES-256-GCM using 12-byte IV.
    """
    aesgcm = AESGCM(key_bytes)
    iv = bytes(iv_list)
    return aesgcm.decrypt(iv, cipher_bytes, None)

def compute_sha256(data: bytes) -> str:
    """Computes hexadecimal SHA-256 hash."""
    return hashlib.sha256(data).hexdigest()

def compute_manifest_root_hash(chunk_hashes: List[str]) -> str:
    """Computes Merkle manifest root hash over joined chunk hashes."""
    concatenated = ":".join(chunk_hashes).encode("utf-8")
    return compute_sha256(concatenated)

def generate_secure_passphrase() -> str:
    """Generates human-shareable transfer passphrase."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    random_bytes = os.urandom(16)
    code = "".join(chars[b % len(chars)] for b in random_bytes)
    return f"{code[0:4]}-{code[4:8]}-{code[8:12]}-{code[12:16]}"
