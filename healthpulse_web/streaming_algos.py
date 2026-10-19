"""
Streaming algorithms for HealthPulse.  Each class keeps a COMPACT STATE that is
updated one event at a time -- no class here re-reads the history.

  BloomFilter : "is this item possibly in the set?"        (bit array)
  DGIM        : "how many 1s in the last N events?"        (a few buckets)
  FMSketch    : "about how many DISTINCT items so far?"    (K small integers)
"""
import hashlib
from collections import deque


# =========================================================
# BLOOM FILTER
# =========================================================
class BloomFilter:
    def __init__(self, size=32, hashes=3):
        self.size = size
        self.hashes = hashes
        self.data = bytearray((size + 7) // 8)   # bit-packed: 8 flags per byte

    def bit(self, p):
        return (self.data[p >> 3] >> (p & 7)) & 1

    def positions(self, item):
        item = str(item).strip().lower()
        return [int(hashlib.sha256(f"{s}:{item}".encode()).hexdigest(), 16) % self.size
                for s in range(self.hashes)]

    def add(self, item):
        for p in self.positions(item):
            self.data[p >> 3] |= 1 << (p & 7)

    def might_contain(self, item):
        return all(self.bit(p) for p in self.positions(item))


# =========================================================
# DGIM  (sliding-window count of 1s)
# =========================================================
class DGIM:
    """
    buckets = [[timestamp_of_most_recent_1, size], ...]  newest -> oldest.
    Rules: sizes are powers of 2, at most 2 buckets per size; a third bucket of
    a size makes the two OLDEST of that size merge into one of double size.

    Uses an external/global clock, so a 0 bit needs no work at all: time simply
    moves on and old buckets expire when asked.
    """
    def __init__(self, window):
        self.window = window
        self.buckets = []

    def _expire(self, now):
        self.buckets = [b for b in self.buckets if b[0] > now - self.window]

    def add_one(self, t):
        """A 1 arrived at time t."""
        self._expire(t)
        self.buckets.insert(0, [t, 1])
        size = 1
        while True:
            same = [i for i, b in enumerate(self.buckets) if b[1] == size]
            if len(same) <= 2:
                break
            older, oldest = same[-2], same[-1]
            self.buckets[older] = [self.buckets[older][0], size * 2]  # keep newer timestamp
            del self.buckets[oldest]
            size *= 2

    def estimate(self, now):
        self._expire(now)
        if not self.buckets:
            return 0
        total = sum(b[1] for b in self.buckets) - self.buckets[-1][1] / 2
        return int(round(total))

    def update(self, bit, t):
        """Convenience for a stand-alone 0/1 stream with clock t."""
        if bit:
            self.add_one(t)


# =========================================================
# FLAJOLET-MARTIN  (distinct count)
# =========================================================
FM_REGISTERS = 16
FM_CORRECTION = 1 / 1.3   # empirical: 2^(mean max-trailing-zeros) overshoots n by ~1.3x


def _trailing_zeros(x):
    return 32 if x == 0 else (x & -x).bit_length() - 1


class FMSketch:
    """
    K independent hash functions (16 by default; more = steadier estimate). For each, remember only the LARGEST number of
    trailing zero bits seen. Seeing a hash that ends in R zeros happens about once
    per 2^R distinct items, so 2^R ~ number of distinct items.
    Averaging R over the K hashes steadies the estimate.  State = K small integers.
    """
    def __init__(self, registers=FM_REGISTERS):
        self.k = registers
        self.max_tz = [0] * registers

    def hashes(self, item):
        d = hashlib.shake_128(str(item).strip().encode()).digest(4 * self.k)
        return [int.from_bytes(d[4 * i:4 * i + 4], "big") for i in range(self.k)]

    def add(self, item):
        for i, h in enumerate(self.hashes(item)):
            tz = _trailing_zeros(h)
            if tz > self.max_tz[i]:
                self.max_tz[i] = tz

    def estimate(self):
        if not any(self.max_tz):
            return 0
        return int(round(2 ** (sum(self.max_tz) / self.k) * FM_CORRECTION))


# =========================================================
# Helper: exact sliding window (VALIDATION ONLY)
# =========================================================
class RecentWindow:
    """Last N items, kept only so the dashboard can show an exact count to compare."""
    def __init__(self, n):
        self.items = deque(maxlen=n)

    def add(self, x):
        self.items.append(x)


# =========================================================
# BIG BLOOM FILTER  (sized for millions of items, double hashing)
# =========================================================
class BigBloom:
    """Bloom filter for large sets. One hash call per item; k positions are derived
    from it (h1 + i*h2).  10 bits/item with 7 hashes -> about 1% false positives."""
    def __init__(self, expected_items, bits_per_item=10, hashes=7):
        self.m = max(64, int(expected_items * bits_per_item))
        self.k = hashes
        self.data = bytearray((self.m + 7) // 8)

    def _positions(self, item):
        d = hashlib.blake2b(str(item).encode(), digest_size=16).digest()
        h1 = int.from_bytes(d[:8], "big")
        h2 = int.from_bytes(d[8:], "big") | 1
        m = self.m
        return [(h1 + i * h2) % m for i in range(self.k)]

    def add_if_new(self, item):
        """Add item. Returns True if it was (possibly) already present."""
        seen = True
        data = self.data
        for p in self._positions(item):
            byte, mask = p >> 3, 1 << (p & 7)
            if not data[byte] & mask:
                seen = False
                data[byte] |= mask
        return seen


# =========================================================
# Python memory of a structure (used to compare algorithm vs exact method)
# =========================================================
import sys as _sys


def py_size(obj, _seen=None):
    """Approximate bytes Python needs to hold obj (container + the distinct objects in it).
    Objects shared by many references (e.g. the same string) are counted once."""
    seen = _seen if _seen is not None else set()
    if id(obj) in seen:
        return 0
    seen.add(id(obj))
    size = _sys.getsizeof(obj)
    if isinstance(obj, dict):
        for k, v in obj.items():
            size += py_size(k, seen) + py_size(v, seen)
    elif isinstance(obj, (list, tuple, set, frozenset, deque)):
        for x in obj:
            size += py_size(x, seen)
    return size