"""Independent test-only PAKE/composition check. Uses public synthetic fixture data.
Run in the reference venv; never import this deterministic setup in an application.
"""
import base64
import hashlib
import hmac
import json
from pathlib import Path
from spake2 import SPAKE2_A, SPAKE2_B
from spake2.ed25519_basic import L
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

root = Path(__file__).resolve().parent.parent
v = json.loads((root / "crates/foregather-kit/vectors/live-spake2-ed25519-v1.json").read_text())
s = v["session"]


def frame(*parts):
    parts = [p.encode() if isinstance(p, str) else p for p in parts]
    return b"".join(len(p).to_bytes(4, "big") + p for p in parts)


def decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


context = frame(s["profile"], s["namespace"], s["purpose"], s["locator"], s["issued"].to_bytes(8, "big"), s["expires"].to_bytes(8, "big"))
ids = dict(idA=frame(context, "inviter"), idB=frame(context, "recipient"))
a = SPAKE2_A(v["secretWords"].encode(), **ids)
b = SPAKE2_B(v["secretWords"].encode(), **ids)
# Match dalek's documented 64 random bytes -> little-endian scalar mod order.
# Monkeypatch only this isolated synthetic fixture process, never production RNG.
group = a.params.group
original = group.random_scalar
try:
    def fixture_scalar(start):
        return int.from_bytes(bytes((start + i) % 256 for i in range(64)), "little") % L
    group.random_scalar = lambda _: fixture_scalar(v["rngAStart"])
    hello_a = a.start()
    group.random_scalar = lambda _: fixture_scalar(v["rngBStart"])
    hello_b = b.start()
finally:
    group.random_scalar = original
assert encode(hello_a) == v["helloA"]
assert encode(hello_b) == v["helloB"]
key_a = a.finish(hello_b)
key_b = b.finish(hello_a)
assert hmac.compare_digest(key_a, key_b)
transcript = hashlib.sha256(frame(context, hello_a, hello_b)).digest()
assert encode(transcript) == v["transcript"]


def derive(label):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=transcript, info=frame(s["profile"], label)).derive(key_a)


for role, suffix in [("inviter", "A"), ("recipient", "B")]:
    assert encode(derive(role)) == v[f"sendKey{suffix}"]
    proof = hmac.new(derive(frame("confirmation", role)), frame(s["profile"], "confirmation", transcript, role), hashlib.sha256).digest()
    assert encode(proof) == v[f"proof{suffix}"]
seq = v["packet"]["seq"].to_bytes(8, "big")
plaintext = AESGCM(derive("inviter")).decrypt(bytes(4) + seq, decode(v["packet"]["ciphertext"]), frame(s["profile"], transcript, "inviter", seq))
assert plaintext.decode() == v["plaintext"]
words = (root / "crates/foregather-kit/src/en-v1.txt").read_text().splitlines()
verification = hmac.new(derive("verification"), b"foregather-live/verify/v1" + bytes(4), hashlib.sha256).digest()
assert " ".join(words[int.from_bytes(verification[i:i+2], "big") % 2048] for i in range(0, 6, 2)) == v["verificationWords"]
encoding = json.loads((root / "crates/foregather-kit/vectors/access-base32-en-v1.json").read_text())
assert encoding["encoding"] == "foregather-access/base32-en-v1/1"
assert hashlib.sha256((root / "crates/foregather-kit/src/en-v1.txt").read_bytes()).hexdigest() == encoding["wordlistSha256"]
for case in encoding["vectors"]:
    code = case["code"]
    bits = "".join(f"{encoding['alphabet'].index(c):05b}" for c in code)
    indexes = [1024 + len(code)] + [int(bits[i:i+11].ljust(11, "0"), 2) for i in range(0, len(bits), 11)]
    assert " ".join(words[i] for i in indexes) == case["canonicalWords"]
# foregather-exchange/1: frames and packets over the channel keys derived above.
exchange = json.loads((root / "crates/foregather-kit/vectors/exchange-v1.json").read_text())
assert exchange["profile"] == "foregather-exchange/1" and exchange["channel"] == "live-spake2-ed25519-v1.json"


def exchange_frame(index, payload):
    assert 0 <= index < 32 and len(payload) <= 16379
    return bytes([0x46, 0x47, 0x02, 0x01, index]) + payload


def payload_of(case):
    return decode(case["payload"]) if case["payload"] else b""


for case in exchange["frames"]:
    assert encode(exchange_frame(case["index"], payload_of(case))) == case["frame"]
next_index = {"inviter": 0, "recipient": 0}
for case in exchange["packets"]:
    role, index = case["role"], case["index"]
    assert index == next_index[role]
    next_index[role] += 1
    seq = index.to_bytes(8, "big")
    sealed = AESGCM(derive(role)).encrypt(bytes(4) + seq, exchange_frame(index, payload_of(case)), frame(s["profile"], transcript, role, seq))
    assert case["packet"] == {"v": s["profile"], "seq": index, "ciphertext": encode(sealed)}
print(json.dumps({"passed": True, "independentPythonSpake2": "0.9", "matchingHellos": True, "matchingKeysAndConfirmations": True, "bootstrapAndVerification": True, "characterEncodingVectors": True, "exchangeVectors": True}))
